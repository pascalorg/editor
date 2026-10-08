'use client'

import {
  type AnyNode,
  buildUnitReport,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveRoomAssemblyHeights } from '../../lib/room-assembly-overlay'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import { describeZoneOutline, type RoomSelectionRecord } from '../../lib/room-selection'
import {
  selectViewerRoomInPlace,
  type ViewerSource,
  viewerRooms,
  zoneLabel,
} from '../../lib/viewer-selection'
import { RoomAssemblyMesh } from '../editor/room-highlight'
import {
  RoomLabelAnchor3D,
  RoomPillChip,
  RoomPillsLayer3D,
  roomLabelEntries,
  roomLabelsVisible,
} from '../editor/room-labels'

/**
 * Rooms on every viewer surface, as the editor shows them: the editor's pills
 * on the current floor while nothing but the floor is selected, and the
 * editor's room highlight on the selected or hovered room (or a focused
 * unit's rooms). Zones draw no tinted volume here, and their meshes are not
 * mounted at all, so they never catch a click.
 */
export function ViewerRooms({ source }: { source: ViewerSource }) {
  useEffect(() => {
    const before = useViewer.getState().showZones
    useViewer.getState().setShowZones(false)
    return () => useViewer.getState().setShowZones(before)
  }, [])
  const { levelId, zoneId, selectedIds } = useViewer(
    useShallow((s) => ({
      levelId: s.selection.levelId,
      zoneId: s.selection.zoneId,
      selectedIds: s.selection.selectedIds,
    })),
  )
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const hoveredId = useViewer((s) => s.hoveredId)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const { nodes } = source

  const pillsShown =
    !!levelId &&
    !walkthrough &&
    roomLabelsVisible({
      phase: 'building',
      mode: 'select',
      scopeIdle: true,
      room: null,
      zoneId,
      focusedUnitId,
      isCaptureMode: false,
      isThumbnailCapture: false,
      selectedTypes: selectedIds.map((id) => nodes[id]?.type),
    })

  const rooms = useMemo(() => (levelId ? viewerRooms(levelId, nodes) : []), [levelId, nodes])
  const entries = useMemo(() => {
    if (!levelId) return []
    const zones = Object.values(nodes).filter(
      (node): node is ZoneNode =>
        node.type === 'zone' && node.parentId === levelId && node.visible !== false,
    )
    return roomLabelEntries(
      rooms.filter((room) => nodes[room.zoneId]?.visible !== false),
      zones,
    )
  }, [levelId, nodes, rooms])

  const highlighted = useMemo(() => {
    if (walkthrough) return []
    const ids = new Set<string>()
    if (zoneId) ids.add(zoneId)
    if (hoveredId && nodes[hoveredId]?.type === 'zone') ids.add(hoveredId)
    const unit = focusedUnitId ? nodes[focusedUnitId] : undefined
    if (unit?.type === 'unit') {
      for (const member of buildUnitReport(unit, nodes).members)
        if (member.levelId === levelId) ids.add(member.zoneId)
    }
    return [...ids].flatMap((id): RoomSelectionRecord[] => {
      const zone = nodes[id]
      if (zone?.type !== 'zone' || !zone.parentId) return []
      const detected = viewerRooms(zone.parentId, nodes).find((room) => room.zoneId === id)
      return [detected ?? describeZoneOutline(zone.parentId, zone)]
    })
  }, [focusedUnitId, hoveredId, levelId, nodes, walkthrough, zoneId])

  return (
    <>
      {pillsShown && levelId ? (
        <RoomPillsLayer3D
          entries={entries}
          levelObject={() => source.objectFor(levelId)}
          renderLabel={(entry, anchors, elements) => {
            const zone = nodes[entry.zoneId]
            if (zone?.type !== 'zone') return null
            return (
              <RoomLabelAnchor3D
                anchors={anchors}
                entry={entry}
                floorY={roomFloorElevation(nodes as Record<string, AnyNode>, entry.zoneId)}
              >
                <RoomPillChip
                  areaM2={entry.area}
                  color={zone.color}
                  elements={elements}
                  name={zoneLabel(zone)}
                  onClick={() => selectViewerRoomInPlace(zone.id, nodes)}
                  onHover={() => useViewer.getState().setHoveredId(zone.id)}
                  onLeave={() => {
                    if (useViewer.getState().hoveredId === zone.id)
                      useViewer.getState().setHoveredId(null)
                  }}
                  view="3d"
                  zoneId={zone.id}
                />
              </RoomLabelAnchor3D>
            )
          }}
        />
      ) : null}
      {highlighted.map((room) => (
        <ViewerRoomHighlight key={room.zoneId} room={room} source={source} />
      ))}
    </>
  )
}

const parametricObject = (id: string) => sceneRegistry.nodes.get(id)

/** `ViewerRooms` over the parametric scene store. */
export function ParametricViewerRooms() {
  const nodes = useScene((s) => s.nodes)
  const source = useMemo<ViewerSource>(() => ({ nodes, objectFor: parametricObject }), [nodes])
  return <ViewerRooms source={source} />
}

function ViewerRoomHighlight({
  room,
  source,
}: {
  room: RoomSelectionRecord
  source: ViewerSource
}) {
  const heights = useMemo(
    () => resolveRoomAssemblyHeights(room, source.nodes as Record<string, AnyNode>),
    [room, source.nodes],
  )
  return (
    <RoomAssemblyMesh
      heights={heights}
      levelObject={() => source.objectFor(room.key.levelId)}
      room={room}
    />
  )
}
