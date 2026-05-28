import { type ChimneyNode, getActiveRoofHeight, type RoofSegmentNode } from '@pascal-app/core'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { flueXPositions } from './geometry'

const dummyMat = new THREE.MeshBasicMaterial()

/**
 * Carve the top openings the chimney needs:
 *   - smoke shaft cavity in the body (one chimney-wide hole, or one
 *     bore per flue when the flues are hollow)
 *   - matching holes punched through the cap
 *   - inner bore subtracted from each flue tube
 *
 * Mirrors the v1 roof-system pipeline. Lives next to `roof-trim.ts` so
 * the CSG deps (three-bvh-csg / three-mesh-bvh) stay inside the
 * chimney folder; `geometry.ts` itself stays pure.
 */
export function carveChimneyHoles(
  body: THREE.BufferGeometry,
  cap: THREE.BufferGeometry | null,
  flues: THREE.BufferGeometry | null,
  node: ChimneyNode,
  segment: RoofSegmentNode,
): {
  body: THREE.BufferGeometry
  cap: THREE.BufferGeometry | null
  flues: THREE.BufferGeometry | null
} {
  const peakY = segment.wallHeight + getActiveRoofHeight(segment)
  const topY = peakY + node.heightAboveRidge
  const capPresent = !!cap && node.cap && node.capShape !== 'none'
  const capTopY = topY + (capPresent ? node.capThickness : 0)

  const flueCount = Math.max(0, Math.min(4, node.flueCount ?? 0))
  const flueDiameter = Math.max(0.02, node.flueDiameter ?? 0.22)
  const flueWallT = Math.max(0, node.flueWallThickness ?? 0.02)
  const flueInner = flueDiameter - 2 * flueWallT
  const useFlueHoles = flueCount > 0 && flueWallT > 0 && flueInner > 0.02

  const cavityDepth = Math.max(0, node.bodyHollowDepth ?? 0.6)
  const hollowMargin = Math.max(0, node.bodyHollowMargin ?? 0.08)
  const isRound = (node.bodyShape ?? 'square') === 'round'

  type CutterSpec = {
    shape: 'round' | 'square'
    sizeX: number
    sizeZ: number
    xCenter: number
  }
  const specs: CutterSpec[] = []
  if (cavityDepth > 0.01) {
    if (useFlueHoles) {
      const xs = flueXPositions(flueCount, node.width, flueDiameter, node.flueSpacing)
      const flueShape = node.flueShape ?? 'round'
      for (const x of xs) {
        specs.push({ shape: flueShape, sizeX: flueInner, sizeZ: flueInner, xCenter: x })
      }
    } else if (hollowMargin > 0) {
      if (isRound) {
        const r = node.width / 2 - hollowMargin
        if (r > 0.02) {
          specs.push({ shape: 'round', sizeX: 2 * r, sizeZ: 2 * r, xCenter: 0 })
        }
      } else {
        const cw = node.width - 2 * hollowMargin
        const cd = node.depth - 2 * hollowMargin
        if (cw > 0.04 && cd > 0.04) {
          specs.push({ shape: 'square', sizeX: cw, sizeZ: cd, xCenter: 0 })
        }
      }
    }
  }

  const flueHeight = Math.max(0.02, node.flueHeight ?? 0.3)
  const yCavityBot = topY - cavityDepth
  const yCapTop = capTopY + 0.02

  const subtractFrom = (
    base: THREE.BufferGeometry,
    yBot: number,
    yTop: number,
  ): THREE.BufferGeometry => {
    if (specs.length === 0) return base
    const cutters = specs.map((spec) => buildCutter(node, spec, yBot, yTop))
    const result = subtractCutters(base, cutters)
    for (const cutter of cutters) cutter.geometry.dispose()
    return result
  }

  let newBody = subtractFrom(body, yCavityBot, yCapTop)
  const newCap = cap ? subtractFrom(cap, yCavityBot, yCapTop) : null

  // Decorative inset panels — carve a shallow rectangle out of each
  // vertical face. Square bodies only (round bodies have no flat
  // faces). Same CSG pipeline as the cavity cutters above.
  const wantPanels =
    node.panelStyle !== 'none' && !isRound && node.panelDepth > 0 && node.panelHeight > 0.01
  if (wantPanels) {
    const panelCutters = buildPanelCutters(node, topY)
    if (panelCutters.length > 0) {
      newBody = subtractCutters(newBody, panelCutters)
      for (const cutter of panelCutters) cutter.geometry.dispose()
    }
  }

  // Hollow each flue tube by punching its inner bore through.
  let newFlues = flues
  if (flues && useFlueHoles) {
    const xs = flueXPositions(flueCount, node.width, flueDiameter, node.flueSpacing)
    const flueShape = node.flueShape ?? 'round'
    const cutters = xs.map((x) =>
      buildCutter(
        node,
        { shape: flueShape, sizeX: flueInner, sizeZ: flueInner, xCenter: x },
        capTopY - 0.02,
        capTopY + flueHeight + 0.02,
      ),
    )
    newFlues = subtractCutters(flues, cutters)
    for (const cutter of cutters) cutter.geometry.dispose()
  }

  // Partition each surface so the very top face becomes its own material
  // group (index 1 → top material, index 0 → body material). Matches v1's
  // surface-array assignment.
  partitionTopFaceGroups(newBody, topY - 0.05)
  if (newCap) partitionTopFaceGroups(newCap, capTopY - 0.005)
  if (newFlues) partitionTopFaceGroups(newFlues, capTopY + flueHeight - 0.005)

  return { body: newBody, cap: newCap, flues: newFlues }
}

/**
 * Split the index buffer into two groups:
 *   - group 0: every triangle whose normal is NOT roughly up, or that
 *     sits below `topYMin`. Receives the body material.
 *   - group 1: the top face triangles. Receives the top material.
 *
 * Mirrors the v1 `partitionTopFaceGroups` in
 * `packages/viewer/src/systems/chimney/chimney-geometry.ts`. Operates in
 * place — the geometry is re-indexed and its `groups` array rewritten.
 */
export function partitionTopFaceGroups(geo: THREE.BufferGeometry, topYMin: number) {
  // CSG paths return indexed geometry; the pure-builder path doesn't. If
  // we don't have an index, build one so the partitioning logic has
  // something to reorder.
  if (!geo.getIndex()) {
    const merged = mergeVertices(geo, 1e-4)
    if (merged.getIndex()) {
      const idx = merged.getIndex()!
      geo.setIndex(idx)
      geo.setAttribute('position', merged.getAttribute('position'))
      if (merged.getAttribute('uv')) geo.setAttribute('uv', merged.getAttribute('uv'))
      if (merged.getAttribute('normal')) geo.setAttribute('normal', merged.getAttribute('normal'))
    }
  }
  const positions = geo.getAttribute('position')
  let normals = geo.getAttribute('normal')
  if (!normals) {
    geo.computeVertexNormals()
    normals = geo.getAttribute('normal')
  }
  const index = geo.getIndex()
  if (!(positions && normals && index)) {
    geo.clearGroups()
    geo.addGroup(0, index?.count ?? positions.count, 0)
    return
  }

  const idxArr = index.array as ArrayLike<number>
  const topTris: number[] = []
  const otherTris: number[] = []
  const yEps = 0.02

  for (let i = 0; i < idxArr.length; i += 3) {
    const a = idxArr[i] as number
    const b = idxArr[i + 1] as number
    const c = idxArr[i + 2] as number
    const ny = (normals.getY(a) + normals.getY(b) + normals.getY(c)) / 3
    const py = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3
    if (ny > 0.95 && py >= topYMin - yEps) {
      topTris.push(a, b, c)
    } else {
      otherTris.push(a, b, c)
    }
  }

  const total = otherTris.length + topTris.length
  const useUint32 = (positions.count ?? 0) > 0xff_ff
  const newArr = useUint32 ? new Uint32Array(total) : new Uint16Array(total)
  for (let i = 0; i < otherTris.length; i++) newArr[i] = otherTris[i] as number
  for (let i = 0; i < topTris.length; i++) newArr[otherTris.length + i] = topTris[i] as number
  geo.setIndex(new THREE.BufferAttribute(newArr, 1))

  geo.clearGroups()
  if (otherTris.length > 0) geo.addGroup(0, otherTris.length, 0)
  if (topTris.length > 0) geo.addGroup(otherTris.length, topTris.length, 1)
}

/**
 * Build one cutter brush per vertical face for the inset-panel feature.
 * Each cutter is a thin box flush against the body face; CSG-subtracted
 * from the body it leaves a recessed rectangular panel — same shape as
 * v1's `buildPanelCutterBrush`.
 */
function buildPanelCutters(node: ChimneyNode, topY: number): Brush[] {
  const w = node.width
  const d = node.depth
  const margin = Math.max(0, node.panelMargin)
  const recess = Math.max(0.005, node.panelDepth)
  const panelHeight = Math.max(0.05, node.panelHeight)
  const offsetTop = Math.max(0, node.panelOffsetTop)
  const yTop = topY - offsetTop
  const yBot = yTop - panelHeight
  const eps = 0.002

  const faces: Array<{
    sizeX: number
    sizeZ: number
    cx: number
    cz: number
  }> = []

  const panelW = w - 2 * margin
  const panelD = d - 2 * margin
  if (panelW > 0.05) {
    // frontZ
    faces.push({
      sizeX: panelW,
      sizeZ: recess + 2 * eps,
      cx: 0,
      cz: d / 2 - recess / 2 + eps,
    })
    // backZ
    faces.push({
      sizeX: panelW,
      sizeZ: recess + 2 * eps,
      cx: 0,
      cz: -d / 2 + recess / 2 - eps,
    })
  }
  if (panelD > 0.05) {
    // rightX
    faces.push({
      sizeX: recess + 2 * eps,
      sizeZ: panelD,
      cx: w / 2 - recess / 2 + eps,
      cz: 0,
    })
    // leftX
    faces.push({
      sizeX: recess + 2 * eps,
      sizeZ: panelD,
      cx: -w / 2 + recess / 2 - eps,
      cz: 0,
    })
  }

  const h = Math.max(0.02, yTop - yBot)
  const midY = (yTop + yBot) / 2
  const brushes: Brush[] = []
  for (const f of faces) {
    const geo = new THREE.BoxGeometry(f.sizeX, h, f.sizeZ)
    geo.translate(f.cx, midY, f.cz)
    // Body geometry is in chimney-local frame (node.position/rotation are
    // applied by the renderer's nested ref'd group, not baked into the
    // buffer geometry), so cutters need to stay in chimney-local too.

    const idx = geo.getIndex()?.count ?? 0
    geo.clearGroups()
    if (idx > 0) geo.addGroup(0, idx, 0)

    const brush = new Brush(geo, dummyMat as unknown as THREE.MeshStandardMaterial)
    brush.updateMatrixWorld()
    prepareBrushForCSG(brush)
    brushes.push(brush)
  }
  return brushes
}

function buildCutter(
  node: ChimneyNode,
  spec: { shape: 'round' | 'square'; sizeX: number; sizeZ: number; xCenter: number },
  yBot: number,
  yTop: number,
): Brush {
  const h = Math.max(0.02, yTop - yBot)
  const midY = (yTop + yBot) / 2
  const geo: THREE.BufferGeometry =
    spec.shape === 'round'
      ? new THREE.CylinderGeometry(spec.sizeX / 2, spec.sizeX / 2, h, 24, 1, false)
      : new THREE.BoxGeometry(spec.sizeX, h, spec.sizeZ)
  geo.translate(spec.xCenter, midY, 0)
  // Cutter stays in chimney-local frame to match the body/cap/flue
  // geometry (node.position/rotation are applied via the renderer's
  // nested ref'd group, not baked into the buffer geometry).

  const idx = geo.getIndex()?.count ?? 0
  geo.clearGroups()
  if (idx > 0) geo.addGroup(0, idx, 0)

  const brush = new Brush(geo, dummyMat as unknown as THREE.MeshStandardMaterial)
  brush.updateMatrixWorld()
  prepareBrushForCSG(brush)
  return brush
}

function subtractCutters(base: THREE.BufferGeometry, cutters: Brush[]): THREE.BufferGeometry {
  if (cutters.length === 0) return base

  const indexed = mergeVertices(base, 1e-4)
  if (!indexed.getAttribute('normal')) indexed.computeVertexNormals()
  const ic = indexed.getIndex()?.count ?? 0
  indexed.clearGroups()
  if (ic > 0) indexed.addGroup(0, ic, 0)

  const baseBrush = new Brush(indexed, dummyMat as unknown as THREE.MeshStandardMaterial)
  baseBrush.updateMatrixWorld()
  prepareBrushForCSG(baseBrush)

  let current: Brush = baseBrush
  const intermediates: Brush[] = []

  try {
    for (const cutter of cutters) {
      const next = csgEvaluator.evaluate(current, cutter, SUBTRACTION) as Brush
      prepareBrushForCSG(next)
      if (current !== baseBrush) intermediates.push(current)
      current = next
    }
    const out = csgGeometry(current).clone()
    const idx = out.getIndex()?.count ?? 0
    out.clearGroups()
    if (idx > 0) out.addGroup(0, idx, 0)
    else out.addGroup(0, out.getAttribute('position').count, 0)
    out.computeVertexNormals()

    base.dispose()
    indexed.dispose()
    for (const b of intermediates) b.geometry.dispose()
    if (current !== baseBrush) current.geometry.dispose()
    return out
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[chimney] hole carve CSG failed:', e)
    indexed.dispose()
    for (const b of intermediates) b.geometry.dispose()
    if (current !== baseBrush) current.geometry.dispose()
    return base
  }
}
