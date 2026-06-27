import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  getEffectiveNode,
  getRoofSegmentVisibleTopBounds,
  MIN_ROOF_SEGMENT_TRIM_SPAN,
  normalizeRoofSegmentTrim,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentTrim,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { generateRoofSegmentGeometry, useViewer } from '@pascal-app/viewer'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import useEditor from '../../../store/use-editor'
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
// Drawn by slicing the segment's REAL roof mesh (shingle + deck + walls,
// hollow attic between them) with the trim plane. Because the mesh carries
// material thickness, the slice yields the actual construction bands the cut
// exposes — roof layer + wall bands — not a single filled silhouette. The
// outline (cut line) is the star; a very faint fill adds subtle solidity.
const SECTION_FILL_COLOR = '#fbbf24'
const SECTION_OUTLINE_COLOR = '#f59e0b'
const SECTION_FILL_RENDER_ORDER = 1000
const SECTION_OUTLINE_RENDER_ORDER = 1002
// Slice just inside the kept material so the plane never sits coplanar with
// the mesh's own cut face (which would slice degenerately).
const SECTION_PLANE_INSET = 0.004
const SECTION_WELD_EPSILON = 1e-4

type SectionAxis = 'x' | 'z'
// Which trim sides cut on which axis, and the sign that points into kept
// material (left keeps +x, right keeps -x, etc.).
type SectionPlaneSpec = { axis: SectionAxis; value: number }

const sectionFillMaterial = new MeshBasicNodeMaterial({
  color: SECTION_FILL_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.08,
  side: THREE.DoubleSide,
  transparent: true,
})

const sectionOutlineMaterial = new LineBasicNodeMaterial({
  color: SECTION_OUTLINE_COLOR,
  depthTest: false,
  depthWrite: false,
  linewidth: 2,
  transparent: true,
})

type Seg2D = [number, number, number, number]

// Slice every triangle of a mesh geometry by an axis-aligned vertical plane,
// returning the crossing segments projected into the plane's 2D frame
// (u = the in-plane horizontal axis, v = world up) alongside the fixed
// coordinate so we can lift back to 3D.
function sliceGeometryByPlane(geometry: THREE.BufferGeometry, plane: SectionPlaneSpec): Seg2D[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return []
  const index = geometry.getIndex()
  const triCount = index ? index.count / 3 : pos.count / 3
  const segments: Seg2D[] = []

  const ax = plane.axis === 'x' ? 0 : 2 // fixed axis component
  const uAxis = plane.axis === 'x' ? 2 : 0 // in-plane horizontal → u

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    const tri = [i0, i1, i2]
    const fixed = [0, 0, 0]
    const us = [0, 0, 0]
    const vs = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const vi = tri[k]!
      fixed[k] = pos.getComponent(vi, ax)
      us[k] = pos.getComponent(vi, uAxis)
      vs[k] = pos.getComponent(vi, 1)
    }
    const d = [fixed[0]! - plane.value, fixed[1]! - plane.value, fixed[2]! - plane.value]
    // Intersection points where edges cross the plane.
    const hitU: number[] = []
    const hitV: number[] = []
    for (let e = 0; e < 3; e++) {
      const a = e
      const b = (e + 1) % 3
      const da = d[a]!
      const db = d[b]!
      if (da === 0) {
        hitU.push(us[a]!)
        hitV.push(vs[a]!)
      }
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const s = da / (da - db)
        hitU.push(us[a]! + (us[b]! - us[a]!) * s)
        hitV.push(vs[a]! + (vs[b]! - vs[a]!) * s)
      }
    }
    if (hitU.length >= 2) {
      segments.push([hitU[0]!, hitV[0]!, hitU[1]!, hitV[1]!])
    }
  }
  return segments
}

// Stitches loose 2D segments into closed loops (for fill triangulation).
function stitchSegments2D(segments: Seg2D[]): THREE.Vector2[][] {
  const remaining = segments.slice()
  const loops: THREE.Vector2[][] = []
  const close = (a: number, b: number) => Math.abs(a - b) <= SECTION_WELD_EPSILON

  while (remaining.length > 0) {
    const seed = remaining.shift()!
    const loop = [new THREE.Vector2(seed[0], seed[1]), new THREE.Vector2(seed[2], seed[3])]
    let grew = true
    while (grew) {
      grew = false
      const end = loop[loop.length - 1]!
      for (let i = 0; i < remaining.length; i++) {
        const [x1, y1, x2, y2] = remaining[i]!
        if (close(x1, end.x) && close(y1, end.y)) {
          loop.push(new THREE.Vector2(x2, y2))
          remaining.splice(i, 1)
          grew = true
          break
        }
        if (close(x2, end.x) && close(y2, end.y)) {
          loop.push(new THREE.Vector2(x1, y1))
          remaining.splice(i, 1)
          grew = true
          break
        }
      }
      const head = loop[0]!
      const tail = loop[loop.length - 1]!
      if (loop.length >= 3 && close(head.x, tail.x) && close(head.y, tail.y)) {
        loop.pop()
        break
      }
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function loopArea(loop: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!
    const q = loop[(i + 1) % loop.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function pointInLoop(pt: THREE.Vector2, loop: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const pi = loop[i]!
    const pj = loop[j]!
    if (
      pi.y > pt.y !== pj.y > pt.y &&
      pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside
    }
  }
  return inside
}

// Builds the combined fill + outline geometries (segment-local 3D) for all
// active trim planes by slicing the live roof mesh.
function buildSectionGeometries(
  geometry: THREE.BufferGeometry,
  planes: SectionPlaneSpec[],
): { fill: THREE.BufferGeometry; outline: THREE.BufferGeometry } | null {
  const outlinePositions: number[] = []
  const fillPositions: number[] = []

  // Lift a 2D plane-frame point (u, v) back to segment-local 3D.
  const lift = (axis: SectionAxis, value: number, u: number, v: number): [number, number, number] =>
    axis === 'x' ? [value, v, u] : [u, v, value]

  for (const plane of planes) {
    const segments = sliceGeometryByPlane(geometry, plane)
    if (segments.length === 0) continue

    for (const [u1, v1, u2, v2] of segments) {
      const a = lift(plane.axis, plane.value, u1, v1)
      const b = lift(plane.axis, plane.value, u2, v2)
      outlinePositions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }

    // Fill: stitch loops, classify holes by containment parity, triangulate.
    const loops = stitchSegments2D(segments)
    if (loops.length === 0) continue
    const enriched = loops.map((loop) => ({ loop, area: Math.abs(loopArea(loop)) }))
    enriched.sort((p, q) => q.area - p.area)
    const used = new Array(enriched.length).fill(false)

    for (let i = 0; i < enriched.length; i++) {
      if (used[i]) continue
      const outer = enriched[i]!.loop
      used[i] = true
      const holes: THREE.Vector2[][] = []
      for (let j = i + 1; j < enriched.length; j++) {
        if (used[j]) continue
        const cand = enriched[j]!.loop
        const probe = cand[0]!
        if (pointInLoop(probe, outer)) {
          holes.push(cand)
          used[j] = true
        }
      }
      const tris = THREE.ShapeUtils.triangulateShape(outer, holes)
      const all = [outer, ...holes].flat()
      for (const tri of tris) {
        for (const idx of tri) {
          const p = all[idx]
          if (!p) continue
          const [x, y, z] = lift(plane.axis, plane.value, p.x, p.y)
          fillPositions.push(x, y, z)
        }
      }
    }
  }

  if (outlinePositions.length === 0) return null

  const fill = new THREE.BufferGeometry()
  fill.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3))
  const outline = new THREE.BufferGeometry()
  outline.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3))
  return { fill, outline }
}

// Zeroed trim — slicing the FULL (uncut) roof volume at the trim plane gives
// the true cross-section silhouette of what the cut removes, instead of the
// already-cut mesh whose face sits coplanar with the plane.
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

// Shape fields that affect the segment's 3D volume. Trim is excluded on
// purpose — we always slice the untrimmed roof — so the (expensive) CSG
// rebuild only reruns when the roof's actual shape changes, not on every
// drag tick. The cheap re-slice below tracks the moving planes instead.
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
  ])
}

// Renders the cutaway bands (outline + faint fill) for the active trim
// planes, in segment-local space (mounted under the segment-world-matrix
// group). Generates the untrimmed segment volume itself and slices it, so the
// result is deterministic and independent of the registry mesh's rebuild
// timing (which lags a few frames behind a drag and may still hold the
// placeholder geometry).
function SectionCut({
  segment,
  planes,
}: {
  segment: RoofSegmentNode
  planes: SectionPlaneSpec[]
}) {
  const shapeKey = segmentShapeKey(segment)

  // Untrimmed segment volume — rebuilt only when the roof shape changes.
  const sliceSource = useMemo(() => {
    return generateRoofSegmentGeometry({ ...segment, trim: ZERO_TRIM })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey])

  useEffect(() => {
    return () => {
      sliceSource.dispose()
    }
  }, [sliceSource])

  const geometries = useMemo(() => {
    if (planes.length === 0) return null
    return buildSectionGeometries(sliceSource, planes)
    // Re-slice whenever the active planes change (drag / commit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceSource, JSON.stringify(planes)])

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
        material={sectionFillMaterial}
        raycast={() => null}
        renderOrder={SECTION_FILL_RENDER_ORDER}
      />
      <lineSegments
        frustumCulled={false}
        geometry={geometries.outline}
        material={sectionOutlineMaterial}
        renderOrder={SECTION_OUTLINE_RENDER_ORDER}
      />
    </group>
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
  const visibleBounds = getRoofSegmentVisibleTopBounds({
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

  // Cross-section planes the active trim cuts expose. Slice the live roof
  // mesh just inside the kept material (the cut sits coplanar with the mesh's
  // own face otherwise) so the cutaway shows real construction layers.
  const sectionPlanes: SectionPlaneSpec[] = []
  if (trim.left > 0) sectionPlanes.push({ axis: 'x', value: leftX + SECTION_PLANE_INSET })
  if (trim.right > 0) sectionPlanes.push({ axis: 'x', value: rightX - SECTION_PLANE_INSET })
  if (trim.front > 0) sectionPlanes.push({ axis: 'z', value: frontZ - SECTION_PLANE_INSET })
  if (trim.back > 0) sectionPlanes.push({ axis: 'z', value: backZ + SECTION_PLANE_INSET })

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
    useEditor.getState().setActiveHandleDrag({ nodeId: segmentId, label: getTrimLabel(side) })
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
    }

    updateFromPointer(event.clientX, event.clientY)

    const cleanup = () => {
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
      useEditor.getState().setActiveHandleDrag(null)
      useViewer.getState().setInputDragging(false)
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
      useScene.getState().markDirty(segmentId)
      cleanup()
    }

    const onCancel = () => {
      useLiveNodeOverrides.getState().clear(segmentId)
      useScene.getState().markDirty(segmentId)
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
 *   - merged-roof mesh is hidden
 *   - segments-wrapper group is shown (individual segments visible for editing)
 *   - all children are marked dirty so RoofSystem rebuilds their geometry
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
  const prevActiveRoofIds = useRef(new Set<string>())
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

    // Union of roofs that need ANY state change this tick.
    const roofIdsToUpdate = new Set([
      ...activeRoofIds,
      ...revealRoofIds,
      ...prevActiveRoofIds.current,
      ...prevRevealRoofIds.current,
    ])

    for (const roofId of roofIdsToUpdate) {
      const group = sceneRegistry.nodes.get(roofId)
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeRoofIds.has(roofId)
      const isReveal = revealRoofIds.has(roofId)

      if (mergedMesh) mergedMesh.visible = !isActive
      if (segmentsWrapper) segmentsWrapper.visible = isActive || isReveal

      const roofNode = nodes[roofId as AnyNodeId] as RoofNode | undefined
      if (roofNode?.children?.length) {
        const wasActive = prevActiveRoofIds.current.has(roofId)
        const wasReveal = prevRevealRoofIds.current.has(roofId)
        if (isActive !== wasActive) {
          // Entering / exiting full edit mode: rebuild segment / merged
          // geometries. Accessory-reveal doesn't need this — segments
          // keep their placeholder; only their visibility flips.
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
    prevRevealRoofIds.current = revealRoofIds
  }, [selectedIds])

  return <RoofTrimHandles />
}
