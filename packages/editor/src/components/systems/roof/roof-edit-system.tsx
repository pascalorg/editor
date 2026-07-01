import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  getDutchRoofMetrics,
  getEffectiveNode,
  getRoofSegmentVisibleTopBounds,
  getSegmentSlopeFrame,
  MIN_ROOF_SEGMENT_TRIM_SPAN,
  nodeRegistry,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentTrim,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  Brush,
  csgEvaluator,
  generateRoofSegmentGeometry,
  INTERSECTION,
  prepareBrushForCSG,
  useViewer,
} from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { getHoveredRoofSegmentOutlineProxyName } from '../../../lib/roof-hover-outline-proxy'
import useInteractionScope, { useMovingNode } from '../../../store/use-interaction-scope'
import { swallowNextClick } from '../../editor/handles/use-handle-drag'

// Empty placeholder geometry used when we reveal segments-wrapper for
// accessory editing. The roof's CSG-merged shell is the only thing
// that should render the roof surface in this mode — the per-segment
// CSG geometry (if any was left over from a prior edit) would visually
// double the cut shape, so we strip each segment mesh back to nothing.
// `RoofSystem` rebuilds CSG on demand if the user later selects a
// segment, so destroying the cached geometry here only costs one
// recomputation per segment when the user actually wants it back.
function makeEmptySegmentGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // Three zero-vertices (one degenerate, invisible triangle), not an empty
  // attribute: in accessory-reveal mode the segments-wrapper is shown, so these
  // meshes are drawn. An empty position (count 0) leaves WebGPU vertex buffer
  // slot 0 unbound and the draw is rejected, poisoning the command encoder.
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  // Match the four material slots the roof-segment renderer's material
  // array expects (0=top, 1=side, 2=interior, 3=shingle). Without these
  // groups, mesh.material is a single-material lookup that mismatches
  // the array — same crash mode the BoxGeometry workaround in
  // `roof-system.tsx:144` guards against.
  g.addGroup(0, 0, 0)
  g.addGroup(0, 0, 1)
  g.addGroup(0, 0, 2)
  g.addGroup(0, 0, 3)
  return g
}

type RoofTrimSide =
  | 'left'
  | 'right'
  | 'front'
  | 'back'
  | 'frontLeft'
  | 'frontRight'
  | 'backLeft'
  | 'backRight'
  | 'frontLeftX'
  | 'frontLeftZ'
  | 'frontRightX'
  | 'frontRightZ'
  | 'backLeftX'
  | 'backLeftZ'
  | 'backRightX'
  | 'backRightZ'

type DiagonalTrimSide = 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight'
type DiagonalTrimAxisSide = Exclude<
  RoofTrimSide,
  'left' | 'right' | 'front' | 'back' | DiagonalTrimSide
>
type DiagonalTrimAxisKey = DiagonalTrimAxisSide

const TRIM_PLANE_COLOR = '#93c5fd'
const TRIM_PLANE_OPACITY = 0.18
const TRIM_PLANE_HOVER_OPACITY = 0.32
const TRIM_RAIL_COLOR = '#2563eb'
const TRIM_RAIL_HOVER_COLOR = '#4f46e5'
const TRIM_CAP_COLOR = TRIM_RAIL_COLOR
const TRIM_CAP_HOVER_COLOR = TRIM_RAIL_HOVER_COLOR
const TRIM_ADD_COLOR = TRIM_RAIL_COLOR
const TRIM_ADD_HOVER_COLOR = TRIM_RAIL_HOVER_COLOR
const TRIM_PLANE_RENDER_ORDER = 1001
const TRIM_RAIL_RENDER_ORDER = 1003
const TRIM_HANDLE_BASE_SCALE = 0.65
const TRIM_RAIL_SURFACE_OFFSET = 0
const TRIM_RAIL_HIT_HEIGHT = 0.18
const TRIM_RAIL_HIT_DEPTH = 0.16
const TRIM_CAP_HIT_SIZE = 0.22
const TRIM_LIVE_REBUILD_INTERVAL_MS = 80

const TRIM_UNIT_PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1)
const TRIM_UNIT_RAIL_GEOMETRY = new THREE.BoxGeometry(1, 1, 1)
const TRIM_UNIT_RAIL_CAP_GEOMETRY = new THREE.SphereGeometry(0.5, 16, 8)
const TRIM_UNIT_ADD_GEOMETRY = new THREE.OctahedronGeometry(0.5, 0)

const trimPlaneMaterial = new MeshBasicNodeMaterial({
  color: TRIM_PLANE_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: TRIM_PLANE_OPACITY,
  side: THREE.DoubleSide,
  transparent: true,
})
const trimPlaneHoverMaterial = new MeshBasicNodeMaterial({
  color: TRIM_PLANE_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: TRIM_PLANE_HOVER_OPACITY,
  side: THREE.DoubleSide,
  transparent: true,
})
const trimRailMaterial = new MeshBasicNodeMaterial({
  color: TRIM_RAIL_COLOR,
  depthTest: false,
  depthWrite: false,
})
const trimRailHoverMaterial = new MeshBasicNodeMaterial({
  color: TRIM_RAIL_HOVER_COLOR,
  depthTest: false,
  depthWrite: false,
})
const trimCapMaterial = new MeshBasicNodeMaterial({
  color: TRIM_CAP_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 1,
  transparent: false,
})
const trimCapHoverMaterial = new MeshBasicNodeMaterial({
  color: TRIM_CAP_HOVER_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 1,
  transparent: false,
})
const trimAddMaterial = new MeshBasicNodeMaterial({
  color: TRIM_ADD_COLOR,
  depthTest: false,
  depthWrite: false,
})
const trimAddHoverMaterial = new MeshBasicNodeMaterial({
  color: TRIM_ADD_HOVER_COLOR,
  depthTest: false,
  depthWrite: false,
})
const trimDiagonalPreviewRailMaterial = new MeshBasicNodeMaterial({
  color: TRIM_RAIL_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.42,
  transparent: true,
})

// ─── Section-cut (cutaway) feedback ──────────────────────────────────
// The cross-section the trim removes: a thin slab at each cut line is
// intersected with the untrimmed roof shell AND every hosted accessory
// (chimney, vents, skylight, dormer, …), so the fill shows real material only
// (wall + deck bands + any accessory the cut passes through) and leaves the
// hollow attic empty. The outline is the edge silhouette of that fill. A
// translucent red fill + darker red outline read together as a SketchUp-style
// section cut of what the trim removes.
// Matches the app's destructive red (`--destructive`, oklch(0.577 0.245 27.325)
// ≈ #dc2626 / red-600 — the delete/destructive button color). Three's
// MeshBasicNodeMaterial color doesn't parse oklch() strings, so use the sRGB hex
// equivalent; the outline is a darker shade of the same hue.
const SECTION_FILL_COLOR = '#dc2626'
const SECTION_OUTLINE_COLOR = '#991b1b'
const SECTION_FILL_RENDER_ORDER = 1000
const SECTION_OUTLINE_RENDER_ORDER = 1002
// Build the cut line just inside the kept material so the section plane never
// sits coplanar with the mesh's own cut face.
const SECTION_PLANE_INSET = 0.004

// A vertical cut plane defined by a horizontal line through the XZ ground
// plane. `origin` is a point on the line, `dir` is the unit in-plane
// horizontal direction (in XZ), and `normal` is the unit XZ normal. Vertices
// are projected to (u = dir·xz, v = world Y) for slicing and lifted back via
// `origin + dir`. This handles both the axis-aligned sides (left/right cut on
// x, front/back on z) and the angled diagonal/corner cuts.
type SectionPlaneSpec = {
  origin: THREE.Vector2 // point on the cut line, (x, z)
  dir: THREE.Vector2 // unit in-plane horizontal direction, (x, z)
  normal: THREE.Vector2 // unit normal in the XZ plane, (x, z)
  // The cut plane is infinite, but the visible cut only spans the footprint
  // edge between the two endpoints. We clip slice segments to this u-range
  // (u = projection along `dir`) so the silhouette doesn't sprout lines where
  // the infinite plane grazes the rest of the roof.
  uMin: number
  uMax: number
  // How far the slab extends past each end of the cut line. A FREE (untrimmed)
  // end has eave/overhang material beyond the footprint edge, so we extend to
  // capture it; a TRIMMED end has none, so we clamp to 0 — otherwise the slab
  // grabs phantom material from the untrimmed shell and the red section pokes
  // out past the trim box. `dir` points A→B, so uMin is always endpoint A and
  // uMax endpoint B; `extendMin` applies at A, `extendMax` at B.
  extendMin: number
  extendMax: number
}

// Build a section plane from two XZ points on the cut line. `inset` shifts the
// plane along its normal toward the supplied "inside" point so the slice sits
// just inside kept material instead of coplanar with the mesh's own cut face.
// `extendA` / `extendB` set the slab overrun past endpoint A / B (0 at trimmed
// ends, a small overhang allowance at free ends).
function makeSectionPlane(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  inset = 0,
  insidePoint?: readonly [number, number],
  extendA = 0,
  extendB = 0,
): SectionPlaneSpec {
  const dir = new THREE.Vector2(bx - ax, bz - az)
  if (dir.lengthSq() < 1e-12) dir.set(1, 0)
  dir.normalize()
  const normal = new THREE.Vector2(dir.y, -dir.x)
  const origin = new THREE.Vector2(ax, az)
  if (inset !== 0 && insidePoint) {
    const toInsideX = insidePoint[0] - ax
    const toInsideZ = insidePoint[1] - az
    const sign = normal.x * toInsideX + normal.y * toInsideZ >= 0 ? 1 : -1
    origin.x += normal.x * inset * sign
    origin.y += normal.y * inset * sign
  }
  // dir = (B-A).normalized, so dir·B - dir·A = |B-A| > 0 → uB is always uMax.
  const uA = dir.x * ax + dir.y * az
  const uB = dir.x * bx + dir.y * bz
  return { origin, dir, normal, uMin: uA, uMax: uB, extendMin: extendA, extendMax: extendB }
}

// Lift a 2D plane-frame point (u = projection along dir, v = world Y) back to
// segment-local 3D using the plane's origin and direction.
function liftSectionPoint(plane: SectionPlaneSpec, u: number, v: number): [number, number, number] {
  const uOrigin = plane.dir.x * plane.origin.x + plane.dir.y * plane.origin.y
  const t = u - uOrigin
  return [plane.origin.x + plane.dir.x * t, v, plane.origin.y + plane.dir.y * t]
}

const sectionFillMaterial = new MeshBasicNodeMaterial({
  color: SECTION_FILL_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.85,
  side: THREE.DoubleSide,
  transparent: true,
})

const sectionOutlineMaterial = new LineBasicNodeMaterial({
  color: SECTION_OUTLINE_COLOR,
  depthTest: false,
  depthWrite: false,
  linewidth: 2,
})

const hoverOutlineProxyMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0,
})

// Half-thickness of the slab brush intersected with the roof shell. The wafer
// must be thin enough to read as a flat cut face but thick enough that CSG
// produces a stable, non-degenerate solid.
const SECTION_SLAB_HALF_THICKNESS = 0.006

// Builds a thin oriented slab brush straddling one cut line, spanning the full
// segment height. Intersecting it with the roof shell yields exactly the
// material the cut passes through (roof slab + wall bands), leaving the hollow
// attic empty — a true section cut.
function buildSectionSlabBrush(plane: SectionPlaneSpec, vMin: number, vMax: number): Brush | null {
  const span = plane.uMax - plane.uMin
  const height = vMax - vMin
  if (!(span > 1e-4 && height > 1e-4)) return null

  // Extend past each end only as far as that end allows: a free edge gets an
  // overhang allowance so eave/shingle material is captured; a trimmed end gets
  // 0 so the slab stops at the cut line and the section never pokes past the
  // trim box. The box is centred on the extended span's midpoint.
  const uLo = plane.uMin - plane.extendMin
  const uHi = plane.uMax + plane.extendMax
  const length = uHi - uLo
  const geometry = new THREE.BoxGeometry(length, height, SECTION_SLAB_HALF_THICKNESS * 2)
  const yaw = Math.atan2(-plane.dir.y, plane.dir.x)
  geometry.rotateY(yaw)
  const midU = (uLo + uHi) / 2
  const [cx, , cz] = liftSectionPoint(plane, midU, 0)
  geometry.translate(cx, (vMin + vMax) / 2, cz)

  const brush = new Brush(geometry)
  prepareBrushForCSG(brush)
  return brush
}

// Builds the combined fill + outline geometries (segment-local 3D) for all
// active trim planes. The fill is the CSG intersection of the untrimmed roof
// shell with a thin slab at each cut line (material only — attic stays hollow).
// The outline is the edge silhouette of that same fill (via EdgesGeometry), so
// it traces the real cut shape — wall/deck band boundaries and the hollow-attic
// edge — instead of just the top surface line. Both in segment-local space, to
// be mounted under the segment-world-matrix group.
function buildSectionGeometries(
  segment: RoofSegmentNode,
  planes: SectionPlaneSpec[],
  accessoryGeometries: THREE.BufferGeometry[] = [],
): { fill: THREE.BufferGeometry; outline: THREE.BufferGeometry } | null {
  if (planes.length === 0) return null

  // Untrimmed shell — the source we intersect slabs against. Dutch rake boards
  // are decorative overhang geometry; slicing them makes the red preview sprout
  // tall phantom triangles, so the section fill uses the stable roof shell.
  const sectionSourceSegment: RoofSegmentNode =
    segment.roofType === 'dutch'
      ? { ...segment, trim: ZERO_TRIM, dutchGabletRake: 0 }
      : { ...segment, trim: ZERO_TRIM }
  const shellGeometry = generateRoofSegmentGeometry(sectionSourceSegment)
  const shell = new Brush(shellGeometry)
  prepareBrushForCSG(shell)

  const slopeFrame = getSegmentSlopeFrame(segment)
  // Span the full material height — wall bands (base→eave) plus the deck/shingle
  // wedge above — so the cut face fills completely. The earlier red bars that
  // poked below the box were horizontal overshoot (the untrimmed slab dragging
  // wall material past a perpendicular cut), now fixed by the per-end slab
  // extension clamp; clipping the wall band off here only left gaps.
  const vMin = -0.05
  const vMax =
    segment.wallHeight +
    slopeFrame.activeRh +
    segment.deckThickness +
    segment.shingleThickness +
    0.5

  const fillPositions: number[] = []
  const outlinePositions: number[] = []
  // Section cut only needs material presence, not per-face materials — disable
  // group bookkeeping on the shared evaluator for this pass so mismatched slab /
  // shell material slots can't misalign group indices and crash.
  const prevUseGroups = csgEvaluator.useGroups
  const prevAttributes = csgEvaluator.attributes
  csgEvaluator.useGroups = false
  csgEvaluator.attributes = ['position']

  // Intersect every active section slab with a source solid (the roof shell or
  // an accessory mesh), appending the resulting cross-section to the shared
  // fill + outline buffers. The slab sits just inside the kept material, so the
  // intersection yields the material face the cut exposes.
  const sliceSourceBySlabs = (source: Brush) => {
    for (const plane of planes) {
      const slab = buildSectionSlabBrush(plane, vMin, vMax)
      if (!slab) continue
      try {
        const result = csgEvaluator.evaluate(source, slab, INTERSECTION) as Brush
        const geo = result.geometry as THREE.BufferGeometry
        const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
        if (pos && pos.count > 0) {
          const index = geo.getIndex()
          const count = index ? index.count : pos.count
          for (let i = 0; i < count; i++) {
            const vi = index ? index.getX(i) : i
            fillPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
          }
          // Trace the silhouette of the cut face itself. EdgesGeometry emits a
          // boundary/crease line list; the thin wafer's flat cut caps give a
          // crisp outline of the actual material shape.
          const edges = new THREE.EdgesGeometry(geo, 1)
          const ep = edges.getAttribute('position') as THREE.BufferAttribute | undefined
          if (ep) {
            for (let i = 0; i < ep.count; i++) {
              outlinePositions.push(ep.getX(i), ep.getY(i), ep.getZ(i))
            }
          }
          edges.dispose()
        }
        geo.dispose()
      } catch (e) {
        console.error('Roof section-cut CSG failed:', e)
      } finally {
        slab.geometry.dispose()
      }
    }
  }

  // Brushes built from accessory meshes; disposed after the slice pass.
  const accessoryBrushes: Brush[] = []
  try {
    sliceSourceBySlabs(shell)
    // Accessories that fall in the trimmed region contribute their own
    // cross-section to the same red fill (chimney, vents, skylight, dormer, …).
    // Each geometry arrives already in segment-local space.
    for (const accGeo of accessoryGeometries) {
      try {
        // Weld coincident verts so the brush is a valid indexed solid. Most
        // accessories are clean THREE primitives, but some (e.g. the ridge
        // vent) are hand-wound non-indexed triangle soup; three-bvh-csg's
        // INTERSECTION classifies inside/outside off a welded, indexed mesh and
        // silently yields nothing for raw soup — the same `mergeVertices` step
        // the viewer's own accessory CSG runs before any boolean op.
        const welded = mergeVertices(accGeo, 1e-4)
        const accBrush = new Brush(welded)
        prepareBrushForCSG(accBrush)
        accessoryBrushes.push(accBrush)
        sliceSourceBySlabs(accBrush)
      } catch (e) {
        console.error('Roof section-cut accessory CSG failed:', e)
      }
    }
  } finally {
    csgEvaluator.useGroups = prevUseGroups
    csgEvaluator.attributes = prevAttributes
    shellGeometry.dispose()
    for (const b of accessoryBrushes) b.geometry.dispose()
  }

  if (fillPositions.length === 0) return null

  const fill = new THREE.BufferGeometry()
  fill.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3))
  const outline = new THREE.BufferGeometry()
  outline.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3))
  return { fill, outline }
}

// Zeroed trim — the section fill intersects the FULL (untrimmed) roof shell at
// the cut line, so we regenerate the shell with no trim and slab-intersect it.
const ZERO_TRIM: RoofSegmentTrim = {
  left: 0,
  right: 0,
  front: 0,
  back: 0,
  frontLeft: 0,
  frontRight: 0,
  backLeft: 0,
  backRight: 0,
  frontLeftX: 0,
  frontLeftZ: 0,
  frontRightX: 0,
  frontRightZ: 0,
  backLeftX: 0,
  backLeftZ: 0,
  backRightX: 0,
  backRightZ: 0,
}

type TrimVisibleBounds = ReturnType<typeof getRoofSegmentVisibleTopBounds>

function getTrimVisibleTopBounds(segment: RoofSegmentNode): TrimVisibleBounds {
  const bounds = getRoofSegmentVisibleTopBounds(segment)
  if (segment.roofType !== 'dutch') return bounds

  const trim = normalizeRoofSegmentTrim(segment)
  const metrics = getDutchRoofMetrics(segment)
  const requestedRake = Math.max(0, segment.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake)
  const rakeReach = Math.min(
    requestedRake,
    (metrics.axis === 'x' ? metrics.shoulderInsetAlongWidth : metrics.shoulderInsetAlongDepth) *
      0.98,
  )
  if (!(rakeReach > 0.001)) return bounds

  const next = { ...bounds }
  if (metrics.axis === 'x') {
    if (!(trim.left > 0)) next.minX -= rakeReach
    if (!(trim.right > 0)) next.maxX += rakeReach
  } else {
    if (!(trim.back > 0)) next.minZ -= rakeReach
    if (!(trim.front > 0)) next.maxZ += rakeReach
  }

  next.width = Math.max(0.01, next.maxX - next.minX)
  next.depth = Math.max(0.01, next.maxZ - next.minZ)
  return next
}

// Shape fields that affect the segment's 3D volume. Trim is excluded — the cut
// lines arrive via `planes`, whose endpoints already encode the trim — so the
// memo recomputes when either the roof shape or any trim changes, and the shell
// regeneration only reruns when the actual roof shape changes.
function segmentShapeKey(segment: RoofSegmentNode): string {
  return JSON.stringify([
    segment.roofType,
    segment.width,
    segment.depth,
    segment.wallHeight,
    segment.pitch,
    segment.wallThickness,
    segment.deckThickness,
    segment.overhang,
    segment.shingleThickness,
    segment.gambrelLowerWidthRatio,
    segment.gambrelLowerHeightRatio,
    segment.mansardSteepWidthRatio,
    segment.mansardSteepHeightRatio,
    segment.dutchHipWidthRatio,
    segment.dutchHipHeightRatio,
    segment.dutchWaistLengthRatio,
    segment.dutchGabletRake,
    segment.dutchTopRakeThickness,
  ])
}

// Collect every roof-accessory mesh hosted on `segment` as a segment-local
// geometry, so the section-cut pass can intersect each with the cut slabs and
// show its cross-section in the red fill. Registry-driven — an accessory is any
// child kind declaring the `roofAccessory` capability — so no kind is named
// here. The meshes come straight from `sceneRegistry` (already live: each
// renderer re-clips against the live trim), so the geometry reflects the
// in-flight drag. Returned geometries are fresh clones the caller owns +
// disposes.
const _segWorldInverse = new THREE.Matrix4()
const _accWorld = new THREE.Matrix4()
function collectAccessorySectionGeometries(segment: RoofSegmentNode): THREE.BufferGeometry[] {
  const childIds = segment.children
  if (!childIds || childIds.length === 0) return []

  const segSource = sceneRegistry.nodes.get(segment.id)
  if (!segSource) return []
  segSource.updateWorldMatrix(true, false)
  _segWorldInverse.copy(segSource.matrixWorld).invert()

  const nodes = useScene.getState().nodes
  const out: THREE.BufferGeometry[] = []
  for (const childId of childIds) {
    const childNode = nodes[childId as AnyNodeId]
    if (!childNode) continue
    if (!nodeRegistry.get(childNode.type)?.capabilities?.roofAccessory) continue
    const obj = sceneRegistry.nodes.get(childId)
    if (!obj) continue
    obj.updateWorldMatrix(true, true)
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!posAttr || posAttr.count === 0) return
      // mesh-world → segment-local: segmentWorld⁻¹ · meshWorld.
      _accWorld.multiplyMatrices(_segWorldInverse, mesh.matrixWorld)
      const geo = mesh.geometry.clone()
      geo.applyMatrix4(_accWorld)
      out.push(geo)
    })
  }
  return out
}

// A change key over the hosted accessories' kinds + world transforms, so the
// section-cut memo recomputes when an accessory moves, is added/removed, or its
// host pose shifts (mirrors how `planes` keys the trim cut). Geometry-shape
// changes are caught by the renderer re-clipping (new mesh world matrix on
// resize is not guaranteed, but trim drag changes `planes` every tick, which
// already forces the recompute during the gesture we care about).
function accessorySectionKey(segment: RoofSegmentNode): string {
  const childIds = segment.children
  if (!childIds || childIds.length === 0) return 'none'
  const nodes = useScene.getState().nodes
  const parts: string[] = []
  for (const childId of childIds) {
    const childNode = nodes[childId as AnyNodeId]
    if (!childNode) continue
    if (!nodeRegistry.get(childNode.type)?.capabilities?.roofAccessory) continue
    const obj = sceneRegistry.nodes.get(childId)
    if (!obj) continue
    parts.push(`${childId}:${obj.matrixWorld.elements.map((n) => n.toFixed(3)).join(',')}`)
  }
  return parts.join('|')
}

// Renders the cutaway section cut (material fill + cut-edge outline) for the
// active trim planes, in segment-local space (mounted under the
// segment-world-matrix group). The fill is the CSG intersection of the
// untrimmed roof shell (and every hosted accessory) with a thin slab at each
// cut line, so only real material is shown and the hollow attic stays empty;
// the outline is the analytic surface edge.
function SectionCut({ segment, planes }: { segment: RoofSegmentNode; planes: SectionPlaneSpec[] }) {
  const shapeKey = segmentShapeKey(segment)
  const accessoryKey = accessorySectionKey(segment)

  const geometries = useMemo(() => {
    if (planes.length === 0) return null
    const accessoryGeometries = collectAccessorySectionGeometries(segment)
    const result = buildSectionGeometries(segment, planes, accessoryGeometries)
    for (const g of accessoryGeometries) g.dispose()
    return result
    // Recompute when the roof shape (shapeKey), the cut lines (planes), or the
    // hosted accessories (accessoryKey) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, planes.length, planes])

  useEffect(() => {
    return () => {
      geometries?.fill.dispose()
      geometries?.outline.dispose()
    }
  }, [geometries])

  if (!geometries) return null

  return (
    <group layers={EDITOR_LAYER}>
      <mesh
        geometry={geometries.fill}
        layers={EDITOR_LAYER}
        material={sectionFillMaterial}
        raycast={() => null}
        renderOrder={SECTION_FILL_RENDER_ORDER}
      />
      <lineSegments
        frustumCulled={false}
        geometry={geometries.outline}
        layers={EDITOR_LAYER}
        material={sectionOutlineMaterial}
        renderOrder={SECTION_OUTLINE_RENDER_ORDER}
      />
    </group>
  )
}

function HoveredRoofSegmentOutlineProxy() {
  const hoveredId = useViewer((s) => s.hoveredId)
  const segment = useScene((s) => {
    if (!hoveredId) return null
    const node = s.nodes[hoveredId as AnyNodeId]
    return node?.type === 'roof-segment' ? (node as RoofSegmentNode) : null
  })
  const nodes = useScene((s) => s.nodes)
  const ref = useRef<THREE.Mesh>(null)

  const geometry = useMemo(() => {
    if (!segment) return null
    return generateRoofSegmentGeometry(segment, nodes)
  }, [nodes, segment])
  const source = segment ? (sceneRegistry.nodes.get(segment.id) ?? null) : null
  const roofRoot =
    segment?.parentId && nodes[segment.parentId as AnyNodeId]?.type === 'roof'
      ? (sceneRegistry.nodes.get(segment.parentId) ?? null)
      : null

  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])

  useFrame(() => {
    const mesh = ref.current
    if (!(mesh && source && roofRoot)) return
    source.updateWorldMatrix(true, false)
    roofRoot.updateWorldMatrix(true, false)
    mesh.matrix.copy(roofRoot.matrixWorld).invert().multiply(source.matrixWorld)
    mesh.matrixAutoUpdate = false
  })

  if (!(source && geometry && roofRoot && segment)) return null

  return createPortal(
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={EDITOR_LAYER}
      material={hoverOutlineProxyMaterial}
      matrixAutoUpdate={false}
      name={getHoveredRoofSegmentOutlineProxyName(segment.id)}
      raycast={() => null}
      ref={ref}
    />,
    roofRoot,
  )
}

const _dragNdc = new THREE.Vector2()
const _dragRaycaster = new THREE.Raycaster()
const _dragPlaneHit = new THREE.Vector3()
const _dragLocalPoint = new THREE.Vector3()
const _dragInverseMatrix = new THREE.Matrix4()
const _trimHitInverseMatrix = new THREE.Matrix4()
const _trimHitRay = new THREE.Ray()
const _trimHitBox = new THREE.Box3()
const _trimHitPoint = new THREE.Vector3()

function makeExpandedTrimRaycast(
  visualScale: readonly [number, number, number],
  hitScale: readonly [number, number, number],
) {
  const halfX = Math.max(0.5, hitScale[0] / Math.max(visualScale[0], 1e-6) / 2)
  const halfY = Math.max(0.5, hitScale[1] / Math.max(visualScale[1], 1e-6) / 2)
  const halfZ = Math.max(0.5, hitScale[2] / Math.max(visualScale[2], 1e-6) / 2)
  return function expandedTrimRaycast(
    this: THREE.Mesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) {
    _trimHitInverseMatrix.copy(this.matrixWorld).invert()
    _trimHitRay.copy(raycaster.ray).applyMatrix4(_trimHitInverseMatrix)
    _trimHitBox.min.set(-halfX, -halfY, -halfZ)
    _trimHitBox.max.set(halfX, halfY, halfZ)
    const localHit = _trimHitRay.intersectBox(_trimHitBox, _trimHitPoint)
    if (!localHit) return
    const point = localHit.clone().applyMatrix4(this.matrixWorld)
    const distance = raycaster.ray.origin.distanceTo(point)
    if (distance < raycaster.near || distance > raycaster.far) return
    intersects.push({ distance, point, object: this })
  }
}

function trimEquals(a: RoofSegmentTrim, b: RoofSegmentTrim): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.front === b.front &&
    a.back === b.back &&
    a.frontLeft === b.frontLeft &&
    a.frontRight === b.frontRight &&
    a.backLeft === b.backLeft &&
    a.backRight === b.backRight &&
    a.frontLeftX === b.frontLeftX &&
    a.frontLeftZ === b.frontLeftZ &&
    a.frontRightX === b.frontRightX &&
    a.frontRightZ === b.frontRightZ &&
    a.backLeftX === b.backLeftX &&
    a.backLeftZ === b.backLeftZ &&
    a.backRightX === b.backRightX &&
    a.backRightZ === b.backRightZ
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isDiagonalTrimSide(side: RoofTrimSide): side is DiagonalTrimSide {
  return (
    side === 'frontLeft' || side === 'frontRight' || side === 'backLeft' || side === 'backRight'
  )
}

function getDiagonalAxisKeys(side: DiagonalTrimSide): [DiagonalTrimAxisKey, DiagonalTrimAxisKey] {
  switch (side) {
    case 'frontLeft':
      return ['frontLeftX', 'frontLeftZ']
    case 'frontRight':
      return ['frontRightX', 'frontRightZ']
    case 'backLeft':
      return ['backLeftX', 'backLeftZ']
    case 'backRight':
      return ['backRightX', 'backRightZ']
  }
}

function getDiagonalResetCorner(side: RoofTrimSide): DiagonalTrimSide | null {
  if (isDiagonalTrimSide(side)) return side
  if (side.endsWith('X') || side.endsWith('Z')) {
    return getDiagonalAxisCorner(side as DiagonalTrimAxisSide)
  }
  return null
}

function getDiagonalAxisCorner(side: DiagonalTrimAxisSide): DiagonalTrimSide {
  if (side === 'frontLeftX' || side === 'frontLeftZ') return 'frontLeft'
  if (side === 'frontRightX' || side === 'frontRightZ') return 'frontRight'
  if (side === 'backLeftX' || side === 'backLeftZ') return 'backLeft'
  return 'backRight'
}

function getOppositeDiagonalAxis(side: DiagonalTrimAxisKey): DiagonalTrimAxisKey {
  switch (side) {
    case 'frontLeftX':
      return 'frontRightX'
    case 'frontRightX':
      return 'frontLeftX'
    case 'backLeftX':
      return 'backRightX'
    case 'backRightX':
      return 'backLeftX'
    case 'frontLeftZ':
      return 'backLeftZ'
    case 'backLeftZ':
      return 'frontLeftZ'
    case 'frontRightZ':
      return 'backRightZ'
    case 'backRightZ':
      return 'frontRightZ'
  }
}

function getMaxDiagonalAxisTrim(
  segment: RoofSegmentNode,
  trim: RoofSegmentTrim,
  axis: DiagonalTrimAxisKey,
): number {
  const keptWidth = Math.max(0, segment.width - trim.left - trim.right)
  const keptDepth = Math.max(0, segment.depth - trim.front - trim.back)
  const opposite = trim[getOppositeDiagonalAxis(axis)]
  const span = axis.endsWith('X') ? keptWidth : keptDepth
  return Math.max(0, span - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
}

function getStarterDiagonalTrim(segment: RoofSegmentNode, trim: RoofSegmentTrim): number {
  const keptWidth = Math.max(0, segment.width - trim.left - trim.right)
  const keptDepth = Math.max(0, segment.depth - trim.front - trim.back)
  const maxDiagonalTrim = Math.max(0, Math.min(keptWidth, keptDepth) - MIN_ROOF_SEGMENT_TRIM_SPAN)
  return Math.min(maxDiagonalTrim, Math.max(0.75, maxDiagonalTrim * 0.2))
}

function patchTrimSide(
  segment: RoofSegmentNode,
  baseTrim: RoofSegmentTrim,
  side: RoofTrimSide,
  rawValue: number,
): RoofSegmentTrim {
  const next = { ...baseTrim }
  if (side === 'left' || side === 'right') {
    const opposite = side === 'left' ? baseTrim.right : baseTrim.left
    const max = Math.max(0, segment.width - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
    next[side] = clamp(rawValue, 0, max)
  } else {
    if (isDiagonalTrimSide(side)) {
      const [xAxis, zAxis] = getDiagonalAxisKeys(side)
      next[xAxis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, xAxis))
      next[zAxis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, zAxis))
      next[side] = Math.min(next[xAxis], next[zAxis])
      return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
    }

    if (side.endsWith('X') || side.endsWith('Z')) {
      const axis = side as DiagonalTrimAxisKey
      const corner = getDiagonalAxisCorner(axis)
      const [xAxis, zAxis] = getDiagonalAxisKeys(corner)
      const otherAxis = axis === xAxis ? zAxis : xAxis
      const starter = getStarterDiagonalTrim(segment, baseTrim)
      next[axis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, axis))
      if (next[otherAxis] <= 0 && next[corner] <= 0) {
        next[otherAxis] = Math.min(starter, getMaxDiagonalAxisTrim(segment, baseTrim, otherAxis))
      }
      next[corner] = Math.min(next[xAxis], next[zAxis])
      return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
    }

    const opposite = side === 'front' ? baseTrim.back : baseTrim.front
    const max = Math.max(0, segment.depth - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
    next[side] = clamp(rawValue, 0, max)
  }

  return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
}

function patchTrimSideByDelta(
  segment: RoofSegmentNode,
  baseTrim: RoofSegmentTrim,
  side: RoofTrimSide,
  delta: number,
): RoofSegmentTrim {
  if (isDiagonalTrimSide(side)) {
    const [xAxis, zAxis] = getDiagonalAxisKeys(side)
    const next = { ...baseTrim }
    next[xAxis] = clamp(
      baseTrim[xAxis] + delta,
      0,
      getMaxDiagonalAxisTrim(segment, baseTrim, xAxis),
    )
    next[zAxis] = clamp(
      baseTrim[zAxis] + delta,
      0,
      getMaxDiagonalAxisTrim(segment, baseTrim, zAxis),
    )
    next[side] = Math.min(next[xAxis], next[zAxis])
    return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
  }

  const baseValue = baseTrim[side]
  return patchTrimSide(segment, baseTrim, side, baseValue + delta)
}

function getTrimValueFromLocalPoint(
  segment: RoofSegmentNode,
  baseTrim: RoofSegmentTrim,
  side: RoofTrimSide,
  localPoint: THREE.Vector3,
): number {
  const leftX = -segment.width / 2 + baseTrim.left
  const rightX = segment.width / 2 - baseTrim.right
  const frontZ = segment.depth / 2 - baseTrim.front
  const backZ = -segment.depth / 2 + baseTrim.back

  switch (side) {
    case 'left':
      return localPoint.x + segment.width / 2
    case 'right':
      return segment.width / 2 - localPoint.x
    case 'front':
      return segment.depth / 2 - localPoint.z
    case 'back':
      return localPoint.z + segment.depth / 2
    case 'frontLeft':
      return localPoint.x - leftX + (frontZ - localPoint.z)
    case 'frontRight':
      return rightX - localPoint.x + (frontZ - localPoint.z)
    case 'backLeft':
      return localPoint.x - leftX + (localPoint.z - backZ)
    case 'backRight':
      return rightX - localPoint.x + (localPoint.z - backZ)
    case 'frontLeftX':
      return localPoint.x - leftX
    case 'frontLeftZ':
      return frontZ - localPoint.z
    case 'frontRightX':
      return rightX - localPoint.x
    case 'frontRightZ':
      return frontZ - localPoint.z
    case 'backLeftX':
      return localPoint.x - leftX
    case 'backLeftZ':
      return localPoint.z - backZ
    case 'backRightX':
      return rightX - localPoint.x
    case 'backRightZ':
      return localPoint.z - backZ
  }
}

function getTrimLabel(side: RoofTrimSide): string {
  switch (side) {
    case 'left':
      return 'trim left'
    case 'right':
      return 'trim right'
    case 'front':
      return 'trim front'
    case 'back':
      return 'trim back'
    case 'frontLeft':
      return 'trim front left diagonal'
    case 'frontRight':
      return 'trim front right diagonal'
    case 'backLeft':
      return 'trim back left diagonal'
    case 'backRight':
      return 'trim back right diagonal'
    case 'frontLeftX':
      return 'trim front left diagonal width'
    case 'frontLeftZ':
      return 'trim front left diagonal depth'
    case 'frontRightX':
      return 'trim front right diagonal width'
    case 'frontRightZ':
      return 'trim front right diagonal depth'
    case 'backLeftX':
      return 'trim back left diagonal width'
    case 'backLeftZ':
      return 'trim back left diagonal depth'
    case 'backRightX':
      return 'trim back right diagonal width'
    case 'backRightZ':
      return 'trim back right diagonal depth'
  }
}

function getTrimCursor(side: RoofTrimSide): string {
  switch (side) {
    case 'left':
    case 'right':
      return 'ew-resize'
    case 'front':
    case 'back':
      return 'ns-resize'
    case 'frontLeft':
    case 'backRight':
      return 'nwse-resize'
    case 'frontRight':
    case 'backLeft':
      return 'nesw-resize'
    case 'frontLeftX':
    case 'frontRightX':
    case 'backLeftX':
    case 'backRightX':
      return 'ew-resize'
    case 'frontLeftZ':
    case 'frontRightZ':
    case 'backLeftZ':
    case 'backRightZ':
      return 'ns-resize'
  }
}

function shouldShowTrimPlanes(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).showTrimPlanes === true
  )
}

function commitSegmentTrim(segment: RoofSegmentNode, trim: RoofSegmentTrim) {
  const scene = useScene.getState()
  scene.applyNodeChanges({
    update: [{ id: segment.id as AnyNodeId, data: { trim } as Partial<AnyNode> }],
  })
}

function RoofTrimHandles() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] as AnyNodeId) : null
  const segment = useScene((s) => {
    if (!selectedId) return null
    const node = s.nodes[selectedId]
    return node?.type === 'roof-segment' ? (node as RoofSegmentNode) : null
  })
  const readOnly = useScene((s) => s.readOnly)
  const liveOverrideKey = useLiveNodeOverrides((s) =>
    segment ? JSON.stringify(s.overrides.get(segment.id) ?? null) : null,
  )
  const [hoveredSide, setHoveredSide] = useState<RoofTrimSide | null>(null)
  const [draggingSide, setDraggingSide] = useState<RoofTrimSide | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const { camera, gl } = useThree()
  const zoom = camera instanceof THREE.OrthographicCamera ? 1 / camera.zoom : 1
  const handleBaseScale = zoom * TRIM_HANDLE_BASE_SCALE

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const liveSegment = useMemo(() => {
    if (!segment) return null
    void liveOverrideKey
    return getEffectiveNode(segment)
  }, [segment, liveOverrideKey])

  useFrame(() => {
    if (!liveSegment || !groupRef.current) return
    const source = sceneRegistry.nodes.get(liveSegment.id)
    if (!source) return
    source.updateWorldMatrix(true, false)
    groupRef.current.matrix.copy(source.matrixWorld)
    groupRef.current.matrixAutoUpdate = false
  })

  const showTrimPlanes = shouldShowTrimPlanes(liveSegment?.metadata)

  if (readOnly || !segment || !liveSegment || !showTrimPlanes) return null

  const trim = normalizeRoofSegmentTrim(liveSegment)
  const activeRh = getActiveRoofHeight(liveSegment)
  const handleY = Math.max(0.45, liveSegment.wallHeight + activeRh + 0.45)
  const keptWidth = Math.max(0.01, liveSegment.width - trim.left - trim.right)
  const keptDepth = Math.max(0.01, liveSegment.depth - trim.front - trim.back)
  const leftX = -liveSegment.width / 2 + trim.left
  const rightX = liveSegment.width / 2 - trim.right
  const frontZ = liveSegment.depth / 2 - trim.front
  const backZ = -liveSegment.depth / 2 + trim.back
  const visibleBounds = getTrimVisibleTopBounds({
    ...liveSegment,
    trim: {
      ...trim,
      frontLeft: 0,
      frontRight: 0,
      backLeft: 0,
      backRight: 0,
      frontLeftX: 0,
      frontLeftZ: 0,
      frontRightX: 0,
      frontRightZ: 0,
      backLeftX: 0,
      backLeftZ: 0,
      backRightX: 0,
      backRightZ: 0,
    },
  })
  const visibleCenterX = (visibleBounds.minX + visibleBounds.maxX) / 2
  const visibleCenterZ = (visibleBounds.minZ + visibleBounds.maxZ) / 2
  const visibleWidth = Math.max(0.01, visibleBounds.maxX - visibleBounds.minX)
  const visibleDepth = Math.max(0.01, visibleBounds.maxZ - visibleBounds.minZ)
  const visualLeftX = trim.left > 0 ? leftX : visibleBounds.minX
  const visualRightX = trim.right > 0 ? rightX : visibleBounds.maxX
  const visualFrontZ = trim.front > 0 ? frontZ : visibleBounds.maxZ
  const visualBackZ = trim.back > 0 ? backZ : visibleBounds.minZ
  const maxDiagonalTrim = Math.max(0, Math.min(keptWidth, keptDepth) - MIN_ROOF_SEGMENT_TRIM_SPAN)

  const pointOnTrimLineAtX = (
    start: readonly [number, number],
    end: readonly [number, number],
    x: number,
  ): [number, number] => {
    const dx = end[0] - start[0]
    if (Math.abs(dx) < 1e-6) return [x, start[1]]
    const t = (x - start[0]) / dx
    return [x, start[1] + (end[1] - start[1]) * t]
  }

  const pointOnTrimLineAtZ = (
    start: readonly [number, number],
    end: readonly [number, number],
    z: number,
  ): [number, number] => {
    const dz = end[1] - start[1]
    if (Math.abs(dz) < 1e-6) return [start[0], z]
    const t = (z - start[1]) / dz
    return [start[0] + (end[0] - start[0]) * t, z]
  }

  const getDiagonalRailLine = (
    side: DiagonalTrimSide,
    start: readonly [number, number],
    end: readonly [number, number],
  ): [[number, number], [number, number]] => {
    switch (side) {
      case 'frontLeft':
        return [
          pointOnTrimLineAtZ(start, end, visualFrontZ),
          pointOnTrimLineAtX(start, end, visualLeftX),
        ]
      case 'frontRight':
        return [
          pointOnTrimLineAtX(start, end, visualRightX),
          pointOnTrimLineAtZ(start, end, visualFrontZ),
        ]
      case 'backLeft':
        return [
          pointOnTrimLineAtX(start, end, visualLeftX),
          pointOnTrimLineAtZ(start, end, visualBackZ),
        ]
      case 'backRight':
        return [
          pointOnTrimLineAtZ(start, end, visualBackZ),
          pointOnTrimLineAtX(start, end, visualRightX),
        ]
    }
  }

  // Cross-section planes the active trim cuts expose. Slice the live roof
  // mesh just inside the kept material (the cut sits coplanar with the mesh's
  // own face otherwise) so the cutaway shows real construction layers.
  const sectionPlanes: SectionPlaneSpec[] = []
  // Inside reference: the kept-region center, on the kept side of every cut so
  // the inset always shifts the slice into solid material.
  const insideRef: readonly [number, number] = [0, 0]
  if (trim.left > 0) {
    sectionPlanes.push(
      makeSectionPlane(leftX, visualBackZ, leftX, visualFrontZ, SECTION_PLANE_INSET, insideRef),
    )
  }
  if (trim.right > 0) {
    sectionPlanes.push(
      makeSectionPlane(rightX, visualBackZ, rightX, visualFrontZ, SECTION_PLANE_INSET, insideRef),
    )
  }
  if (trim.front > 0) {
    sectionPlanes.push(
      makeSectionPlane(visualLeftX, frontZ, visualRightX, frontZ, SECTION_PLANE_INSET, insideRef),
    )
  }
  if (trim.back > 0) {
    sectionPlanes.push(
      makeSectionPlane(visualLeftX, backZ, visualRightX, backZ, SECTION_PLANE_INSET, insideRef),
    )
  }

  // Diagonal/corner cuts run at an angle, so they need a generic vertical
  // plane through the corner cut line. The endpoints match the rail line
  // geometry in renderDiagonalTrimPlane (start/end before the visual-bounds
  // extension; only direction matters for slicing).
  const diagonalCutLine = (side: DiagonalTrimSide): [[number, number], [number, number]] | null => {
    const [xKey, zKey] = getDiagonalAxisKeys(side)
    const dx = trim[xKey]
    const dz = trim[zKey]
    if (!(dx > 0 && dz > 0)) return null
    switch (side) {
      case 'frontLeft':
        return [
          [leftX + dx, frontZ],
          [leftX, frontZ - dz],
        ]
      case 'frontRight':
        return [
          [rightX, frontZ - dz],
          [rightX - dx, frontZ],
        ]
      case 'backLeft':
        return [
          [leftX, backZ + dz],
          [leftX + dx, backZ],
        ]
      case 'backRight':
        return [
          [rightX - dx, backZ],
          [rightX, backZ + dz],
        ]
    }
  }
  for (const side of ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const) {
    const line = diagonalCutLine(side)
    if (!line) continue
    const [s, e] = line
    const [railStart, railEnd] = getDiagonalRailLine(side, s, e)
    sectionPlanes.push(
      makeSectionPlane(
        railStart[0],
        railStart[1],
        railEnd[0],
        railEnd[1],
        SECTION_PLANE_INSET,
        insideRef,
      ),
    )
  }

  const resetDiagonalTrim = (side: RoofTrimSide, event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const corner = getDiagonalResetCorner(side)
    if (!corner) return

    const baseSegment = getEffectiveNode(segment)
    const baseTrim = normalizeRoofSegmentTrim(baseSegment)
    const next = { ...baseTrim }
    const [xAxis, zAxis] = getDiagonalAxisKeys(corner)
    next[corner] = 0
    next[xAxis] = 0
    next[zAxis] = 0
    const normalized = normalizeRoofSegmentTrim({
      width: baseSegment.width,
      depth: baseSegment.depth,
      trim: next,
    })
    useLiveNodeOverrides.getState().clear(segment.id as AnyNodeId)
    if (!trimEquals(normalized, baseTrim)) {
      commitSegmentTrim(baseSegment, normalized)
    }
    useScene.getState().markDirty(segment.id as AnyNodeId)
  }

  const startDrag = (side: RoofTrimSide, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const source = sceneRegistry.nodes.get(segment.id)
    if (!source) return

    source.updateWorldMatrix(true, false)
    const startMatrix = source.matrixWorld.clone()
    _dragInverseMatrix.copy(startMatrix).invert()
    const dragPlanePoint = new THREE.Vector3(0, handleY, 0).applyMatrix4(startMatrix)
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragPlanePoint.y)
    const baseSegment = getEffectiveNode(segment)
    const baseTrim = normalizeRoofSegmentTrim(baseSegment)
    const segmentId = segment.id as AnyNodeId
    let pendingTrim = baseTrim
    let lastDirtyMarkAt = 0
    let pendingDirtyTimeout: number | null = null

    const clearPendingDirtyTimeout = () => {
      if (pendingDirtyTimeout === null) return
      window.clearTimeout(pendingDirtyTimeout)
      pendingDirtyTimeout = null
    }

    const flushDirtyMark = () => {
      clearPendingDirtyTimeout()
      lastDirtyMarkAt = performance.now()
      useScene.getState().markDirty(segmentId)
    }

    const scheduleDirtyMark = () => {
      const now = performance.now()
      if (now - lastDirtyMarkAt >= TRIM_LIVE_REBUILD_INTERVAL_MS) {
        flushDirtyMark()
        return
      }
      if (pendingDirtyTimeout !== null) return
      pendingDirtyTimeout = window.setTimeout(
        () => {
          flushDirtyMark()
        },
        Math.max(0, TRIM_LIVE_REBUILD_INTERVAL_MS - (now - lastDirtyMarkAt)),
      )
    }

    const getPointerTrimValue = (clientX: number, clientY: number): number | null => {
      const rect = gl.domElement.getBoundingClientRect()
      _dragNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
      _dragRaycaster.setFromCamera(_dragNdc, camera)
      if (!_dragRaycaster.ray.intersectPlane(dragPlane, _dragPlaneHit)) return null
      _dragLocalPoint.copy(_dragPlaneHit).applyMatrix4(_dragInverseMatrix)
      return getTrimValueFromLocalPoint(baseSegment, baseTrim, side, _dragLocalPoint)
    }

    const initialPointerValue = getPointerTrimValue(event.clientX, event.clientY)
    if (initialPointerValue === null) return

    document.body.style.cursor = getTrimCursor(side)
    setDraggingSide(side)
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: segmentId, handle: getTrimLabel(side) })
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()

    const updateFromPointer = (clientX: number, clientY: number) => {
      const pointerValue = getPointerTrimValue(clientX, clientY)
      if (pointerValue === null) return
      pendingTrim = patchTrimSideByDelta(
        baseSegment,
        baseTrim,
        side,
        pointerValue - initialPointerValue,
      )
      useLiveNodeOverrides.getState().set(segmentId, { trim: pendingTrim })
      // Coalesce live merged-shell rebuilds during trim drag. The override
      // still updates every pointer move for local trim affordances, but the
      // full roof CSG only refreshes at a capped cadence instead of at raw
      // pointer-event frequency.
      scheduleDirtyMark()
    }

    updateFromPointer(event.clientX, event.clientY)

    const cleanup = () => {
      clearPendingDirtyTimeout()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (
        document.body.style.cursor === 'ew-resize' ||
        document.body.style.cursor === 'ns-resize' ||
        document.body.style.cursor === 'nwse-resize' ||
        document.body.style.cursor === 'nesw-resize' ||
        document.body.style.cursor === 'move'
      ) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === segmentId)
      useViewer.getState().setInputDragging(false)
      setDraggingSide(null)
      dragCleanupRef.current = null
    }

    const onMove = (moveEvent: PointerEvent) => {
      updateFromPointer(moveEvent.clientX, moveEvent.clientY)
    }

    const onUp = () => {
      swallowNextClick()
      if (!trimEquals(pendingTrim, baseTrim)) {
        commitSegmentTrim(baseSegment, pendingTrim)
      }
      useLiveNodeOverrides.getState().clear(segmentId)
      flushDirtyMark()
      cleanup()
    }

    const onCancel = () => {
      useLiveNodeOverrides.getState().clear(segmentId)
      flushDirtyMark()
      cleanup()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const renderTrimPlane = (
    side: RoofTrimSide,
    position: [number, number, number],
    args: [number, number],
    rotation: [number, number, number] = [0, 0, 0],
    handles: readonly { side: RoofTrimSide; offsetX: number }[] = [{ side, offsetX: 0 }],
    showPlane = true,
  ) => {
    const [planeWidth, planeHeight] = args
    const isHovered = handles.some((handle) => handle.side === hoveredSide)
    const railY = planeHeight / 2
    const railVisualHeight = Math.max(0.012, handleBaseScale * 0.022)
    const railVisualDepth = Math.max(0.01, handleBaseScale * 0.018)
    const railVisualLength = planeWidth + railVisualDepth * 2
    const capSize = Math.max(0.045, handleBaseScale * 0.085)
    const primaryHandle = handles[0] ?? { side, offsetX: 0 }
    const endpointHandles = handles.slice(1)

    const renderRailHitTarget = (
      handle: { side: RoofTrimSide; offsetX: number },
      scale: [number, number, number],
      visual: 'rail' | 'cap',
    ) => {
      const hovered = hoveredSide === handle.side
      const visualScale: [number, number, number] =
        visual === 'rail' ? scale : [capSize, capSize, capSize]
      const hitScale: [number, number, number] =
        visual === 'rail'
          ? [scale[0], TRIM_RAIL_HIT_HEIGHT, TRIM_RAIL_HIT_DEPTH]
          : [TRIM_CAP_HIT_SIZE, TRIM_CAP_HIT_SIZE, TRIM_CAP_HIT_SIZE]
      const resetCorner = getDiagonalResetCorner(handle.side)
      return (
        <group key={handle.side} position={[handle.offsetX, railY, TRIM_RAIL_SURFACE_OFFSET]}>
          <mesh
            geometry={visual === 'rail' ? TRIM_UNIT_RAIL_GEOMETRY : TRIM_UNIT_RAIL_CAP_GEOMETRY}
            layers={EDITOR_LAYER}
            material={
              visual === 'rail'
                ? hovered
                  ? trimRailHoverMaterial
                  : trimRailMaterial
                : hovered
                  ? trimCapHoverMaterial
                  : trimCapMaterial
            }
            raycast={makeExpandedTrimRaycast(visualScale, hitScale)}
            onDoubleClick={
              resetCorner ? (event) => resetDiagonalTrim(handle.side, event) : undefined
            }
            onPointerDown={(event) => startDrag(handle.side, event)}
            onPointerEnter={(event) => {
              event.stopPropagation()
              setHoveredSide(handle.side)
              document.body.style.cursor = getTrimCursor(handle.side)
            }}
            onPointerLeave={(event) => {
              event.stopPropagation()
              if (!dragCleanupRef.current) {
                setHoveredSide((current) => (current === handle.side ? null : current))
                document.body.style.cursor = ''
              }
            }}
            renderOrder={TRIM_RAIL_RENDER_ORDER}
            scale={visualScale}
          />
        </group>
      )
    }

    return (
      <group
        key={side}
        layers={EDITOR_LAYER}
        position={position}
        rotation={rotation}
        renderOrder={TRIM_RAIL_RENDER_ORDER}
      >
        {showPlane ? (
          <mesh
            geometry={TRIM_UNIT_PLANE_GEOMETRY}
            layers={EDITOR_LAYER}
            material={isHovered ? trimPlaneHoverMaterial : trimPlaneMaterial}
            raycast={() => null}
            renderOrder={TRIM_PLANE_RENDER_ORDER}
            scale={[planeWidth, planeHeight, 1]}
          />
        ) : null}

        {renderRailHitTarget(
          primaryHandle,
          [railVisualLength, railVisualHeight, railVisualDepth],
          'rail',
        )}
        {endpointHandles.map((handle) =>
          renderRailHitTarget(handle, [capSize, capSize, capSize], 'cap'),
        )}
      </group>
    )
  }

  const renderDiagonalAddHandle = (side: DiagonalTrimSide) => {
    if (maxDiagonalTrim <= 0) return null

    let position: [number, number, number]
    let xDir = 1
    let zDir = 1
    switch (side) {
      case 'frontLeft':
        position = [leftX, handleY, frontZ]
        xDir = 1
        zDir = -1
        break
      case 'frontRight':
        position = [rightX, handleY, frontZ]
        xDir = -1
        zDir = -1
        break
      case 'backLeft':
        position = [leftX, handleY, backZ]
        xDir = 1
        zDir = 1
        break
      case 'backRight':
        position = [rightX, handleY, backZ]
        xDir = -1
        zDir = 1
        break
      default:
        return null
    }

    const hovered = hoveredSide === side
    const addSize = Math.max(0.055, handleBaseScale * 0.1)
    const addVisualScale: [number, number, number] = [addSize, addSize, addSize]
    const addHitScale: [number, number, number] = [
      TRIM_CAP_HIT_SIZE,
      TRIM_CAP_HIT_SIZE,
      TRIM_CAP_HIT_SIZE,
    ]
    const bracketLength = Math.min(0.55, Math.max(0.28, maxDiagonalTrim * 0.22))
    const bracketHeight = Math.max(0.012, handleBaseScale * 0.022)
    const bracketDepth = Math.max(0.01, handleBaseScale * 0.018)
    const bracketArmLength = bracketLength + bracketDepth
    const bracketVisualScale: [number, number, number] = [
      bracketArmLength,
      bracketHeight,
      bracketDepth,
    ]
    const bracketHitScale: [number, number, number] = [
      bracketArmLength,
      TRIM_RAIL_HIT_HEIGHT,
      TRIM_RAIL_HIT_DEPTH,
    ]
    const previewAmount = getStarterDiagonalTrim(liveSegment, trim)

    let previewStart: [number, number]
    let previewEnd: [number, number]
    switch (side) {
      case 'frontLeft':
        previewStart = [leftX + previewAmount, frontZ]
        previewEnd = [leftX, frontZ - previewAmount]
        break
      case 'frontRight':
        previewStart = [rightX, frontZ - previewAmount]
        previewEnd = [rightX - previewAmount, frontZ]
        break
      case 'backLeft':
        previewStart = [leftX, backZ + previewAmount]
        previewEnd = [leftX + previewAmount, backZ]
        break
      case 'backRight':
        previewStart = [rightX - previewAmount, backZ]
        previewEnd = [rightX, backZ + previewAmount]
        break
    }

    const [previewRailStart, previewRailEnd] = getDiagonalRailLine(side, previewStart, previewEnd)
    const previewDx = previewRailEnd[0] - previewRailStart[0]
    const previewDz = previewRailEnd[1] - previewRailStart[1]
    const previewWidth = Math.hypot(previewDx, previewDz)
    const previewYaw = Math.atan2(-previewDz, previewDx)
    const handlePointerEnter = (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      setHoveredSide(side)
      document.body.style.cursor = getTrimCursor(side)
    }
    const handlePointerLeave = (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      if (!dragCleanupRef.current) {
        setHoveredSide((current) => (current === side ? null : current))
        document.body.style.cursor = ''
      }
    }

    return (
      <group key={`${side}-add`} layers={EDITOR_LAYER}>
        {hovered && previewWidth > 0 ? (
          <group
            position={[
              (previewRailStart[0] + previewRailEnd[0]) / 2,
              handleY / 2,
              (previewRailStart[1] + previewRailEnd[1]) / 2,
            ]}
            rotation={[0, previewYaw, 0]}
          >
            <mesh
              geometry={TRIM_UNIT_RAIL_GEOMETRY}
              layers={EDITOR_LAYER}
              material={trimDiagonalPreviewRailMaterial}
              position={[0, handleY / 2, TRIM_RAIL_SURFACE_OFFSET]}
              raycast={() => null}
              renderOrder={TRIM_RAIL_RENDER_ORDER}
              scale={[previewWidth + bracketDepth * 2, bracketHeight, bracketDepth]}
            />
          </group>
        ) : null}

        <mesh
          geometry={TRIM_UNIT_RAIL_GEOMETRY}
          layers={EDITOR_LAYER}
          material={hovered ? trimRailHoverMaterial : trimRailMaterial}
          onDoubleClick={(event) => resetDiagonalTrim(side, event)}
          onPointerDown={(event) => startDrag(side, event)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          position={[position[0] + (xDir * bracketArmLength) / 2, position[1], position[2]]}
          raycast={makeExpandedTrimRaycast(bracketVisualScale, bracketHitScale)}
          renderOrder={TRIM_RAIL_RENDER_ORDER}
          scale={bracketVisualScale}
        />
        <mesh
          geometry={TRIM_UNIT_RAIL_GEOMETRY}
          layers={EDITOR_LAYER}
          material={hovered ? trimRailHoverMaterial : trimRailMaterial}
          onDoubleClick={(event) => resetDiagonalTrim(side, event)}
          onPointerDown={(event) => startDrag(side, event)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          position={[position[0], position[1], position[2] + (zDir * bracketArmLength) / 2]}
          raycast={makeExpandedTrimRaycast(bracketVisualScale, bracketHitScale)}
          renderOrder={TRIM_RAIL_RENDER_ORDER}
          rotation={[0, zDir > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          scale={bracketVisualScale}
        />
        <mesh
          geometry={TRIM_UNIT_ADD_GEOMETRY}
          layers={EDITOR_LAYER}
          material={hovered ? trimAddHoverMaterial : trimAddMaterial}
          onDoubleClick={(event) => resetDiagonalTrim(side, event)}
          onPointerDown={(event) => startDrag(side, event)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          position={position}
          raycast={makeExpandedTrimRaycast(addVisualScale, addHitScale)}
          renderOrder={TRIM_RAIL_RENDER_ORDER}
          scale={addVisualScale}
        />
      </group>
    )
  }

  const renderDiagonalTrimPlane = (side: DiagonalTrimSide, xAmount: number, zAmount: number) => {
    if (maxDiagonalTrim <= 0) {
      return null
    }

    if (!(xAmount > 0 && zAmount > 0)) {
      return renderDiagonalAddHandle(side)
    }

    const displayX = xAmount
    const displayZ = zAmount
    if (!(displayX > 0 && displayZ > 0)) return null

    let start: [number, number]
    let end: [number, number]
    let xOffset = 0
    let zOffset = 0
    const [xSide, zSide] = getDiagonalAxisKeys(side)
    switch (side) {
      case 'frontLeft':
        start = [leftX + displayX, frontZ]
        end = [leftX, frontZ - displayZ]
        xOffset = -1
        zOffset = 1
        break
      case 'frontRight':
        start = [rightX, frontZ - displayZ]
        end = [rightX - displayX, frontZ]
        zOffset = -1
        xOffset = 1
        break
      case 'backLeft':
        start = [leftX, backZ + displayZ]
        end = [leftX + displayX, backZ]
        zOffset = -1
        xOffset = 1
        break
      case 'backRight':
        start = [rightX - displayX, backZ]
        end = [rightX, backZ + displayZ]
        xOffset = -1
        zOffset = 1
        break
      default:
        return null
    }

    const [railStart, railEnd] = getDiagonalRailLine(side, start, end)
    const dx = railEnd[0] - railStart[0]
    const dz = railEnd[1] - railStart[1]
    const width = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dz, dx)
    return renderTrimPlane(
      side,
      [(railStart[0] + railEnd[0]) / 2, handleY / 2, (railStart[1] + railEnd[1]) / 2],
      [width, handleY],
      [0, yaw, 0],
      [
        { side, offsetX: 0 },
        { side: xSide, offsetX: (width / 2) * xOffset },
        { side: zSide, offsetX: (width / 2) * zOffset },
      ],
      false,
    )
  }

  return (
    <group ref={groupRef}>
      {sectionPlanes.length > 0 ? (
        <SectionCut planes={sectionPlanes} segment={liveSegment} />
      ) : null}
      {renderTrimPlane(
        'left',
        [visualLeftX, handleY / 2, visibleCenterZ],
        [visibleDepth, handleY],
        [0, Math.PI / 2, 0],
      )}
      {renderTrimPlane(
        'right',
        [visualRightX, handleY / 2, visibleCenterZ],
        [visibleDepth, handleY],
        [0, Math.PI / 2, 0],
      )}
      {renderTrimPlane(
        'front',
        [visibleCenterX, handleY / 2, visualFrontZ],
        [visibleWidth, handleY],
      )}
      {renderTrimPlane('back', [visibleCenterX, handleY / 2, visualBackZ], [visibleWidth, handleY])}
      {renderDiagonalTrimPlane('frontLeft', trim.frontLeftX, trim.frontLeftZ)}
      {renderDiagonalTrimPlane('frontRight', trim.frontRightX, trim.frontRightZ)}
      {renderDiagonalTrimPlane('backLeft', trim.backLeftX, trim.backLeftZ)}
      {renderDiagonalTrimPlane('backRight', trim.backRightX, trim.backRightZ)}
    </group>
  )
}

/**
 * Imperatively toggles the Three.js visibility of roof objects based on the
 * editor selection — without causing React re-renders in RoofRenderer.
 *
 * Full edit-mode (segment selected):
 *   - merged-roof mesh stays VISIBLE — it rebuilds live from each segment's
 *     trim override, so the edited cutaway matches the clean commit instead of
 *     exposing the per-segment meshes' abutting end-cap faces
 *   - segments-wrapper group stays hidden (handles render from RoofTrimHandles)
 *   - all children are marked dirty so RoofSystem rebuilds the merged shell
 *
 * Accessory-reveal mode (a dormer/chimney/etc. hosted on a segment is selected):
 *   - merged-roof mesh stays visible (we don't want the appearance to jump)
 *   - segments-wrapper group is shown ANYWAY so anything portaled into a
 *     segment's registered mesh (e.g. dormer in-world handle arrows that
 *     don't use `portal: 'grandparent'`) is no longer inheriting the
 *     wrapper's hidden flag
 *   - segment placeholder geometry is empty, so revealing the wrapper has
 *     no visible cost beyond letting the handle arrows render
 *
 * When deselected: merged-roof shown, segments-wrapper hidden.
 */
export const RoofEditSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const movingNode = useMovingNode()
  const prevActiveRoofIds = useRef(new Set<string>())
  const prevMovingRoofIds = useRef(new Set<string>())
  const prevRevealRoofIds = useRef(new Set<string>())

  useEffect(() => {
    const nodes = useScene.getState().nodes

    // Roofs where a segment itself is selected -> full edit mode (hide
    // merged, show wrapper).
    const activeRoofIds = new Set<string>()
    // Roofs where an accessory (dormer/chimney/etc.) is selected -> only
    // reveal the wrapper so handle portals into the segment mesh become
    // visible. Merged stays on.
    const revealRoofIds = new Set<string>()
    // Roofs whose selected segment is currently being moved in 3D. During this
    // transient state we reveal the wrapper so the moving segment mesh is
    // visible and hide the merged roof to avoid the duplicate shell fighting it.
    const movingRoofIds = new Set<string>()

    for (const id of selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (node.type === 'roof-segment' && node.parentId) {
        activeRoofIds.add(node.parentId)
        continue
      }
      // Walk up one level: if the parent is a roof-segment, this is a
      // hosted accessory and we want to reveal its grandparent roof's
      // wrapper. Two-step lookup keeps it scoped to roof children
      // without enumerating all accessory kinds.
      if (!node.parentId) continue
      const parent = nodes[node.parentId as AnyNodeId]
      if (parent?.type === 'roof-segment' && parent.parentId) {
        revealRoofIds.add(parent.parentId)
      }
    }

    if (movingNode?.type === 'roof-segment' && movingNode.parentId) {
      movingRoofIds.add(movingNode.parentId)
    }

    // Union of roofs that need ANY state change this tick.
    const roofIdsToUpdate = new Set([
      ...activeRoofIds,
      ...movingRoofIds,
      ...revealRoofIds,
      ...prevActiveRoofIds.current,
      ...prevMovingRoofIds.current,
      ...prevRevealRoofIds.current,
    ])

    for (const roofId of roofIdsToUpdate) {
      const group = sceneRegistry.nodes.get(roofId)
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeRoofIds.has(roofId)
      const isMoving = movingRoofIds.has(roofId)
      const isReveal = revealRoofIds.has(roofId)

      // Keep the clean merged shell visible during trim editing too (not just
      // when deselected). The merged shell rebuilds live from each segment's
      // trim override (RoofSystem reads getEffectiveNode), so the dragged
      // cutaway matches the commit. Showing the individual per-segment meshes
      // instead would expose their abutting end-cap faces (the white planes the
      // merged union removes) — exactly what the commit doesn't show.
      if (mergedMesh) mergedMesh.visible = !isMoving
      if (segmentsWrapper) segmentsWrapper.visible = isReveal || isMoving

      const roofNode = nodes[roofId as AnyNodeId] as RoofNode | undefined
      if (roofNode?.children?.length) {
        const wasActive = prevActiveRoofIds.current.has(roofId)
        const wasMoving = prevMovingRoofIds.current.has(roofId)
        const wasReveal = prevRevealRoofIds.current.has(roofId)
        if (isActive !== wasActive || isMoving !== wasMoving) {
          // Entering / exiting full edit mode: rebuild segment / merged
          // geometries. Segment-move reveal uses the same rebuild so any
          // wrapper mesh previously stripped to an empty placeholder is
          // restored before the drag begins.
          const { markDirty } = useScene.getState()
          for (const childId of roofNode.children) {
            markDirty(childId as AnyNodeId)
          }
        }
        // Entering reveal mode (and NOT also full-edit, which already
        // owns its own rebuild path): strip each segment mesh back to
        // an empty placeholder so the wrapper-now-visible doesn't
        // re-show stale CSG geometry from a previous segment edit.
        // Without this, the host segment's CSG cut renders ON TOP of
        // the merged-roof, doubling the dormer's cut shape and
        // bleeding the host wall material through the dormer body.
        if (isReveal && !isActive && !wasReveal && segmentsWrapper) {
          for (const child of segmentsWrapper.children) {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) continue
            mesh.geometry?.dispose()
            mesh.geometry = makeEmptySegmentGeometry()
          }
        }
      }
    }

    prevActiveRoofIds.current = activeRoofIds
    prevMovingRoofIds.current = movingRoofIds
    prevRevealRoofIds.current = revealRoofIds
  }, [movingNode, selectedIds])

  return (
    <>
      <HoveredRoofSegmentOutlineProxy />
      <RoofTrimHandles />
    </>
  )
}
