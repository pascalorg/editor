'use client'

import {
  type AnyNodeId,
  type DormerNode,
  getEffectiveDormerSurfaceMaterial,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createMaterial,
  createMaterialFromPresetRef,
  DORMER_GABLE_MATERIAL_INDEX,
  generateDormerGeometry,
  getDormerExposedFaces,
  getDormerSkirtWindowDims,
  glassMaterial,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildDormerWindowGeometries, type DormerWindowShape } from './window-frame'

// Three distinct default materials: wall, side, roof top.
// All three use FrontSide — chimney / skylight do the same, and
// DoubleSide on a MeshStandardMaterial inside the MRT scene pass
// generates a WebGPU pipeline whose fragment stage doesn't always
// declare an output for every MRT target, which the validator rejects
// with "target has no corresponding fragment stage output but
// writeMask is not zero".
const defaultWallMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.9,
  side: THREE.FrontSide,
})
const defaultSideMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.9,
  side: THREE.FrontSide,
})
const defaultRoofMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  side: THREE.FrontSide,
})

// Geometry slots produced by `generateDormerGeometry`:
//   0 = Wall          → wall material
//   1 = Deck (side)   → side material
//   2 = Interior      → wall material
//   3 = Roof shingle  → roof material
//   4 = Gable wall    → wall material  (DORMER_GABLE_MATERIAL_INDEX)
const defaultDormerMaterials: THREE.Material[] = [
  defaultWallMat,
  defaultSideMat,
  defaultWallMat,
  defaultRoofMat,
  defaultWallMat,
]

const DormerRenderer = ({ node: storeNode }: { node: DormerNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'dormer', ref)
  const handlers = useNodeEvents(storeNode, 'dormer')

  // Live overrides so slider drag re-runs CSG without committing to the store.
  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id as AnyNodeId))
  const node = useMemo(
    () =>
      liveOverrides ? ({ ...storeNode, ...liveOverrides } as DormerNode) : storeNode,
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const resolvedMaterials = useMemo(() => {
    const top = getEffectiveDormerSurfaceMaterial(node, 'top')
    const side = getEffectiveDormerSurfaceMaterial(node, 'side')
    const wall = getEffectiveDormerSurfaceMaterial(node, 'wall')

    const resolve = (spec: { material?: DormerNode['material']; materialPreset?: string }) => {
      if (spec.materialPreset) return createMaterialFromPresetRef(spec.materialPreset)
      if (spec.material) return createMaterial(spec.material)
      return null
    }

    const topMat = resolve(top)
    const sideMat = resolve(side)
    const wallMat = resolve(wall)

    if (!(topMat || sideMat || wallMat)) return null

    const w = wallMat ?? defaultWallMat
    const s = sideMat ?? defaultSideMat
    const t = topMat ?? defaultRoofMat
    return [w, s, w, t, w] as THREE.Material[]
  }, [
    node.material,
    node.materialPreset,
    node.topMaterial,
    node.topMaterialPreset,
    node.sideMaterial,
    node.sideMaterialPreset,
    node.wallMaterial,
    node.wallMaterialPreset,
  ])

  const material = resolvedMaterials ?? defaultDormerMaterials
  const frameSideMat = resolvedMaterials ? resolvedMaterials[1]! : defaultSideMat

  const geometry = useMemo(
    () => (segment ? generateDormerGeometry(node, segment) : null),
    [
      segment,
      node.id,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.wallSkirtHeight,
      node.position[0],
      node.position[1],
      node.position[2],
      node.rotation,
      node.windowWidth,
      node.windowHeight,
      node.windowOffsetX,
      node.windowOffsetY,
      node.windowShape,
      node.windowArchHeight,
      node.windowCornerRadius,
      node.windowRadiusMode,
      node.windowCornerRadii?.[0],
      node.windowCornerRadii?.[1],
      node.windowCornerRadii?.[2],
      node.windowCornerRadii?.[3],
    ],
  )

  useEffect(() => () => geometry?.dispose(), [geometry])

  // Window dimensions on the gable face, derived to match the CSG cut.
  const skirtWin = useMemo(
    () => getDormerSkirtWindowDims(node),
    [
      node.width,
      node.windowWidth,
      node.windowHeight,
      node.windowOffsetX,
      node.windowOffsetY,
      node.wallSkirtHeight,
    ],
  )

  const ft = node.windowFrameThickness ?? 0.05
  const fd = node.windowFrameDepth ?? 0.06
  const cols = node.windowColumns ?? 1
  const rows = node.windowRows ?? 1
  const dt = node.windowDividerThickness ?? 0.02

  const winW = skirtWin.width
  const winH = skirtWin.height
  const winShape: DormerWindowShape = (node.windowShape ?? 'rectangle') as DormerWindowShape
  const archH = node.windowArchHeight ?? 0.35
  const cornerR = node.windowCornerRadius ?? 0.15
  const radiusMode = node.windowRadiusMode ?? 'all'
  const individualRadii = (node.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15]) as [
    number,
    number,
    number,
    number,
  ]
  const resolvedRadii: [number, number, number, number] =
    radiusMode === 'individual'
      ? individualRadii
      : [cornerR, cornerR, cornerR, cornerR]

  const winGeo = useMemo(
    () =>
      buildDormerWindowGeometries(
        winW,
        winH,
        ft,
        fd,
        cols,
        rows,
        dt,
        winShape,
        archH,
        resolvedRadii,
      ),
    [winW, winH, ft, fd, cols, rows, dt, winShape, archH, ...resolvedRadii],
  )

  useEffect(() => {
    return () => {
      const disposed = new Set<THREE.BufferGeometry>()
      for (const bar of winGeo.frameBars) {
        if (!disposed.has(bar.geo)) {
          bar.geo.dispose()
          disposed.add(bar.geo)
        }
      }
      for (const pane of winGeo.glassPanes) {
        if (!disposed.has(pane.geo)) {
          pane.geo.dispose()
          disposed.add(pane.geo)
        }
      }
    }
  }, [winGeo])

  const exposed = useMemo(
    () => (segment ? getDormerExposedFaces(node, segment) : { front: true, back: false }),
    [
      segment,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.position[0],
      node.position[1],
      node.position[2],
    ],
  )

  if (!(segment && geometry)) return null

  const gableHalfZ = node.depth / 2
  const winX = skirtWin.offsetX
  const winY = skirtWin.centerY

  const renderWindowAssembly = (zPos: number, keyPrefix: string) => (
    <group name={`dormer-window-${keyPrefix}`} position={[winX, winY, zPos]}>
      {winGeo.glassPanes.map((pane, i) => (
        <mesh
          geometry={pane.geo}
          // biome-ignore lint/suspicious/noArrayIndexKey: glass panes are derived from grid indices, no stable id.
          key={`${keyPrefix}-glass-${i}`}
          material={glassMaterial}
          position={pane.pos}
        />
      ))}
      {winGeo.frameBars.map((bar, i) => (
        <mesh
          geometry={bar.geo}
          // biome-ignore lint/suspicious/noArrayIndexKey: frame bars are derived from grid indices, no stable id.
          key={`${keyPrefix}-bar-${i}`}
          material={frameSideMat}
          position={bar.pos}
        />
      ))}
    </group>
  )

  // Dormers are mounted inside `RoofRenderer`'s `roof-elements` group
  // (at the roof origin — NOT inside the host segment's transform), so
  // we apply the segment's own position + rotation here. Mirrors how
  // chimney / skylight render. The CSG geometry is built in
  // dormer-mesh-local with `dormer.position` + `dormer.rotation`
  // already accounted for by `segToMesh`, so we layer them as group
  // transforms here too.
  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation ?? 0}
      visible={node.visible}
    >
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
      >
        <group rotation-y={node.rotation ?? 0} {...handlers}>
          <mesh
            castShadow
            geometry={geometry}
            material={material}
            name="dormer-body"
            receiveShadow
          />
          {exposed.front && renderWindowAssembly(gableHalfZ, 'front')}
          {exposed.back && renderWindowAssembly(-gableHalfZ, 'back')}
        </group>
      </group>
    </group>
  )
}

// Re-export so consumers (e.g. tests) can reach the gable slot index
// without importing from `@pascal-app/viewer` directly.
export { DORMER_GABLE_MATERIAL_INDEX }

export default DormerRenderer
