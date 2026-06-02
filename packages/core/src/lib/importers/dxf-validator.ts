// ─── Public types ────────────────────────────────────────────────────────────

export type DxfLineEntity = {
  type: 'LINE'
  layer?: string
  // dxf-parser v1.1.2 uses vertices[0]/[1]; older builds used start/end.
  vertices?: Array<{ x: number; y: number; z?: number }>
  start?: { x: number; y: number; z?: number }
  end?: { x: number; y: number; z?: number }
}

function lineStart(l: DxfLineEntity): { x: number; y: number } | undefined {
  return l.start ?? l.vertices?.[0]
}
function lineEnd(l: DxfLineEntity): { x: number; y: number } | undefined {
  return l.end ?? l.vertices?.[1]
}

export type DxfLwPolylineEntity = {
  type: 'LWPOLYLINE'
  layer?: string
  vertices: Array<{ x: number; y: number }>
  closed?: boolean
}

export type DxfGenericEntity = {
  type: string
  layer?: string
}

export type DxfEntity = DxfLineEntity | DxfLwPolylineEntity | DxfGenericEntity

export type BBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type ValidationResult = {
  passed: boolean
  confidence: number // 0–1
  warnings: string[]
  rejectReasons: string[]
}

export type ValidatorOptions = {
  /** Scale factor applied to all coordinates before checks. Pass 0.001 for mm input; default 1.0 (metres). */
  unitScale?: number
  /** Minimum wall thickness in metres (default 0.08) */
  wallThicknessMin?: number
  /** Maximum wall thickness in metres (default 0.40) */
  wallThicknessMax?: number
  /** Raw file size in bytes for pre-parse checks */
  fileSizeBytes?: number
}

// ─── Internal geometry helpers ───────────────────────────────────────────────

type Seg = { x1: number; y1: number; x2: number; y2: number }

function segLen(s: Seg): number {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  return Math.sqrt(dx * dx + dy * dy)
}

function segAngle(s: Seg): number {
  return Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
}

/**
 * Perpendicular distance from the midpoint of `b` to the infinite line through `a`.
 * For parallel lines this equals the constant spacing between them.
 */
function perpDist(a: Seg, b: Seg): number {
  const dx = a.x2 - a.x1
  const dy = a.y2 - a.y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-9) return Infinity
  const mx = (b.x1 + b.x2) / 2
  const my = (b.y1 + b.y2) / 2
  return Math.abs((mx - a.x1) * dy - (my - a.y1) * dx) / len
}

/** Length of overlap when both segments are projected onto the direction of `a`. */
function projOverlap(a: Seg, b: Seg): number {
  const angle = segAngle(a)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const project = (s: Seg) =>
    [s.x1 * cos + s.y1 * sin, s.x2 * cos + s.y2 * sin].sort((x, y) => x - y) as [
      number,
      number,
    ]
  const [a0, a1] = project(a)
  const [b0, b1] = project(b)
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function extractSegs(entities: DxfEntity[], scale: number): Seg[] {
  const out: Seg[] = []
  for (const e of entities) {
    if (e.type === 'LINE') {
      const l = e as DxfLineEntity
      if (!l.start || !l.end) continue
      out.push({
        x1: l.start.x * scale,
        y1: l.start.y * scale,
        x2: l.end.x * scale,
        y2: l.end.y * scale,
      })
    } else if (e.type === 'LWPOLYLINE') {
      const p = e as DxfLwPolylineEntity
      if (!p.vertices) continue
      for (let i = 0; i < p.vertices.length - 1; i++) {
        const v = p.vertices[i]!
        const w = p.vertices[i + 1]!
        out.push({ x1: v.x * scale, y1: v.y * scale, x2: w.x * scale, y2: w.y * scale })
      }
      if (p.closed && p.vertices.length >= 2) {
        const last = p.vertices[p.vertices.length - 1]!
        const first = p.vertices[0]!
        out.push({
          x1: last.x * scale,
          y1: last.y * scale,
          x2: first.x * scale,
          y2: first.y * scale,
        })
      }
    }
  }
  return out
}

// ─── Hard-reject checks ───────────────────────────────────────────────────────

/**
 * Returns all matched pairs. Each pair is guaranteed to satisfy all four
 * wall-detection criteria (angle, thickness, length ratio, overlap).
 */
function findParallelPairs(segs: Seg[], thicknessMin: number, thicknessMax: number): number {
  const ANGLE_TOL = Math.PI / 180 // 1°
  const LENGTH_DIFF_MAX = 0.2 // 20%
  const OVERLAP_RATIO_MIN = 0.3 // 30% of shorter segment

  let count = 0
  const paired = new Set<number>()

  for (let i = 0; i < segs.length; i++) {
    if (paired.has(i)) continue
    const a = segs[i]!
    const lenA = segLen(a)
    if (lenA < 1e-6) continue
    const angleA = segAngle(a)

    for (let j = i + 1; j < segs.length; j++) {
      if (paired.has(j)) continue
      const b = segs[j]!
      const lenB = segLen(b)
      if (lenB < 1e-6) continue

      // Normalise angle difference to [0, π/2]
      let diff = Math.abs(angleA - segAngle(b))
      if (diff > Math.PI) diff = 2 * Math.PI - diff
      if (diff > Math.PI / 2) diff = Math.PI - diff
      if (diff > ANGLE_TOL) continue

      if (Math.abs(lenA - lenB) / Math.max(lenA, lenB) > LENGTH_DIFF_MAX) continue

      const dist = perpDist(a, b)
      if (dist < thicknessMin || dist > thicknessMax) continue

      if (projOverlap(a, b) < Math.min(lenA, lenB) * OVERLAP_RATIO_MIN) continue

      count++
      paired.add(i)
      paired.add(j)
      break
    }
  }
  return count
}

/** DFS cycle detection on an endpoint-snapped adjacency graph. A cycle implies a closable region. */
function hasClosableRegion(segs: Seg[]): boolean {
  const SNAP = 0.005 // 5 mm

  const nodes: Array<{ x: number; y: number }> = []

  function nodeFor(x: number, y: number): number {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (Math.abs(n.x - x) <= SNAP && Math.abs(n.y - y) <= SNAP) return i
    }
    nodes.push({ x, y })
    return nodes.length - 1
  }

  const adj = new Map<number, Set<number>>()

  function link(a: number, b: number) {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  for (const s of segs) {
    link(nodeFor(s.x1, s.y1), nodeFor(s.x2, s.y2))
  }

  const visited = new Set<number>()

  function dfs(node: number, parent: number): boolean {
    visited.add(node)
    for (const nb of adj.get(node) ?? []) {
      if (!visited.has(nb)) {
        if (dfs(nb, node)) return true
      } else if (nb !== parent) {
        return true // back-edge → cycle
      }
    }
    return false
  }

  for (const id of adj.keys()) {
    if (!visited.has(id) && dfs(id, -1)) return true
  }
  return false
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function validateDxf(
  entities: DxfEntity[],
  bbox: BBox,
  options: ValidatorOptions = {},
): ValidationResult {
  const rawMaxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)
  const scale = options.unitScale ?? (rawMaxDim >= 100 ? 0.001 : 1)
  const thicknessMin = options.wallThicknessMin ?? 0.08
  const thicknessMax = options.wallThicknessMax ?? 0.4
  const { fileSizeBytes } = options

  const rejectReasons: string[] = []
  const warnings: string[] = []

  // ── Hard reject 1: file too large ──────────────────────────────────────────
  if (fileSizeBytes !== undefined && fileSizeBytes > 10 * 1024 * 1024) {
    const mb = (fileSizeBytes / 1024 / 1024).toFixed(1)
    rejectReasons.push(`文件大小 ${mb}MB，超过最大限制 10MB`)
  }

  // ── Hard reject 2: scale out of range ─────────────────────────────────────
  const dx = (bbox.maxX - bbox.minX) * scale
  const dy = (bbox.maxY - bbox.minY) * scale
  const diagonal = Math.sqrt(dx * dx + dy * dy)
  if (diagonal < 3) {
    rejectReasons.push(
      `BBox 对角线 ${diagonal.toFixed(3)}m，小于最小建筑尺度 3m（疑似机械零件图）`,
    )
  } else if (diagonal > 500) {
    rejectReasons.push(
      `BBox 对角线 ${diagonal.toFixed(1)}m，超过最大建筑尺度 500m（疑似场地图或坐标系错误）`,
    )
  }

  // Entity counts used in multiple checks
  const total = entities.length
  const lineCount = entities.filter(
    e => e.type === 'LINE' || e.type === 'LWPOLYLINE',
  ).length
  const circleCount = entities.filter(e => e.type === 'CIRCLE').length
  const splineCount = entities.filter(e => e.type === 'SPLINE').length
  const arcCount = entities.filter(e => e.type === 'ARC').length
  const dimCount = entities.filter(e => e.type === 'DIMENSION').length

  // ── Hard reject 3: too few line entities ───────────────────────────────────
  if (lineCount < 10) {
    rejectReasons.push(
      `LINE + LWPOLYLINE 实体仅 ${lineCount} 个，低于最小值 10（疑似纯注释文件或空文件）`,
    )
  }

  // ── Hard reject 4: mechanical entity dominance ────────────────────────────
  if (total > 0) {
    const mechRatio = (circleCount + splineCount) / total
    if (mechRatio > 0.6) {
      const pct = Math.round(mechRatio * 100)
      rejectReasons.push(
        `CIRCLE + SPLINE 实体占比 ${pct}%（${circleCount + splineCount}/${total}），超过 60% 阈值（疑似机械图纸）`,
      )
    }
  }

  // Extract segments once for the remaining geometry checks
  const segs = extractSegs(entities, scale)
  const pairCount = segs.length >= 2 ? findParallelPairs(segs, thicknessMin, thicknessMax) : 0

  // ── Hard reject 5: no parallel line pairs ─────────────────────────────────
  if (segs.length >= 2 && pairCount === 0) {
    rejectReasons.push(
      `在 ${segs.length} 条线段中未发现平行线对（墙体间距 ${thicknessMin * 1000}–${thicknessMax * 1000}mm），缺少墙体特征`,
    )
  }

  // ── Hard reject 6: no closable region ────────────────────────────────────
  if (segs.length > 0 && !hasClosableRegion(segs)) {
    rejectReasons.push(
      `${segs.length} 条线段中无法形成封闭多边形（线段孤立，无连通区域）`,
    )
  }

  // ── Soft warning 1: no recognisable wall layer names ──────────────────────
  const WALL_KEYWORDS = ['WALL', '墙', 'A-WALL', '承重墙', '隔墙', 'ARCH-WALL']
  const hasWallLayer = entities.some(e => {
    const layer = (e.layer ?? '').toUpperCase()
    return layer.length > 0 && WALL_KEYWORDS.some(kw => layer.includes(kw.toUpperCase()))
  })
  if (!hasWallLayer) {
    warnings.push('未找到墙体图层（如 WALL、墙），识别准确率可能降低')
  }

  // ── Soft warning 2: low parallel pair ratio ───────────────────────────────
  if (segs.length > 0 && pairCount > 0) {
    const wallLinePct = Math.round((pairCount * 2) / segs.length * 100)
    if (wallLinePct < 30) {
      // Suppress when recognised non-wall architectural layers are present —
      // furniture, zones, doors, and windows naturally dilute the wall ratio.
      const NON_WALL_ARCH = ['DOOR', '门', 'ZONE', '房间', 'ROOM', 'SPACE', 'ITEM', 'FURN', '家具', 'WIN', '窗']
      const hasNonWallArch = entities.some(e => {
        const u = (e.layer ?? '').toUpperCase()
        return NON_WALL_ARCH.some(kw => u.includes(kw))
      })
      if (!hasNonWallArch) {
        warnings.push(`仅识别到 ${wallLinePct}% 的线段为墙体，建议检查图层命名`)
      }
    }
  }

  // ── Soft warning 3: many arcs ─────────────────────────────────────────────
  if (total > 0 && arcCount / total > 0.2) {
    const pct = Math.round((arcCount / total) * 100)
    warnings.push(`检测到弧形元素（ARC 占 ${pct}%），弧墙导入需要额外处理`)
  }

  // ── Soft warning 4: no dimension entities ────────────────────────────────
  if (dimCount === 0) {
    warnings.push('未找到尺寸标注，请确认图纸单位（mm 或 m）')
  }

  // ── Soft warning 5: file > 1 MB ───────────────────────────────────────────
  if (fileSizeBytes !== undefined && fileSizeBytes > 1024 * 1024) {
    const mb = (fileSizeBytes / 1024 / 1024).toFixed(1)
    warnings.push(`图纸较复杂（${mb}MB），导入时间可能较长`)
  }

  // ── Result ────────────────────────────────────────────────────────────────
  const passed = rejectReasons.length === 0
  let confidence = 0
  if (passed) {
    confidence = 0.85
    if (segs.length > 0) confidence += Math.min(0.1, (pairCount * 2) / segs.length * 0.1)
    confidence -= warnings.length * 0.05
    confidence = Math.max(0.1, Math.min(1, confidence))
  }

  return { passed, confidence, warnings, rejectReasons }
}
