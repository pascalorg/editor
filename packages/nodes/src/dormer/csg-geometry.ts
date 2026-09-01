import {
  type DormerNode,
  dormerWallFacePointToDormer,
  getDormerWallFaceFrame,
  getPitchFromActiveRoofHeight,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
  type WindowNode,
} from '@pascal-app/core'
import {
  ADDITION,
  Brush,
  buildOpeningCutoutGeometry,
  computeGeometryBoundsTree,
  csgEvaluator,
  csgGeometry,
  csgMaterials,
  getRoofSegmentBrushes,
  mapRoofGroupMaterialIndex,
  prepareBrushForCSG,
  remapRoofShellFaces,
  roofCsgDummyMats,
  SUBTRACTION,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { buildDormerShellGeometry, getDormerBodyYaw } from './geometry'

// Legacy default for the hung-wall (skirt) height. Used as a fallback
// when `dormer.wallSkirtHeight` is undefined (e.g. old saved scenes).
const DORMER_DROP_BELOW = 2

function dormerSkirtHeight(dormer: DormerNode): number {
  return Math.max(0.05, dormer.wallSkirtHeight ?? DORMER_DROP_BELOW)
}

export const DORMER_GABLE_MATERIAL_INDEX = 4

const _yAxis = new THREE.Vector3(0, 1, 0)
const _scale = new THREE.Vector3(1, 1, 1)

/**
 * Cheap silhouette geometry. Used as a fallback when CSG cannot run
 * (missing host brushes, thrown exception, degenerate inputs) and as
 * the live preview during slider drags so we don't re-run CSG on every
 * pointer move. Also used by the placement / move-tool ghost.
 *
 * The wall sits at material slot 0 and the roof at slot 3 so it picks
 * up the same material array the renderer passes for the CSG output.
 */
export function buildDormerFallbackGeometry(dormer: DormerNode): THREE.BufferGeometry {
  return buildDormerShellGeometry(dormer)
}

function createHostedWindowCutGeometry(window: WindowNode): THREE.BufferGeometry {
  const depth = 0.4
  return buildOpeningCutoutGeometry(
    window,
    {
      left: -window.width / 2,
      right: window.width / 2,
      bottom: -window.height / 2,
      top: window.height / 2,
    },
    depth,
    0.05,
  )
}

/**
 * Build the trimmed dormer geometry hosted on a roof segment. The
 * dormer's own walls+roof are generated via `getRoofSegmentBrushes`
 * on a virtual segment, then the host segment's filled solid is
 * CSG-subtracted in dormer-mesh-local space. Window openings are then
 * subtracted on each exposed gable face.
 */
export function generateDormerGeometry(
  dormer: DormerNode,
  hostSegment: RoofSegmentNode,
  hostedWindows: readonly WindowNode[] = [],
): THREE.BufferGeometry {
  const isShed = dormer.roofType === 'shed'
  const yawBake = getDormerBodyYaw(dormer)
  const segWidth = isShed ? dormer.width : dormer.depth
  const segDepth = isShed ? dormer.depth : dormer.width
  const skirt = dormerSkirtHeight(dormer)

  const vsWidth = Math.max(0.05, segWidth)
  const vsDepth = Math.max(0.05, segDepth)
  const vsActiveRh = Math.max(0, dormer.roofHeight)
  const virtualSegment: RoofSegmentNode = {
    object: 'node',
    id: `rseg_dormer_${dormer.id}` as RoofSegmentNode['id'],
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    roofType: dormer.roofType,
    width: vsWidth,
    depth: vsDepth,
    trim: {
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
    },
    wallHeight: Math.max(0.05, dormer.height) + skirt,
    // The dormer schema still expresses its roof as a height; translate
    // to the pitch the segment math now expects so the virtual segment
    // produces an identical peak.
    pitch: getPitchFromActiveRoofHeight({
      roofType: dormer.roofType,
      width: vsWidth,
      depth: vsDepth,
      roofHeight: vsActiveRh,
    }),
    // Dormers don't expose multi-slope shape tuning; bake the schema
    // defaults so the virtualSegment renders the canonical kink positions.
    ...ROOF_SHAPE_DEFAULTS,
    wallThickness: 0.05,
    deckThickness: 0.04,
    overhang: 0.08,
    shingleThickness: 0.02,
    managedByParent: false,
    wallShell: 'auto',
    shedInsetEndPanels: false,
  }

  const dormerBrushes = getRoofSegmentBrushes(virtualSegment)
  if (!dormerBrushes) {
    console.warn('[dormer] getRoofSegmentBrushes returned null; using fallback silhouette.')
    return buildDormerFallbackGeometry(dormer)
  }

  let resultGeo = new THREE.BufferGeometry()
  let dormerSolid: Brush | null = null
  let hostSolid: Brush | null = null

  try {
    const hollowWall = csgEvaluator.evaluate(
      dormerBrushes.wallBrush,
      dormerBrushes.innerBrush,
      SUBTRACTION,
    ) as Brush
    prepareBrushForCSG(hollowWall)
    const shinDeck = csgEvaluator.evaluate(
      dormerBrushes.shinSlab,
      dormerBrushes.deckSlab,
      ADDITION,
    ) as Brush
    prepareBrushForCSG(shinDeck)
    dormerSolid = csgEvaluator.evaluate(shinDeck, hollowWall, ADDITION) as Brush
    prepareBrushForCSG(dormerSolid)
    hollowWall.geometry.dispose()
    shinDeck.geometry.dispose()

    const bakeMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -skirt, 0),
      new THREE.Quaternion().setFromAxisAngle(_yAxis, yawBake),
      _scale,
    )
    csgGeometry(dormerSolid).applyMatrix4(bakeMatrix)
    prepareBrushForCSG(dormerSolid)

    const hostBrushes = getRoofSegmentBrushes(hostSegment)
    if (hostBrushes) {
      const wallPlusDeck = csgEvaluator.evaluate(
        hostBrushes.wallBrush,
        hostBrushes.deckSlab,
        ADDITION,
      ) as Brush
      prepareBrushForCSG(wallPlusDeck)
      hostSolid = csgEvaluator.evaluate(wallPlusDeck, hostBrushes.shinSlab, ADDITION) as Brush
      prepareBrushForCSG(hostSolid)
      wallPlusDeck.geometry.dispose()
      hostBrushes.deckSlab.geometry.dispose()
      hostBrushes.shinSlab.geometry.dispose()
      hostBrushes.wallBrush.geometry.dispose()
      hostBrushes.innerBrush.geometry.dispose()

      // Union a deep ground box covering the host footprint so the
      // dormer's skirt (extending below y=0) has something to subtract.
      const groundMargin = Math.max(hostSegment.width, hostSegment.depth) * 2 + 4
      const groundBoxGeo = new THREE.BoxGeometry(groundMargin, 100, groundMargin)
      groundBoxGeo.translate(0, -50, 0)
      const indexCount = groundBoxGeo.getIndex()?.count ?? 0
      groundBoxGeo.clearGroups()
      groundBoxGeo.addGroup(0, indexCount, 0)
      computeGeometryBoundsTree(groundBoxGeo)
      const groundBrush = new Brush(groundBoxGeo, roofCsgDummyMats[0])
      prepareBrushForCSG(groundBrush)
      const fullTrim = csgEvaluator.evaluate(hostSolid, groundBrush, ADDITION) as Brush
      prepareBrushForCSG(fullTrim)
      hostSolid.geometry.dispose()
      groundBrush.geometry.dispose()
      hostSolid = fullTrim

      // Host brushes live in segment-local. Bring them into
      // dormer-mesh-local by inverting T(node.position) · R_y(node.rotation).
      const segToMesh = new THREE.Matrix4()
        .compose(
          new THREE.Vector3(
            dormer.position[0] ?? 0,
            dormer.position[1] ?? 0,
            dormer.position[2] ?? 0,
          ),
          new THREE.Quaternion().setFromAxisAngle(_yAxis, dormer.rotation),
          _scale,
        )
        .invert()
      csgGeometry(hostSolid).applyMatrix4(segToMesh)
      prepareBrushForCSG(hostSolid)

      const trimmed = csgEvaluator.evaluate(dormerSolid, hostSolid, SUBTRACTION) as Brush
      prepareBrushForCSG(trimmed)
      dormerSolid.geometry.dispose()
      hostSolid.geometry.dispose()
      hostSolid = null
      dormerSolid = trimmed
    }

    // Cut hosted window openings in dormer-local face coordinates.
    const cutWindow = (window: WindowNode) => {
      const face = window.dormerFace ?? 'front'
      const frame = getDormerWallFaceFrame(dormer, face)
      const center = dormerWallFacePointToDormer(dormer, face, window.position)
      const cutGeo = createHostedWindowCutGeometry(window)
      cutGeo.rotateY(frame.yaw)
      cutGeo.translate(center[0], center[1], center[2])
      if (!cutGeo.getIndex()) {
        const posCount = cutGeo.getAttribute('position').count
        const idx = new Uint32Array(posCount)
        for (let i = 0; i < posCount; i++) idx[i] = i
        cutGeo.setIndex(new THREE.BufferAttribute(idx, 1))
      }
      const idxCount = cutGeo.getIndex()!.count
      cutGeo.clearGroups()
      cutGeo.addGroup(0, idxCount, 0)
      computeGeometryBoundsTree(cutGeo)
      const brush = new Brush(cutGeo, roofCsgDummyMats[0])
      prepareBrushForCSG(brush)
      const result = csgEvaluator.evaluate(dormerSolid!, brush, SUBTRACTION) as Brush
      prepareBrushForCSG(result)
      dormerSolid!.geometry.dispose()
      brush.geometry.dispose()
      dormerSolid = result
    }

    for (const window of hostedWindows) cutWindow(window)

    resultGeo = csgGeometry(dormerSolid)
    const resultMaterials = csgMaterials(dormerSolid)

    const matToIndex = new Map<THREE.Material, number>([
      [roofCsgDummyMats[0], 0],
      [roofCsgDummyMats[1], 1],
      [roofCsgDummyMats[2], 2],
      [roofCsgDummyMats[3], 3],
    ])
    for (const group of resultGeo.groups) {
      group.materialIndex = mapRoofGroupMaterialIndex(
        group.materialIndex,
        resultMaterials,
        matToIndex,
      )
    }
    remapRoofShellFaces(resultGeo, virtualSegment)
    splitDormerGableMaterial(resultGeo, dormer.height, DORMER_GABLE_MATERIAL_INDEX)
  } catch (e) {
    console.error('[dormer] CSG failed, falling back to silhouette:', e)
    if (dormerSolid) {
      try {
        dormerSolid.geometry.dispose()
      } catch {}
    }
    if (hostSolid) {
      try {
        hostSolid.geometry.dispose()
      } catch {}
    }
    return buildDormerFallbackGeometry(dormer)
  }

  // If CSG produced zero triangles (host fully buried it, or one of the
  // boolean ops collapsed to empty), fall back to the silhouette so the
  // dormer is at least visible.
  const triCount = resultGeo.getIndex()?.count ?? resultGeo.getAttribute('position')?.count ?? 0
  if (triCount === 0) {
    console.warn('[dormer] CSG produced empty geometry; using fallback silhouette.')
    return buildDormerFallbackGeometry(dormer)
  }

  resultGeo.computeVertexNormals()
  ensureUv2Attribute(resultGeo)
  return resultGeo
}

/**
 * Build the dormer cut shape in dormer-mesh-local coordinates. The
 * returned geometry is centered at X=Z=0 and spans Y ∈ [-skirt, peak]
 * — the caller layers on the dormer's yaw + position to bring it into
 * segment-local space.
 *
 * Shapes per roof type:
 * - **flat**:                a plain box (top flush with the eave; the
 *                            dormer body has no roof above wallH).
 * - **shed**:                trapezoid in YZ, extruded along X. The
 *                            base shape is high at z=-d/2; the caller
 *                            flips it when the configured high side is
 *                            the front.
 * - **gable / gambrel**:     pentagon (rectangle + symmetric triangle)
 *                            in XY, extruded along Z. Ridge runs
 *                            along Z (mesh-Z = virtualSegment-X after
 *                            the yaw bake).
 * - **hip / dutch / mansard**: pyramid — rectangular base, single
 *                            apex at the peak. Narrows on all four
 *                            sides.
 *
 * Gambrel / dutch / mansard fall back to gable / hip rather than the
 * legacy CSG-derived geometry, because three-bvh-csg's three-way
 * subtraction in the merged-roof loop can't accept CSG-derived
 * brushes without corrupting the result. The dormer body itself still
 * carries the precise per-type shape; the cut just needs to clear
 * enough of the host shell for the body to sit cleanly.
 */
export function buildDormerCutShape(
  roofType: DormerNode['roofType'],
  innerW: number,
  innerD: number,
  skirt: number,
  wallH: number,
  roofH: number,
): THREE.BufferGeometry {
  const hw = innerW / 2
  const hd = innerD / 2

  if (roofType === 'flat') {
    const geo = new THREE.BoxGeometry(innerW, skirt + wallH, innerD)
    geo.translate(0, (wallH - skirt) / 2, 0)
    return geo
  }

  if (roofType === 'shed') {
    // Trapezoid in shape XY → extruded along Z (shape's natural
    // extrude axis) → rotated +π/2 around Y so the shape's X axis
    // ends up along mesh-(-Z) and the extrusion ends up along mesh-X.
    //
    // `getRoofSegmentBrushes`'s shed slope puts the peak at z=-d/2
    // and the eave at z=+d/2 (matching `getRoofSegmentSurfaceY`).
    // After the +π/2 rotation, shape-X=+hd → mesh-Z=-hd, so place the
    // PEAK at shape-X=+hd and the EAVE at shape-X=-hd to keep the cut
    // aligned with the dormer body's actual slope direction.
    const shape = new THREE.Shape()
    shape.moveTo(-hd, -skirt)
    shape.lineTo(hd, -skirt)
    shape.lineTo(hd, wallH + roofH) // peak (lands at mesh-Z = -d/2)
    shape.lineTo(-hd, wallH) // eave (lands at mesh-Z = +d/2)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerW,
      bevelEnabled: false,
    })
    geo.rotateY(Math.PI / 2)
    geo.translate(-innerW / 2, 0, 0) // centre along X
    return geo
  }

  if (roofType === 'hip' || roofType === 'dutch' || roofType === 'mansard') {
    // Truncated pyramid: rectangular base + eave rect + a top ridge
    // along the longer axis. Mirrors `getRoofSegmentBrushes`'s hip:
    //   run = min(w, d) / 2
    //   ridge length = |w - d| (zero when w == d → degenerates to a
    //                            single apex point)
    //
    // For non-shed dormers, `virtualSegment.width = dormer.depth` runs
    // along mesh-Z, so the longer-axis ridge direction follows the
    // larger of innerD vs. innerW.
    //
    // Triangle windings below are CCW from outside (verified
    // case-by-case via cross-product test); three-bvh-csg uses the
    // normals to determine inside/outside for SUBTRACTION, so an
    // inverted winding here would make the cut subtract the
    // complement of the dormer footprint — a hand-built pyramid is
    // the only shape in this file that does NOT get its windings from
    // Three.js geometry primitives, so we have to wind it carefully.
    const longerIsZ = innerD >= innerW
    const ridgeHalfLen = Math.max(0, (Math.max(innerW, innerD) - Math.min(innerW, innerD)) / 2)
    const peakY = wallH + roofH

    // Ridge endpoints in mesh frame.
    const ridgeA = longerIsZ
      ? ([0, peakY, -ridgeHalfLen] as const)
      : ([-ridgeHalfLen, peakY, 0] as const)
    const ridgeB = longerIsZ
      ? ([0, peakY, ridgeHalfLen] as const)
      : ([ridgeHalfLen, peakY, 0] as const)

    const positions = new Float32Array([
      // 0..3 = bottom rect (y = -skirt) — NW, NE, SE, SW
      -hw,
      -skirt,
      -hd,
      hw,
      -skirt,
      -hd,
      hw,
      -skirt,
      hd,
      -hw,
      -skirt,
      hd,
      // 4..7 = eave rect (y = wallH) — NW, NE, SE, SW
      -hw,
      wallH,
      -hd,
      hw,
      wallH,
      -hd,
      hw,
      wallH,
      hd,
      -hw,
      wallH,
      hd,
      // 8 = ridge endpoint A (- end along the ridge axis)
      ridgeA[0],
      ridgeA[1],
      ridgeA[2],
      // 9 = ridge endpoint B (+ end along the ridge axis)
      ridgeB[0],
      ridgeB[1],
      ridgeB[2],
    ])

    // Triangles (CCW from outside). Windings verified by computing
    // `(v1-v0) × (v2-v0)` for each triangle and checking the normal
    // points along the expected outward direction.
    const indices: number[] = [
      // Bottom (normal -Y).
      0, 1, 2, 0, 2, 3,
      // -Z wall (normal -Z) — eave 4,5 on top, base 0,1 below.
      1, 0, 4, 1, 4, 5,
      // +X wall (normal +X) — eave 5,6 on top, base 1,2 below.
      2, 1, 5, 2, 5, 6,
      // +Z wall (normal +Z) — eave 6,7 on top, base 2,3 below.
      3, 2, 6, 3, 6, 7,
      // -X wall (normal -X) — eave 7,4 on top, base 3,0 below.
      0, 3, 7, 0, 7, 4,
    ]

    if (longerIsZ) {
      // Ridge along Z. A=8 at -Z end, B=9 at +Z end.
      //   -Z end face (triangle, normal -Z/+Y): 4, 8, 5
      //   +X side face (quad, normal +X/+Y):    5, 9, 6 + 5, 8, 9
      //   +Z end face (triangle, normal +Z/+Y): 6, 9, 7
      //   -X side face (quad, normal -X/+Y):    7, 8, 4 + 7, 9, 8
      indices.push(4, 8, 5)
      indices.push(5, 9, 6, 5, 8, 9)
      indices.push(6, 9, 7)
      indices.push(7, 8, 4, 7, 9, 8)
    } else {
      // Ridge along X. A=8 at -X end, B=9 at +X end.
      //   -X end face (triangle, normal -X/+Y): 4, 7, 8
      //   -Z side face (quad, normal -Z/+Y):    4, 9, 5 + 4, 8, 9
      //   +X end face (triangle, normal +X/+Y): 5, 9, 6
      //   +Z side face (quad, normal +Z/+Y):    6, 8, 7 + 6, 9, 8
      indices.push(4, 7, 8)
      indices.push(4, 9, 5, 4, 8, 9)
      indices.push(5, 9, 6)
      indices.push(6, 8, 7, 6, 9, 8)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1))
    // CSG evaluator requires 'uv'; cut brushes are never rendered so zeros are fine.
    geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
    )
    geo.computeVertexNormals()
    return geo
  }

  if (roofType === 'gambrel') {
    // Gambrel: two-segment slope per side. `getRoofSegmentBrushes`
    // uses `run = depth / 4` and `rise = activeRh * 0.6` for the
    // outer (steeper) portion. The cut profile in XY mirrors that —
    // straight from eave up to a kink at (±hw/2, wallH + 0.6*roofH),
    // then up to the ridge at (0, wallH + roofH). Extruded along Z.
    const kinkX = hw / 2
    const kinkY = wallH + roofH * 0.6
    const shape = new THREE.Shape()
    shape.moveTo(-hw, -skirt)
    shape.lineTo(hw, -skirt)
    shape.lineTo(hw, wallH)
    shape.lineTo(kinkX, kinkY)
    shape.lineTo(0, wallH + roofH)
    shape.lineTo(-kinkX, kinkY)
    shape.lineTo(-hw, wallH)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerD,
      bevelEnabled: false,
    })
    geo.translate(0, 0, -innerD / 2)
    return geo
  }

  // gable (and any unrecognised type) — pentagon (rectangle +
  // symmetric triangle peak), extruded along Z. Ridge runs along Z,
  // matching mesh-Z which (for non-shed types) corresponds to the
  // virtualSegment-X gable ridge direction after the +π/2 yaw bake
  // the body geometry uses.
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -skirt)
  shape.lineTo(hw, -skirt)
  shape.lineTo(hw, wallH)
  shape.lineTo(0, wallH + roofH)
  shape.lineTo(-hw, wallH)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerD,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -innerD / 2)
  return geo
}

/**
 * Build the segment-local cut geometry the host roof's merge loop
 * subtracts from its shin / deck / wall brushes so the dormer has a
 * clean hole to poke through. Mirrors `generateDormerGeometry`'s
 * virtual-segment + bake: build the inner shape in
 * virtual-segment-local, apply the dormer's yaw + drop-below bake,
 * then the dormer's segment-local position + rotation, so the
 * geometry lives in host-segment-local — the same frame the
 * merged-roof CSG loop operates in.
 *
 * Returns null on degenerate input so the caller can skip the cut.
 *
 * Coordinates are SEGMENT-LOCAL. The viewer welds vertices, attaches
 * a single material group, and wraps the result in a Brush — see
 * `wiki/architecture/node-definitions.md` (`capabilities.roofAccessory.buildCut`).
 */
export function buildDormerRoofCut(dormer: DormerNode): THREE.BufferGeometry | null {
  // Defensive: bail on any non-finite or sub-millimeter dimension. A
  // degenerate cut brush passed to three-bvh-csg can produce a result
  // buffer with NaN positions / invalid indices, which the WebGPU
  // renderer then refuses to submit ("Invalid CommandBuffer") and the
  // error cascades to every subsequent submit.
  const dims = [
    dormer.width,
    dormer.depth,
    dormer.height,
    dormer.roofHeight,
    dormer.wallSkirtHeight,
    dormer.position[0],
    dormer.position[1],
    dormer.position[2],
    dormer.rotation,
  ]
  for (const v of dims) {
    if (!Number.isFinite(v)) return null
  }
  if (dormer.width < 0.01 || dormer.depth < 0.01) return null

  const skirt = dormerSkirtHeight(dormer)
  const wallThickness = 0.05
  const innerW = Math.max(0.05, dormer.width - 2 * wallThickness)
  const innerD = Math.max(0.05, dormer.depth - 2 * wallThickness)
  const wallH = Math.max(0.05, dormer.height)
  const roofH = Math.max(0, dormer.roofHeight)

  // Cut footprint matches the dormer's INNER cavity (outer dim minus
  // the 0.05m wall thickness on each side); the dormer's own outer
  // wall sits over the resulting 5cm strip of host roof, hiding it
  // and preventing the sub-pixel gap an exact outer-footprint cut
  // would expose where dormer wall meets host roof.
  //
  // The shape ABOVE the eave varies per roof type so the host hole
  // matches the dormer body's outline:
  //   - flat:    box (no peak above the eave)
  //   - shed:    trapezoid with one sloped top edge
  //   - hip / dutch / mansard:  pyramid (narrows on all 4 sides)
  //   - gable / gambrel:        pentagon (narrows along width axis)
  const geo = buildDormerCutShape(dormer.roofType, innerW, innerD, skirt, wallH, roofH)

  // Yaw in the geometry's own (un-translated) frame so the cut follows
  // both the shed pitch direction and the dormer's footprint rotation.
  const shedDirectionYaw =
    dormer.roofType === 'shed' && dormer.shedHighSide === 'front' ? Math.PI : 0
  const cutYaw = shedDirectionYaw + dormer.rotation
  if (Math.abs(cutYaw) > 1e-4) {
    geo.rotateY(cutYaw)
  }

  // Translate into segment-local. position[1] becomes the dormer's
  // local Y = 0 (the wall foot / eave line); the shape's foot at
  // local Y = -skirt then sits at world Y = position[1] - skirt.
  geo.translate(dormer.position[0], dormer.position[1], dormer.position[2])

  // The viewer's merge loop welds vertices, attaches a single material
  // group, and wraps in a Brush before subtracting from the host
  // segment's shin / deck / wall. Kinds only emit the raw shape.
  return geo
}

/**
 * Reassign slot-0 (wall) triangles whose entire footprint sits above
 * `wallHeight` to a separate material slot — lets the renderer colour
 * the rectangular wall and the gable triangle differently.
 */
function splitDormerGableMaterial(
  geometry: THREE.BufferGeometry,
  wallHeight: number,
  gableMatIndex: number,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  if (!(position && index) || index.count === 0 || geometry.groups.length === 0) return

  const triangleCount = index.count / 3
  if (triangleCount === 0) return

  const triangleMats = new Array<number>(triangleCount).fill(0)
  for (const g of geometry.groups) {
    const startTri = Math.floor(g.start / 3)
    const endTri = Math.floor((g.start + g.count) / 3)
    const mat = g.materialIndex ?? 0
    for (let i = startTri; i < endTri; i++) triangleMats[i] = mat
  }

  const epsilon = 0.001
  for (let i = 0; i < triangleCount; i++) {
    if (triangleMats[i] !== 0) continue
    const a = index.getX(i * 3)
    const b = index.getX(i * 3 + 1)
    const c = index.getX(i * 3 + 2)
    const ya = position.getY(a)
    const yb = position.getY(b)
    const yc = position.getY(c)
    if (ya > wallHeight + epsilon && yb > wallHeight + epsilon && yc > wallHeight + epsilon) {
      triangleMats[i] = gableMatIndex
    }
  }

  const sortedTri = Array.from({ length: triangleCount }, (_, i) => i)
  sortedTri.sort((a, b) => (triangleMats[a] ?? 0) - (triangleMats[b] ?? 0))

  const newIdx = new Uint32Array(index.count)
  for (let i = 0; i < sortedTri.length; i++) {
    const ti = sortedTri[i] as number
    newIdx[i * 3] = index.getX(ti * 3)
    newIdx[i * 3 + 1] = index.getX(ti * 3 + 1)
    newIdx[i * 3 + 2] = index.getX(ti * 3 + 2)
  }
  geometry.setIndex(new THREE.BufferAttribute(newIdx, 1))

  geometry.clearGroups()
  let groupStart = 0
  let curMat = triangleMats[sortedTri[0] as number] as number
  for (let i = 1; i < sortedTri.length; i++) {
    const mat = triangleMats[sortedTri[i] as number] as number
    if (mat !== curMat) {
      geometry.addGroup(groupStart, i * 3 - groupStart, curMat)
      groupStart = i * 3
      curMat = mat
    }
  }
  geometry.addGroup(groupStart, sortedTri.length * 3 - groupStart, curMat)
}

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}
