'use client'

import {
  type AnyNodeId,
  type BuildingNode,
  type LevelNode,
  resolveBuildingForLevel,
  resolveLevelId,
  type SlabNode,
  type SurfaceHoleMetadata,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Object3D,
  ShapeUtils,
  Vector2,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import useEditor from '../../store/use-editor'
import { swallowNextClick } from './handles/use-handle-drag'

const ACCENT = 0x83_81_ed
const SURFACE_OFFSET = 0.01
const HIT_PADDING = 0.08
const MIN_HIT_HEIGHT = 0.16

const NO_RAYCAST = () => null
let restoreNodeClickSuppression: (() => void) | null = null

const outlineMaterial = new LineBasicNodeMaterial({
  color: ACCENT,
  depthTest: false,
  depthWrite: false,
})

const fillMaterial = new MeshBasicNodeMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.5,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
})

// Invisible hit targets must stay out of the scene MRT pass; keep them on
// EDITOR_LAYER even though they never write color.
const hitMaterial = new MeshBasicNodeMaterial({
  color: ACCENT,
  colorWrite: false,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
  side: DoubleSide,
  transparent: true,
})

type HolePolygon = Array<[number, number]>

function makeFillGeometry(hole: HolePolygon, y: number): BufferGeometry {
  const contour2d = hole.map(([x, z]) => new Vector2(x, z))
  const positions: number[] = []
  const indices: number[] = []

  for (const point of contour2d) {
    positions.push(point.x, y, point.y)
  }

  const triangles = ShapeUtils.triangulateShape(contour2d, [])
  for (const tri of triangles) {
    indices.push(tri[0]!, tri[2]!, tri[1]!)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function makeOutlineGeometry(hole: HolePolygon, y: number): BufferGeometry {
  const positions: number[] = []

  for (let index = 0; index < hole.length; index += 1) {
    const [ax, az] = hole[index]!
    const [bx, bz] = hole[(index + 1) % hole.length]!
    positions.push(ax, y, az, bx, y, bz)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function makeHitGeometry(hole: HolePolygon, centerY: number, height: number): BufferGeometry {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, z] of hole) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  const width = Math.max(maxX - minX + HIT_PADDING * 2, HIT_PADDING * 2)
  const depth = Math.max(maxZ - minZ + HIT_PADDING * 2, HIT_PADDING * 2)
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const geometry = new BoxGeometry(width, height, depth)
  geometry.translate(centerX, centerY, centerZ)
  geometry.computeBoundingSphere()
  return geometry
}

function getSurfaceY(slab: SlabNode): number {
  const elevation = slab.elevation ?? 0.05
  return (elevation > 0 ? elevation : 0) + SURFACE_OFFSET
}

function getHitCenterY(slab: SlabNode): number {
  const elevation = slab.elevation ?? 0.05
  const surfaceTop = elevation > 0 ? elevation : 0
  // Keep the hit box's TOP at the slab surface (never poke above it) so the
  // slab's centre thickness/height handle, which sits on top, always wins the
  // raycast over the hole's selectable area.
  return surfaceTop - getHitHeight(slab) / 2
}

function getHitHeight(slab: SlabNode): number {
  return Math.max(Math.abs(slab.elevation ?? 0.05), MIN_HIT_HEIGHT)
}

function clearHoveredHoleIfMatches(nodeId: string, holeIndex: number) {
  const { hoveredHole, setHoveredHole } = useEditor.getState()
  if (hoveredHole?.nodeId === nodeId && hoveredHole.holeIndex === holeIndex) {
    setHoveredHole(null)
  }
}

function selectOwnedNode(ownerId: string, expectedType: 'stair' | 'elevator') {
  const nodes = useScene.getState().nodes
  const owner = nodes[ownerId as AnyNodeId]
  if (owner?.type !== expectedType) return

  const selectedId = owner.id as AnyNodeId

  if (owner.type === 'elevator') {
    const buildingId =
      owner.parentId && nodes[owner.parentId as AnyNodeId]?.type === 'building'
        ? (owner.parentId as BuildingNode['id'])
        : null

    useViewer
      .getState()
      .setSelection(
        buildingId ? { buildingId, selectedIds: [selectedId] } : { selectedIds: [selectedId] },
      )
    return
  }

  const levelId = resolveLevelId(owner, nodes)
  const buildingId =
    levelId && levelId !== 'default' ? resolveBuildingForLevel(levelId as AnyNodeId, nodes) : null

  useViewer.getState().setSelection({
    ...(buildingId ? { buildingId: buildingId as BuildingNode['id'] } : {}),
    ...(levelId && levelId !== 'default' ? { levelId: levelId as LevelNode['id'] } : {}),
    selectedIds: [selectedId],
  })
}

function resetPointerCursor() {
  if (document.body.style.cursor === 'pointer') {
    document.body.style.cursor = ''
  }
}

function stopPointerPropagation(event: ThreeEvent<PointerEvent>) {
  event.stopPropagation()
  event.nativeEvent.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

function suppressNodeClickUntilPointerUp() {
  restoreNodeClickSuppression?.()
  const previousInputDragging = useViewer.getState().inputDragging
  useViewer.getState().setInputDragging(true)
  swallowNextClick()

  const restore = () => {
    if (restoreNodeClickSuppression !== restore) return
    useViewer.getState().setInputDragging(previousInputDragging)
    window.removeEventListener('pointerup', restore)
    window.removeEventListener('pointercancel', restore)
    restoreNodeClickSuppression = null
  }

  restoreNodeClickSuppression = restore
  window.addEventListener('pointerup', restore, { once: true })
  window.addEventListener('pointercancel', restore, { once: true })
}

function releaseNodeClickSuppression() {
  restoreNodeClickSuppression?.()
}

export function SlabHoleHighlights() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const hoveredHole = useEditor((state) => state.hoveredHole)
  const setHoveredHole = useEditor((state) => state.setHoveredHole)

  useEffect(() => {
    if (hoveredHole && !selectedIds.includes(hoveredHole.nodeId as AnyNodeId)) {
      setHoveredHole(null)
    }
  }, [hoveredHole, selectedIds, setHoveredHole])

  if (selectedIds.length === 0) return null

  return (
    <>
      {selectedIds.map((id) => (
        <SelectedSlabHoleHighlights key={id} slabId={id} />
      ))}
    </>
  )
}

function SelectedSlabHoleHighlights({ slabId }: { slabId: string }) {
  const node = useScene((state) => state.nodes[slabId as AnyNodeId])
  const override = useLiveNodeOverrides((state) => state.overrides.get(slabId))
  const hoveredHole = useEditor((state) => state.hoveredHole)
  const editingHole = useEditor((state) => state.editingHole)
  const setHoveredHole = useEditor((state) => state.setHoveredHole)

  const slab = node?.type === 'slab' ? (node as SlabNode) : null
  const effectiveSlab = slab ? ({ ...slab, ...(override ?? {}) } as SlabNode) : null
  const holes = effectiveSlab?.holes ?? []
  const holeMetadata = effectiveSlab?.holeMetadata ?? []

  // Portal the highlights into the slab's OWN object — exactly how
  // NodeArrowHandles portals into a node object. This is what makes R3F deliver
  // pointer events to the hit meshes (portaling into the raw scene renders but
  // never receives hover/click), and the children inherit the slab's world
  // transform so the holes sit in slab-local space with no manual math.
  const [slabObject, setSlabObject] = useState<Object3D | null>(
    () => sceneRegistry.nodes.get(slabId as AnyNodeId) ?? null,
  )
  useEffect(() => {
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(slabId as AnyNodeId) ?? null
      setSlabObject((cur) => (cur === next ? cur : next))
      if (!next) {
        frameId = window.requestAnimationFrame(resolve)
      }
    }
    resolve()
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [slabId])

  useEffect(() => {
    if (hoveredHole?.nodeId !== slabId) return
    if (!effectiveSlab || hoveredHole.holeIndex >= holes.length) {
      setHoveredHole(null)
    }
  }, [effectiveSlab, holes.length, hoveredHole, slabId, setHoveredHole])

  if (!effectiveSlab || holes.length === 0 || !slabObject) return null

  const surfaceY = getSurfaceY(effectiveSlab)
  const hitCenterY = getHitCenterY(effectiveSlab)
  const hitHeight = getHitHeight(effectiveSlab)

  return createPortal(
    <group>
      {holes.map((hole, holeIndex) => {
        const metadata = holeMetadata[holeIndex]
        if (hole.length < 3) return null

        const isActive =
          (hoveredHole?.nodeId === slabId && hoveredHole.holeIndex === holeIndex) ||
          (editingHole?.nodeId === slabId && editingHole.holeIndex === holeIndex)

        return (
          <SlabHoleHighlight
            active={isActive}
            hitCenterY={hitCenterY}
            hitHeight={hitHeight}
            hole={hole}
            holeIndex={holeIndex}
            key={`${slabId}:${holeIndex}`}
            metadata={metadata}
            slabId={slabId}
            surfaceY={surfaceY}
          />
        )
      })}
    </group>,
    slabObject,
  )
}

function SlabHoleHighlight({
  active,
  hitCenterY,
  hitHeight,
  hole,
  holeIndex,
  metadata,
  slabId,
  surfaceY,
}: {
  active: boolean
  hitCenterY: number
  hitHeight: number
  hole: HolePolygon
  holeIndex: number
  metadata: SurfaceHoleMetadata | undefined
  slabId: string
  surfaceY: number
}) {
  const fillGeometry = useMemo(() => makeFillGeometry(hole, surfaceY), [hole, surfaceY])
  const outlineGeometry = useMemo(() => makeOutlineGeometry(hole, surfaceY), [hole, surfaceY])
  const hitGeometry = useMemo(
    () => makeHitGeometry(hole, hitCenterY, hitHeight),
    [hitCenterY, hitHeight, hole],
  )

  useEffect(() => () => fillGeometry.dispose(), [fillGeometry])
  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => clearHoveredHoleIfMatches(slabId, holeIndex), [holeIndex, slabId])

  const handlePointerEnter = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      useEditor.getState().setHoveredHole({ nodeId: slabId, holeIndex })
      if (document.body.style.cursor !== 'pointer') {
        document.body.style.cursor = 'pointer'
      }
    },
    [holeIndex, slabId],
  )

  const handlePointerLeave = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      clearHoveredHoleIfMatches(slabId, holeIndex)
      resetPointerCursor()
    },
    [holeIndex, slabId],
  )

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0) return
      stopPointerPropagation(event)
      suppressNodeClickUntilPointerUp()
      useEditor.getState().setHoveredHole({ nodeId: slabId, holeIndex })

      // Auto-managed cutouts (stair / elevator) jump to their owner so the
      // user edits the source rather than the synced hole. Everything else —
      // manual holes and holes that predate holeMetadata — opens the editor.
      if (metadata?.source === 'stair' && metadata.stairId) {
        useEditor.getState().setEditingHole(null)
        useEditor.getState().setHoveredHole(null)
        resetPointerCursor()
        selectOwnedNode(metadata.stairId, 'stair')
        return
      }
      if (metadata?.source === 'elevator' && metadata.elevatorId) {
        useEditor.getState().setEditingHole(null)
        useEditor.getState().setHoveredHole(null)
        resetPointerCursor()
        selectOwnedNode(metadata.elevatorId, 'elevator')
        return
      }

      useEditor.getState().setEditingHole({ nodeId: slabId, holeIndex })
      useViewer.getState().setSelection({ selectedIds: [slabId as AnyNodeId] })
    },
    [holeIndex, metadata, slabId],
  )

  const handlePointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    releaseNodeClickSuppression()
    stopPointerPropagation(event)
  }, [])

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={fillGeometry}
        material={fillMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1004}
      />
      <lineSegments
        frustumCulled={false}
        geometry={outlineGeometry}
        material={outlineMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1005}
      />
      {active && (
        <>
          <mesh
            frustumCulled={false}
            geometry={fillGeometry}
            material={fillMaterial}
            raycast={NO_RAYCAST}
            renderOrder={1006}
          />
          <lineSegments
            frustumCulled={false}
            geometry={outlineGeometry}
            material={outlineMaterial}
            raycast={NO_RAYCAST}
            renderOrder={1007}
          />
        </>
      )}
      <mesh
        frustumCulled={false}
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerUp={handlePointerUp}
        renderOrder={1006}
      />
    </>
  )
}

export default SlabHoleHighlights
