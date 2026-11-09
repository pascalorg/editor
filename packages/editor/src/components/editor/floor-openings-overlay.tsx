'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorOpeningNode,
  resolveCeilingHeight,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  ShapeUtils,
  Vector2,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { useCeilingEditSession } from '../../lib/ceiling-edit-session'
import { EDITOR_LAYER } from '../../lib/constants'
import { openingRoom, roomSurfaceOpenings, useFloorEditSession } from '../../lib/floor-edit-session'
import { useOpeningDraft } from '../../lib/floor-opening-draft'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import { PolygonEditor } from '../tools/shared/polygon-editor'

// The openings of the room being edited ("Edit floor", "Edit ceiling", or a
// "Cut opening" in progress), outlined where they cut: amber, a light fill to
// click them by, and the selected one's corner handles. Openings are intent
// nodes with no mesh of their own — the surfaces they cut show the void.

const COLOR = '#f59e0b'
const LIFT = 0.015

type Nodes = Readonly<Record<string, AnyNode>>

/** Where an opening is drawn: its room's floor, or the ceiling it was drawn on. */
export function openingElevation(nodes: Nodes, opening: FloorOpeningNode): number {
  if (opening.hostZoneId) return roomFloorElevation(nodes, opening.hostZoneId)
  const zoneId = openingRoom(nodes, opening)
  if (opening.drawnOn === 'ceiling') {
    const ceiling = Object.values(nodes).find(
      (node) =>
        node.type === 'ceiling' && node.parentId === opening.parentId && node.zoneId === zoneId,
    )
    return ceiling?.type === 'ceiling'
      ? resolveCeilingHeight(ceiling, nodes as Record<AnyNodeId, AnyNode>)
      : 2.5
  }
  return zoneId ? roomFloorElevation(nodes, zoneId) : 0.05
}

function useShownOpenings(): { levelId: string | null; openings: FloorOpeningNode[] } {
  const nodes = useScene((s) => s.nodes)
  const floorSession = useFloorEditSession((s) => s.session)
  const ceilingSession = useCeilingEditSession((s) => s.session)
  const draftHost = useOpeningDraft((s) => s.host)
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  return useMemo(() => {
    const shown = new Map<string, FloorOpeningNode>()
    const add = (list: FloorOpeningNode[]) => {
      for (const opening of list) shown.set(opening.id, opening)
    }
    let levelId: string | null = null
    if (floorSession) {
      add(roomSurfaceOpenings(nodes, floorSession.zoneId, 'floor'))
      levelId = floorSession.levelId
    }
    if (ceilingSession?.zoneId) {
      add(roomSurfaceOpenings(nodes, ceilingSession.zoneId, 'ceiling'))
      levelId = ceilingSession.levelId
    }
    if (draftHost) {
      add(roomSurfaceOpenings(nodes, draftHost.zoneId, draftHost.drawnOn))
      levelId = draftHost.levelId
    }
    const selected = selectedId ? nodes[selectedId as AnyNodeId] : undefined
    if (selected?.type === 'floor-opening') {
      shown.set(selected.id, selected)
      levelId = selected.parentId
    }
    return {
      levelId,
      openings: [...shown.values()].filter((opening) => opening.parentId === levelId),
    }
  }, [nodes, floorSession, ceilingSession, draftHost, selectedId])
}

function outlineGeometry(polygon: FloorOpeningNode['polygon'], y: number) {
  const positions: number[] = []
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    positions.push(a[0], y, a[1], b[0], y, b[1])
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

function fillGeometry(polygon: FloorOpeningNode['polygon'], y: number) {
  const contour = polygon.map(([x, z]) => new Vector2(x, z))
  const positions: number[] = []
  for (const triangle of ShapeUtils.triangulateShape(contour, []))
    for (const index of triangle) positions.push(contour[index]!.x, y, contour[index]!.y)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

function OpeningOutline({
  opening,
  elevation,
  selected,
  materials,
}: {
  opening: FloorOpeningNode
  elevation: number
  selected: boolean
  materials: {
    line: LineBasicNodeMaterial
    fill: MeshBasicNodeMaterial
    fillSelected: MeshBasicNodeMaterial
  }
}) {
  const geometry = useMemo(
    () => ({
      line: outlineGeometry(opening.polygon, elevation + LIFT),
      fill: fillGeometry(opening.polygon, elevation + LIFT),
    }),
    [opening.polygon, elevation],
  )
  useEffect(
    () => () => {
      geometry.line.dispose()
      geometry.fill.dispose()
    },
    [geometry],
  )
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    useViewer.getState().setSelection({ selectedIds: [opening.id] })
  }
  return (
    <group data-floor-opening={opening.id}>
      <lineSegments
        geometry={geometry.line}
        layers={EDITOR_LAYER}
        material={materials.line}
        raycast={() => {}}
        renderOrder={1001}
      />
      <mesh
        geometry={geometry.fill}
        layers={EDITOR_LAYER}
        material={selected ? materials.fillSelected : materials.fill}
        onClick={select}
        renderOrder={1000}
      />
    </group>
  )
}

export function FloorOpeningsOverlay3D() {
  const { levelId, openings } = useShownOpenings()
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  const root = useRef<Group>(null)
  const materials = useMemo(
    () => ({
      line: new LineBasicNodeMaterial({ color: COLOR, depthTest: false, depthWrite: false }),
      fill: new MeshBasicNodeMaterial({
        color: COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.12,
        side: DoubleSide,
        transparent: true,
      }),
      fillSelected: new MeshBasicNodeMaterial({
        color: COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.28,
        side: DoubleSide,
        transparent: true,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      materials.line.dispose()
      materials.fill.dispose()
      materials.fillSelected.dispose()
    },
    [materials],
  )
  useFrame(() => {
    const level = levelId ? sceneRegistry.nodes.get(levelId) : null
    if (!root.current) return
    root.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      root.current.matrix.copy(level.matrixWorld)
    }
  })
  if (!levelId || openings.length === 0) return null
  const selected = openings.find((opening) => opening.id === selectedId) ?? null
  return (
    <>
      <group matrixAutoUpdate={false} ref={root}>
        {openings.map((opening) => (
          <OpeningOutline
            elevation={openingElevation(nodes, opening)}
            key={opening.id}
            materials={materials}
            opening={opening}
            selected={opening.id === selectedId}
          />
        ))}
      </group>
      {selected && !readOnly && selected.source !== 'stair' && selected.source !== 'elevator' && (
        <PolygonEditor
          allowEdgeMove
          color={COLOR}
          levelId={levelId}
          minVertices={3}
          onPolygonChange={(polygon) => useScene.getState().updateNode(selected.id, { polygon })}
          polygon={selected.polygon}
          surfaceHeight={openingElevation(nodes, selected)}
        />
      )}
    </>
  )
}
