'use client'

import {
  type AnyNodeId,
  adjacentLevelId,
  area,
  floorOpeningHints,
  useScene, usePascalI18n,
  useLocale,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  deleteFloorOpening,
  finishFloorOpening,
  openingRoom,
} from '../../../lib/floor-edit-session'
import { formatAreaLabel } from '../../../lib/measurements'
import { Button } from '../primitives/button'
import { Switch } from '../primitives/switch'
import { PanelWrapper } from './panel-wrapper'
import { localizedLevelName } from '../../../i18n/level-name'
import { nodeLabel } from '../../../i18n/node-messages'
import { displayRoomName } from '../../../lib/room-name-messages'

/**
 * A floor (or ceiling) opening: where it is, what it cuts, and the switch for
 * the adjacent surface — "Also cut the ceiling below" for an opening drawn on
 * a floor, "Also cut the floor above" for one drawn on a ceiling. A hatch in a
 * mezzanine cuts only the mezzanine. Its shape is edited with the corner
 * handles in the scene. Done and Delete return to the room.
 */
export function FloorOpeningPanel({ openingId }: { openingId: string }) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((s) => s.unit)
  const readOnly = useScene((state) => state.readOnly)
  const opening = nodes[openingId as AnyNodeId]
  if (opening?.type !== 'floor-opening') return null
  const onCeiling = opening.drawnOn === 'ceiling'
  const zoneId = openingRoom(nodes, opening)
  const zone = zoneId ? nodes[zoneId as AnyNodeId] : undefined
  const storedRoomName = zone?.type === 'zone' ? zone.name?.trim() : undefined
  const roomName =
    zone?.type !== 'zone'
      ? null
      : storedRoomName
        ? displayRoomName(storedRoomName, i18n)
        : i18n._({ id: 'editor.panels.floorOpeningPanel.room', message: 'Room' })
  const level = opening.parentId ? nodes[opening.parentId as AnyNodeId] : undefined
  const adjacentId = opening.parentId
    ? adjacentLevelId(nodes, opening.parentId, onCeiling ? 1 : -1)
    : undefined
  const adjacent = adjacentId ? nodes[adjacentId as AnyNodeId] : undefined
  const hosted = !!opening.hostZoneId
  const owned =
    (opening.source === 'stair' || opening.source === 'elevator') &&
    !!opening.ownerId &&
    nodes[opening.ownerId as AnyNodeId]?.type === opening.source
  const hints = floorOpeningHints(nodes, opening)
  const title = i18n._({
    id: 'editor.panels.floorOpeningPanel.title',
    message:
      '{source, select, stair {Stair opening} elevator {Elevator opening} ceiling {Ceiling opening} other {Floor opening}}',
    values: { source: opening.source === 'stair' || opening.source === 'elevator' ? opening.source : onCeiling ? 'ceiling' : 'floor' },
  })
  const levelName = level?.type === 'level' ? localizedLevelName(level, i18n, locale) : null
  const kicker = roomName
    ? levelName
      ? i18n._({
          id: 'editor.panels.floorOpeningPanel.kickerRoomLevel',
          message: 'Opening · in {room} · {level}',
          values: { room: roomName, level: levelName },
        })
      : i18n._({
          id: 'editor.panels.floorOpeningPanel.kickerRoom',
          message: 'Opening · in {room}',
          values: { room: roomName },
        })
    : levelName
      ? i18n._({
          id: 'editor.panels.floorOpeningPanel.kickerLevel',
          message: 'Opening · {level}',
          values: { level: levelName },
        })
      : i18n._({ id: 'editor.panels.floorOpeningPanel.kicker', message: 'Opening' })
  const switchLabel = onCeiling
    ? i18n._({ id: 'editor.panels.floorOpeningPanel.alsoCutTheFloorAbove', message: 'Also cut the floor above' })
    : i18n._({ id: 'editor.panels.floorOpeningPanel.alsoCutTheCeilingBelow', message: 'Also cut the ceiling below' })
  const setAdjacent = (next: boolean) =>
    useScene.getState().updateNode(opening.id, { cutsAdjacent: next })

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      kicker={kicker}
      onClose={() => finishFloorOpening(opening.id)}
      title={title}
    >
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4 text-sm" data-floor-opening-panel={opening.id}>
        <p className="text-muted-foreground text-xs">
          {owned
            ? i18n._({
                id: 'editor.panels.floorOpeningPanel.areaOwned',
                message: '{area} · Shape follows its owner.',
                values: { area: formatAreaLabel(area([{ outer: opening.polygon, holes: [] }]), unit, 2) },
              })
            : i18n._({
                id: 'editor.panels.floorOpeningPanel.areaDragCorners',
                message: '{area} · Drag its corners to change the shape.',
                values: { area: formatAreaLabel(area([{ outer: opening.polygon, holes: [] }]), unit, 2) },
              })}
        </p>
        {owned && (
          <button
            className="text-left text-xs text-primary underline"
            data-opening-owner={opening.ownerId}
            onClick={() => useViewer.getState().setSelection({ selectedIds: [opening.ownerId!] })}
            type="button"
          >
            {opening.source === 'stair'
              ? i18n._({ id: 'editor.panels.floorOpeningPanel.ownedByStaircase', message: 'Owned by Staircase' })
              : i18n._({ id: 'editor.panels.floorOpeningPanel.ownedByElevator', message: 'Owned by Elevator' })}
          </button>
        )}
        {hosted ? (
          <p className="text-muted-foreground text-xs" data-opening-hosted>
            {i18n._({ id: 'editor.panels.floorOpeningPanel.aHatchInTheMezzanineIt', message: 'A hatch in the mezzanine: it cuts only the mezzanine’s floor.' })}
          </p>
        ) : owned ? null : (
          <label className="flex items-start gap-3" data-opening-adjacent>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="font-medium text-[13px] text-foreground">{switchLabel}</span>
              <span className="text-muted-foreground text-xs">
                {adjacent?.type === 'level'
                  ? i18n._({
                      id: 'editor.panels.floorOpeningPanel.oneVoidWith',
                      message: 'On {level}, as one void with this opening.',
                      values: { level: localizedLevelName(adjacent, i18n, locale) },
                    })
                  : onCeiling
                    ? i18n._({ id: 'editor.panels.floorOpeningPanel.thereIsNoFloorAboveThis', message: 'There is no floor above this storey.' })
                    : i18n._({ id: 'editor.panels.floorOpeningPanel.thereIsNoStoreyBelow', message: 'There is no storey below.' })}
              </span>
            </span>
            <Switch
              aria-label={switchLabel}
              checked={opening.cutsAdjacent && adjacent?.type === 'level'}
              disabled={readOnly || adjacent?.type !== 'level'}
              onCheckedChange={setAdjacent}
            />
          </label>
        )}
        {hints.map((hint) => (
          <p className="text-muted-foreground text-xs" data-opening-hint={hint.code} key={hint.code}>
            {hint.message}
          </p>
        ))}
        <div className="flex items-center gap-2">
          <Button
            className="flex-1 rounded-full"
            data-opening-done
            onClick={() => finishFloorOpening(opening.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            {i18n._({ id: 'editor.panels.floorOpeningPanel.done', message: 'Done' })}
          </Button>
          {!owned && <Button
            className="flex-1 rounded-full"
            data-opening-delete
            disabled={readOnly}
            onClick={() => deleteFloorOpening(opening.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            {i18n._({ id: 'editor.panels.floorOpeningPanel.delete', message: 'Delete' })}
          </Button>}
        </div>
      </div>
    </PanelWrapper>
  )
}
