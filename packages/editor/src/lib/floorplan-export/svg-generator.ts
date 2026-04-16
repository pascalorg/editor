/**
 * Pure SVG floor plan generator.
 * Input: scene node data. Output: SVG string ready to download or pass to pdf-export.
 * No React, no DOM, no browser APIs.
 */

import {
  calculateLevelMiters,
  getWallPlanFootprint,
  type AnyNode,
  type DoorNode,
  type ItemNode,
  type LevelNode,
  type Point2D,
  type SiteNode,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  type WallNode,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'

import {
  applyBuildingRotation,
  bboxFromPoints,
  bboxHeight,
  bboxWidth,
  emptyBBox,
  expandBBox,
  formatPolygonPath,
  formatPolygonPoints,
  getDoorSwingArc,
  getItemFootprint,
  getOpeningFootprint,
  getStairArrow,
  getStairSegmentFootprint,
  getStairTreadLines,
  mergeBBoxes,
  polygonCentroid,
  toSvgPoint,
  toSvgX,
  toSvgY,
  type BBox,
} from './geometry'

import {
  generateTitleBlock,
  generateWallDimension,
  TITLE_BLOCK_HEIGHT_M,
} from './title-block'

// ─── Types ────────────────────────────────────────────────────────────────

export interface FloorplanExportInput {
  levelNode: LevelNode
  nodes: Record<string, AnyNode>
  buildingRotationDeg: number
  projectName: string
  unit: 'metric' | 'imperial'
  /** e.g. 100 for 1:100. Controls scale bar label only — viewBox handles actual scale */
  scale?: number
  showDimensions?: boolean
  showGrid?: boolean
}

// ─── Colours / stroke widths ──────────────────────────────────────────────

const WALL_FILL = '#e8e8e8'
const WALL_STROKE = '#1a1a1a'
const WALL_SW = 0.02

const OPENING_FILL = 'white'
const OPENING_STROKE = '#1a1a1a'
const OPENING_SW = 0.015

const SWING_STROKE = '#555'
const SWING_SW = 0.012

const ZONE_OPACITY = 0.18
const ZONE_STROKE = '#888'
const ZONE_LABEL_SIZE = 0.2

const SLAB_FILL = '#f5f5f5'
const SLAB_STROKE = '#bbb'
const SLAB_SW = 0.015

const STAIR_FILL = '#efefef'
const STAIR_STROKE = '#444'
const STAIR_SW = 0.018
const TREAD_SW = 0.01

const ITEM_FILL = 'none'
const ITEM_STROKE = '#888'
const ITEM_SW = 0.012

const SITE_FILL = 'none'
const SITE_STROKE = '#4ade80'
const SITE_SW = 0.025

const GRID_MINOR = '#e5e5e5'
const GRID_MAJOR = '#cccccc'
const GRID_SW = 0.01
const GRID_STEP = 0.5

const MARGIN_M = 1.0  // world-unit margin around drawing

// ─── Main entry point ─────────────────────────────────────────────────────

export function generateFloorplanSvg(input: FloorplanExportInput): string {
  const {
    levelNode,
    nodes,
    buildingRotationDeg,
    projectName,
    unit,
    scale = 100,
    showDimensions = true,
    showGrid = false,
  } = input

  const rot = buildingRotationDeg

  // ── Collect typed node lists from levelNode children ──────────────────
  const walls: WallNode[] = []
  const openings: Array<DoorNode | WindowNode> = []
  const zones: ZoneNode[] = []
  const slabs: SlabNode[] = []
  const stairs: StairNode[] = []
  const items: ItemNode[] = []

  const allIds = Object.keys(nodes)
  for (const id of allIds) {
    const n = nodes[id]
    if (!n) continue
    switch (n.type) {
      case 'wall':   walls.push(n as WallNode); break
      case 'door':   openings.push(n as DoorNode); break
      case 'window': openings.push(n as WindowNode); break
      case 'zone':   zones.push(n as ZoneNode); break
      case 'slab':   slabs.push(n as SlabNode); break
      case 'stair':  stairs.push(n as StairNode); break
      case 'item':   items.push(n as ItemNode); break
    }
  }

  // Filter to only nodes that belong to this level
  const levelWallIds = new Set(levelNode.walls ?? [])
  const levelWalls = walls.filter((w) => levelWallIds.has(w.id))

  // Compute miters — mandatory before wall footprints
  const miterData = calculateLevelMiters(levelWalls)

  // ── Build SVG layers ──────────────────────────────────────────────────
  const svgParts: string[] = []

  // Collect bounding boxes to compute viewBox
  let bbox: BBox = emptyBBox()

  // ── Slabs ─────────────────────────────────────────────────────────────
  const slabSvg: string[] = []
  const levelSlabIds = new Set(levelNode.slabs ?? [])
  for (const slab of slabs) {
    if (!levelSlabIds.has(slab.id)) continue
    const polygon = (slab.polygon ?? []) as Array<[number, number]>
    const pts: Point2D[] = applyBuildingRotation(
      polygon.map(([x, z]) => ({ x, y: z })),
      rot,
    )
    if (pts.length < 3) continue
    const holes = ((slab.holes ?? []) as Array<Array<[number, number]>>).map(
      (h) => applyBuildingRotation(h.map(([x, z]) => ({ x, y: z })), rot),
    )
    const d = formatPolygonPath(pts, holes)
    slabSvg.push(
      `<path d="${d}" fill="${SLAB_FILL}" stroke="${SLAB_STROKE}" ` +
      `stroke-width="${SLAB_SW}" fill-rule="evenodd"/>`,
    )
    pts.forEach((p) => (bbox = expandBBox(bbox, toSvgPoint(p))))
  }

  // ── Walls ─────────────────────────────────────────────────────────────
  const wallSvg: string[] = []
  const wallMap = new Map<string, WallNode>(levelWalls.map((w) => [w.id, w]))

  for (const wall of levelWalls) {
    const footprint = getWallPlanFootprint(wall, miterData)
    const pts: Point2D[] = applyBuildingRotation(footprint, rot)
    if (pts.length < 3) continue
    wallSvg.push(
      `<polygon points="${formatPolygonPoints(pts)}" fill="${WALL_FILL}" ` +
      `stroke="${WALL_STROKE}" stroke-width="${WALL_SW}" stroke-linejoin="round"/>`,
    )
    pts.forEach((p) => (bbox = expandBBox(bbox, toSvgPoint(p))))
  }

  // ── Openings (doors + windows) ─────────────────────────────────────────
  const openingSvg: string[] = []
  for (const opening of openings) {
    const wall = wallMap.get(opening.wallId ?? '')
    if (!wall) continue
    const footprint = getOpeningFootprint(wall, opening)
    const pts = applyBuildingRotation(footprint, rot)
    if (pts.length < 3) continue

    // White fill to "cut" the wall
    openingSvg.push(
      `<polygon points="${formatPolygonPoints(pts)}" fill="${OPENING_FILL}" ` +
      `stroke="${OPENING_STROKE}" stroke-width="${OPENING_SW}"/>`,
    )

    // Door-specific: swing arc
    if (opening.type === 'door') {
      const arc = getDoorSwingArc(wall, opening as DoorNode)
      if (arc) {
        const rotHinge = applyBuildingRotation([arc.hinge], rot)[0]
        const rotTip = applyBuildingRotation([arc.tip], rot)[0]
        const hSvg = toSvgPoint(rotHinge)
        const tSvg = toSvgPoint(rotTip)
        const r = (opening as DoorNode).width
        openingSvg.push(
          `<path d="M ${hSvg.x},${hSvg.y} A ${r},${r} 0 0,${arc.sweepFlag} ${tSvg.x},${tSvg.y}" ` +
          `fill="none" stroke="${SWING_STROKE}" stroke-width="${SWING_SW}" stroke-dasharray="0.04 0.03"/>`,
        )
      }
    }

    // Window-specific: centre line
    if (opening.type === 'window') {
      const [p0, p1, p2, p3] = pts
      const m0 = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 }
      const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const s0 = toSvgPoint(m0)
      const s1 = toSvgPoint(m1)
      openingSvg.push(
        `<line x1="${s0.x}" y1="${s0.y}" x2="${s1.x}" y2="${s1.y}" ` +
        `stroke="${SWING_STROKE}" stroke-width="${SWING_SW}"/>`,
      )
    }
  }

  // ── Zones ─────────────────────────────────────────────────────────────
  const zoneSvg: string[] = []
  const levelZoneIds = new Set(levelNode.zones ?? [])
  for (const zone of zones) {
    if (!levelZoneIds.has(zone.id)) continue
    const polygon = (zone.polygon ?? []) as Array<[number, number]>
    const pts: Point2D[] = applyBuildingRotation(
      polygon.map(([x, z]) => ({ x, y: z })),
      rot,
    )
    if (pts.length < 3) continue
    const color = zone.color ?? '#3b82f6'
    zoneSvg.push(
      `<polygon points="${formatPolygonPoints(pts)}" ` +
      `fill="${color}" fill-opacity="${ZONE_OPACITY}" ` +
      `stroke="${ZONE_STROKE}" stroke-width="${SLAB_SW}"/>`,
    )
    // Zone label
    const centroid = polygonCentroid(pts)
    const sc = toSvgPoint(centroid)
    if (zone.name) {
      zoneSvg.push(
        `<text x="${sc.x}" y="${sc.y}" ` +
        `font-family="Arial,sans-serif" font-size="${ZONE_LABEL_SIZE}" ` +
        `text-anchor="middle" dominant-baseline="central" ` +
        `fill="${color}" font-weight="600" ` +
        `>${escapeXml(zone.name)}</text>`,
      )
    }
  }

  // ── Stairs ─────────────────────────────────────────────────────────────
  const stairSvg: string[] = []
  const levelStairIds = new Set(levelNode.stairs ?? [])
  for (const stair of stairs) {
    if (!levelStairIds.has(stair.id)) continue
    const segIds: string[] = stair.children ?? []
    for (const segId of segIds) {
      const seg = nodes[segId] as StairSegmentNode | undefined
      if (!seg || seg.type !== 'stair-segment') continue

      const footprint = applyBuildingRotation(getStairSegmentFootprint(seg), rot)
      stairSvg.push(
        `<polygon points="${formatPolygonPoints(footprint)}" ` +
        `fill="${STAIR_FILL}" stroke="${STAIR_STROKE}" stroke-width="${STAIR_SW}"/>`,
      )
      footprint.forEach((p) => (bbox = expandBBox(bbox, toSvgPoint(p))))

      // Tread lines
      const treads = getStairTreadLines(seg)
      for (const [a, b] of treads) {
        const [ra, rb] = applyBuildingRotation([a, b], rot)
        const sa = toSvgPoint(ra)
        const sb = toSvgPoint(rb)
        stairSvg.push(
          `<line x1="${sa.x}" y1="${sa.y}" x2="${sb.x}" y2="${sb.y}" ` +
          `stroke="${STAIR_STROKE}" stroke-width="${TREAD_SW}"/>`,
        )
      }

      // Direction arrow
      const arrow = getStairArrow(seg)
      const [rs, re] = applyBuildingRotation(arrow.shaft, rot)
      const [rh0, rh1, rh2] = applyBuildingRotation(arrow.head, rot)
      const ss = toSvgPoint(rs)
      const se = toSvgPoint(re)
      const sh0 = toSvgPoint(rh0)
      const sh1 = toSvgPoint(rh1)
      const sh2 = toSvgPoint(rh2)
      stairSvg.push(
        `<line x1="${ss.x}" y1="${ss.y}" x2="${se.x}" y2="${se.y}" ` +
        `stroke="${STAIR_STROKE}" stroke-width="${TREAD_SW}"/>`,
        `<polygon points="${sh0.x},${sh0.y} ${sh1.x},${sh1.y} ${sh2.x},${sh2.y}" ` +
        `fill="${STAIR_STROKE}"/>`,
      )
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────
  const itemSvg: string[] = []
  for (const item of items) {
    const footprint = applyBuildingRotation(getItemFootprint(item), rot)
    if (footprint.length < 3) continue
    itemSvg.push(
      `<polygon points="${formatPolygonPoints(footprint)}" ` +
      `fill="${ITEM_FILL}" stroke="${ITEM_STROKE}" stroke-width="${ITEM_SW}"/>`,
    )
  }

  // ── Dimension annotations ─────────────────────────────────────────────
  const dimSvg: string[] = []
  if (showDimensions) {
    for (const wall of levelWalls) {
      const [x1, z1] = wall.start
      const [x2, z2] = wall.end
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.sqrt(dx * dx + dz * dz)
      if (len < 0.3) continue  // skip very short walls

      // Perpendicular direction
      const perpX = -dz / len
      const perpZ = dx / len
      const offsetDist = (wall.thickness ?? 0.1) / 2 + 0.3

      const start: Point2D = { x: x1, y: z1 }
      const end: Point2D = { x: x2, y: z2 }
      const offDir: Point2D = { x: perpX, y: perpZ }

      dimSvg.push(generateWallDimension(start, end, offDir, offsetDist, unit))
    }
  }

  // ── Optional grid ──────────────────────────────────────────────────────
  const gridSvg: string[] = []
  if (showGrid && bbox.minX !== Infinity) {
    const margin = MARGIN_M
    const gMinX = Math.floor((bbox.minX - margin) / GRID_STEP) * GRID_STEP
    const gMaxX = Math.ceil((bbox.maxX + margin) / GRID_STEP) * GRID_STEP
    const gMinY = Math.floor((bbox.minY - margin) / GRID_STEP) * GRID_STEP
    const gMaxY = Math.ceil((bbox.maxY + margin) / GRID_STEP) * GRID_STEP

    // Note: bbox is in SVG space (already flipped), grid uses SVG coords directly
    const minorPaths: string[] = []
    const majorPaths: string[] = []

    let col = 0
    for (let gx = gMinX; gx <= gMaxX; gx += GRID_STEP) {
      const arr = col % 2 === 0 ? majorPaths : minorPaths
      arr.push(`M ${gx} ${gMinY} L ${gx} ${gMaxY}`)
      col++
    }
    let row = 0
    for (let gy = gMinY; gy <= gMaxY; gy += GRID_STEP) {
      const arr = row % 2 === 0 ? majorPaths : minorPaths
      arr.push(`M ${gMinX} ${gy} L ${gMaxX} ${gy}`)
      row++
    }

    if (minorPaths.length > 0) {
      gridSvg.push(
        `<path d="${minorPaths.join(' ')}" stroke="${GRID_MINOR}" stroke-width="${GRID_SW}" fill="none"/>`,
      )
    }
    if (majorPaths.length > 0) {
      gridSvg.push(
        `<path d="${majorPaths.join(' ')}" stroke="${GRID_MAJOR}" stroke-width="${GRID_SW}" fill="none"/>`,
      )
    }
  }

  // ── Compute final viewBox ─────────────────────────────────────────────
  if (bbox.minX === Infinity) {
    // Empty scene
    bbox = { minX: -5, minY: -5, maxX: 5, maxY: 5 }
  }

  const margin = MARGIN_M
  const vbX = bbox.minX - margin
  const vbY = bbox.minY - margin
  const drawW = bboxWidth(bbox) + margin * 2
  const drawH = bboxHeight(bbox) + margin * 2
  const tbH = TITLE_BLOCK_HEIGHT_M
  const totalH = drawH + tbH + margin

  // SVG physical size: set width to 297mm (A4 landscape) as default hint for print
  // Actual rendering uses viewBox — the width/height are just aspect ratio hints
  const svgW = 297  // mm hint (for pdf-export to read)
  const svgH = Math.round((totalH / drawW) * svgW)

  // ── Title block ────────────────────────────────────────────────────────
  const levelName = levelNode.name ?? `Level ${(levelNode as any).level ?? 0}`
  const today = new Date().toISOString().split('T')[0]

  const titleBlockSvg = generateTitleBlock({
    projectName,
    levelName,
    date: today,
    scale,
    unit,
    drawingWidthM: drawW,
    drawingHeightM: drawH,
    drawingOriginX: vbX,
    drawingOriginY: vbY,
  })

  // ── Assemble final SVG ────────────────────────────────────────────────
  const viewBox = `${vbX} ${vbY} ${drawW} ${totalH}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgW}mm" height="${svgH}mm"
     viewBox="${viewBox}">
  <title>${escapeXml(projectName)} — ${escapeXml(levelName)}</title>

  <!-- Background -->
  <rect x="${vbX}" y="${vbY}" width="${drawW}" height="${totalH}" fill="white"/>

  <!-- Drawing border -->
  <rect x="${vbX}" y="${vbY}" width="${drawW}" height="${drawH}"
        fill="none" stroke="#ccc" stroke-width="0.02"/>

  <!-- Grid -->
  <g id="grid">${gridSvg.join('\n  ')}</g>

  <!-- Slabs -->
  <g id="slabs">${slabSvg.join('\n  ')}</g>

  <!-- Zones -->
  <g id="zones">${zoneSvg.join('\n  ')}</g>

  <!-- Walls -->
  <g id="walls">${wallSvg.join('\n  ')}</g>

  <!-- Openings -->
  <g id="openings">${openingSvg.join('\n  ')}</g>

  <!-- Stairs -->
  <g id="stairs">${stairSvg.join('\n  ')}</g>

  <!-- Items -->
  <g id="items">${itemSvg.join('\n  ')}</g>

  <!-- Dimensions -->
  <g id="dimensions">${dimSvg.join('\n  ')}</g>

  <!-- Title block -->
  <g id="title-block">
${titleBlockSvg}
  </g>
</svg>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
