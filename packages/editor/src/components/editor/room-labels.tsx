'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  roomFloorElevation,
  sceneRegistry,
  usePascalI18n,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  RoomLabelAnchor3D,
  type RoomLabelEntry,
  type RoomLabelSelection,
  RoomPillChip,
  RoomPillDetail,
  RoomPillsLayer2D,
  RoomPillsLayer3D,
  roomLabelEntries,
  roomLabelsVisible,
  selectionModifiersFromEvent,
  useFadePresence,
  zoneLabel,
} from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useRoomRecords } from '../../hooks/use-selected-room'
import { clickZoneArea, hoverZoneArea, leaveZoneArea } from '../../lib/room-zone-routing'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { isViewVisible, VIEW_2D, VIEW_3D } from '../../store/view-layout'

export type RoomLabelVisibilityState = RoomLabelSelection & {
  phase: string
  mode: string
  scopeIdle: boolean
  room: unknown
  isCaptureMode: boolean
  isThumbnailCapture: boolean
}

/**
 * In the editor, the pills are the resting view of a level only inside the
 * building with the select tool idle: a room kept, a capture or a gesture in
 * flight takes them away too.
 */
export function editorRoomLabelsVisible(state: RoomLabelVisibilityState): boolean {
  return (
    state.phase === 'building' &&
    state.mode === 'select' &&
    state.scopeIdle &&
    !state.room &&
    !state.isCaptureMode &&
    !state.isThumbnailCapture &&
    roomLabelsVisible(state)
  )
}

function useRoomLabelsVisible() {
  const [isThumbnailCapture, setThumbnailCapture] = useState(false)
  useEffect(() => {
    const hide = () => setThumbnailCapture(true)
    const restore = () => setThumbnailCapture(false)
    emitter.on('thumbnail:before-capture', hide)
    emitter.on('thumbnail:after-capture', restore)
    return () => {
      emitter.off('thumbnail:before-capture', hide)
      emitter.off('thumbnail:after-capture', restore)
    }
  }, [])
  const editor = useEditor(
    useShallow((s) => ({
      phase: s.phase,
      mode: s.mode,
      room: s.room,
      isCaptureMode: s.isCaptureMode,
    })),
  )
  const scopeIdle = useInteractionScope((s) => s.scope.kind === 'idle')
  const zoneId = useViewer((s) => s.selection.zoneId)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedTypes = useScene(
    useShallow((s) =>
      selectedIds.map((id) => (s.nodes[id as AnyNodeId] as AnyNode | undefined)?.type),
    ),
  )
  return editorRoomLabelsVisible({
    ...editor,
    scopeIdle,
    zoneId,
    focusedUnitId,
    selectedTypes,
    isThumbnailCapture,
  })
}

/**
 * One pill layer per level: the current level's fades in, a level just left
 * fades out over the next one, then unmounts.
 */
function useFadingLevels(levelId: string | null, visible: boolean) {
  const [levels, setLevels] = useState<string[]>([])
  useEffect(() => {
    if (levelId && visible) {
      setLevels((previous) => (previous.includes(levelId) ? previous : [...previous, levelId]))
    }
  }, [levelId, visible])
  const drop = useCallback(
    (id: string) => setLevels((previous) => previous.filter((level) => level !== id)),
    [],
  )
  return { levels, drop }
}

function useRoomLabelEntries(levelId: string | null): RoomLabelEntry[] {
  const rooms = useRoomRecords(levelId)
  const zones = useScene(
    useShallow((s) =>
      levelId
        ? Object.values(s.nodes).filter(
            (node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId,
          )
        : [],
    ),
  )
  return useMemo(() => roomLabelEntries(rooms, zones), [rooms, zones])
}

function useLabelZone(zoneId: string) {
  const zone = useScene((s) => s.nodes[zoneId as AnyNodeId] as ZoneNode | undefined)
  return zone && zone.visible !== false ? zone : null
}

/**
 * One room's pill in the editor. Hover and click take the same rule as the
 * zone's area in the plan (`hoverZoneArea`, `clickZoneArea`); only the pill
 * itself takes the pointer.
 */
function RoomPill({
  entry,
  view,
  elements,
}: {
  entry: RoomLabelEntry
  view: '2d' | '3d'
  elements: Map<string, HTMLElement>
}) {
  const i18n = usePascalI18n()
  const zone = useLabelZone(entry.zoneId)
  // A pill that disappears under the cursor (its click selected something)
  // fires no leave: end the hover it set.
  useEffect(() => () => leaveZoneArea(entry.zoneId), [entry.zoneId])
  if (!zone) return null
  return (
    <RoomPillChip
      areaM2={entry.area}
      color={zone.color}
      elements={elements}
      name={zoneLabel(zone, i18n)}
      onClick={(event) => clickZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onHover={(event) => hoverZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onLeave={() => leaveZoneArea(entry.zoneId)}
      view={view}
      zoneId={entry.zoneId}
    />
  )
}

function RoomDetail({ entry, view }: { entry: RoomLabelEntry; view: '2d' | '3d' }) {
  const i18n = usePascalI18n()
  const zone = useLabelZone(entry.zoneId)
  if (!zone) return null
  return (
    <RoomPillDetail
      areaM2={entry.area}
      color={zone.color}
      name={zoneLabel(zone, i18n)}
      view={view}
      zoneId={entry.zoneId}
    />
  )
}

const renderDetail2D = (entry: RoomLabelEntry) => <RoomDetail entry={entry} view="2d" />
const renderDetail3D = (entry: RoomLabelEntry) => <RoomDetail entry={entry} view="3d" />

/** Light name-and-area pills over each room and drawn zone of the active level. */
export function RoomLabels3D() {
  const levelId = useViewer((s) => s.selection.levelId)
  const sceneShown = useEditor((s) => isViewVisible(s, VIEW_3D))
  const visible = useRoomLabelsVisible() && sceneShown
  const { levels, drop } = useFadingLevels(levelId, visible)
  return levels.map((id) => (
    <LevelRoomLabels3D key={id} levelId={id} onGone={drop} shown={visible && id === levelId} />
  ))
}

function LevelRoomLabels3D({
  levelId,
  shown,
  onGone,
}: {
  levelId: string
  shown: boolean
  onGone: (levelId: string) => void
}) {
  const present = useFadePresence(shown, () => onGone(levelId))
  const entries = useRoomLabelEntries(present ? levelId : null)
  if (!present) return null
  return (
    <RoomPillsLayer3D
      entries={entries}
      levelObject={() => sceneRegistry.nodes.get(levelId)}
      renderDetail={renderDetail3D}
      renderLabel={(entry, anchors, elements) => (
        <EditorRoomLabel3D anchors={anchors} elements={elements} entry={entry} />
      )}
      shown={shown}
    />
  )
}

function EditorRoomLabel3D({
  entry,
  anchors,
  elements,
}: {
  entry: RoomLabelEntry
  anchors: Map<string, Vector3>
  elements: Map<string, HTMLElement>
}) {
  const floorY = useScene((s) => roomFloorElevation(s.nodes, entry.zoneId))
  return (
    <RoomLabelAnchor3D anchors={anchors} entry={entry} floorY={floorY}>
      <RoomPill elements={elements} entry={entry} view="3d" />
    </RoomLabelAnchor3D>
  )
}

/** The same pills over the 2D plan, for the plan's active level. */
export function RoomLabels2D({ levelId }: { levelId: string | null }) {
  const planShown = useEditor((s) => isViewVisible(s, VIEW_2D))
  const visible = useRoomLabelsVisible() && planShown
  const { levels, drop } = useFadingLevels(levelId, visible)
  return levels.map((id) => (
    <LevelRoomLabels2D key={id} levelId={id} onGone={drop} shown={visible && id === levelId} />
  ))
}

function LevelRoomLabels2D({
  levelId,
  shown,
  onGone,
}: {
  levelId: string
  shown: boolean
  onGone: (levelId: string) => void
}) {
  const present = useFadePresence(shown, () => onGone(levelId))
  const entries = useRoomLabelEntries(present ? levelId : null)
  if (!present) return null
  return (
    <RoomPillsLayer2D
      entries={entries}
      renderDetail={renderDetail2D}
      renderLabel={(entry, elements) => <RoomPill elements={elements} entry={entry} view="2d" />}
      shown={shown}
    />
  )
}
