'use client'

import {
  type AnyNode,
  buildUnitReport,
  polygonInteriorPoint,
  roomFloorElevation,
  sceneRegistry,
  useLocale,
  usePascalI18n,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useCallback, useEffect, useMemo } from 'react'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { SelectionCallout } from '../../../components/viewer/selection-callout'
import useViewer from '../../../store/use-viewer'
import { formatRoomArea } from '../../lib/room-area'
import { resolveRoomAssemblyHeights } from '../../lib/room-assembly-overlay'
import { describeZoneOutline, type RoomSelectionRecord } from '../../lib/room-selection'
import {
  selectViewerRoom,
  type ViewerSource,
  viewerRooms,
  zoneLabel,
} from '../../lib/viewer-selection'
import { RoomAssemblyMesh } from './room-highlight'
import {
  RoomLabelAnchor3D,
  type RoomLabelEntry,
  RoomPillChip,
  RoomPillDetail,
  RoomPillsLayer3D,
  roomLabelEntries,
  roomLabelsVisible,
  useFadePresence,
} from './room-labels'

/**
 * Rooms on every viewer surface, as the editor shows them: the room pills on
 * the current floor while nothing but the floor is selected, the room
 * highlight on the selected or hovered room (or a focused unit's rooms), and
 * the selected room's callout. Zones draw no tinted volume here, and their
 * meshes are not mounted at all, so they never catch a click.
 */
export function ViewerRooms({ source }: { source: ViewerSource }) {
  const i18n = usePascalI18n()
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
      zoneId,
      focusedUnitId,
      selectedTypes: selectedIds.map((id) => nodes[id]?.type),
    })

  // The layer stays mounted through its fade-out.
  const pillsPresent = useFadePresence(pillsShown)

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
      {pillsPresent && levelId ? (
        <RoomPillsLayer3D
          entries={entries}
          // A level of its own: nothing open or placed on one floor carries to the next.
          key={levelId}
          levelObject={() => source.objectFor(levelId)}
          renderDetail={(entry) => {
            const zone = nodes[entry.zoneId]
            if (zone?.type !== 'zone') return null
            return (
              <RoomPillDetail
                areaM2={entry.area}
                color={zone.color}
                name={zoneLabel(zone, i18n)}
                view="3d"
                zoneId={zone.id}
              />
            )
          }}
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
                  name={zoneLabel(zone, i18n)}
                  onClick={() => selectViewerRoom(zone.id, source)}
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
          shown={pillsShown}
        />
      ) : null}
      {highlighted.map((room) => (
        <ViewerRoomHighlight key={room.zoneId} room={room} source={source} />
      ))}
      {zoneId && levelId && !walkthrough && selectedIds.length === 0
        ? (() => {
            const entry = entries.find((candidate) => candidate.zoneId === zoneId)
            const zone = nodes[zoneId]
            const level = source.objectFor(levelId)
            return entry && zone?.type === 'zone' && level ? (
              <ViewerRoomCallout
                entry={entry}
                floorY={roomFloorElevation(nodes as Record<string, AnyNode>, zoneId)}
                key={zoneId}
                level={level}
                name={zoneLabel(zone, i18n)}
              />
            ) : null
          })()
        : null}
    </>
  )
}

/** The selected room's callout: its name and area at a point inside it, and the close button. */
function ViewerRoomCallout({
  entry,
  floorY,
  level,
  name,
}: {
  entry: RoomLabelEntry
  floorY: number
  level: NonNullable<ReturnType<ViewerSource['objectFor']>>
  name: string
}) {
  const unit = useViewer((s) => s.unit)
  const locale = useLocale()
  const anchor = useMemo(() => {
    const [x, z] = polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes })
    return new Vector3(x, floorY + 0.05, z)
  }, [entry.polygon, entry.holes, floorY])
  const dismiss = useCallback(() => {
    const { selection, setSelection } = useViewer.getState()
    if (selection.zoneId === entry.zoneId) setSelection({ zoneId: null })
  }, [entry.zoneId])
  return (
    <SelectionCallout
      actions={[]}
      anchor={anchor}
      object={level}
      onDismiss={dismiss}
      subtitle={formatRoomArea(entry.area, unit, locale)}
      title={name}
    />
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
