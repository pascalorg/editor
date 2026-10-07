'use client'

import {
  type AnyNodeId,
  adjacentLevelId,
  area,
  floorOpeningHints,
  getLevelDisplayName,
  useScene,
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

/**
 * A floor (or ceiling) opening: where it is, what it cuts, and the switch for
 * the adjacent surface — "Also cut the ceiling below" for an opening drawn on
 * a floor, "Also cut the floor above" for one drawn on a ceiling. A hatch in a
 * mezzanine cuts only the mezzanine. Its shape is edited with the corner
 * handles in the scene. Done and Delete return to the room.
 */
export function FloorOpeningPanel({ openingId }: { openingId: string }) {
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((s) => s.unit)
  const readOnly = useScene((state) => state.readOnly)
  const opening = nodes[openingId as AnyNodeId]
  if (opening?.type !== 'floor-opening') return null
  const onCeiling = opening.drawnOn === 'ceiling'
  const zoneId = openingRoom(nodes, opening)
  const zone = zoneId ? nodes[zoneId as AnyNodeId] : undefined
  const roomName = zone?.type === 'zone' ? zone.name?.trim() || 'Room' : null
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
  const title = opening.source === 'stair'
    ? 'Stair opening'
    : opening.source === 'elevator'
      ? 'Elevator opening'
      : onCeiling ? 'Ceiling opening' : 'Floor opening'
  const kicker = [
    'Opening',
    roomName ? `in ${roomName}` : null,
    level?.type === 'level' ? getLevelDisplayName(level) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const switchLabel = onCeiling ? 'Also cut the floor above' : 'Also cut the ceiling below'
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
          {formatAreaLabel(area([{ outer: opening.polygon, holes: [] }]), unit, 2)}
          {owned ? ' · Shape follows its owner.' : ' · Drag its corners to change the shape.'}
        </p>
        {owned && (
          <button
            className="text-left text-xs text-primary underline"
            data-opening-owner={opening.ownerId}
            onClick={() => useViewer.getState().setSelection({ selectedIds: [opening.ownerId!] })}
            type="button"
          >
            Owned by {opening.source === 'stair' ? 'Staircase' : 'Elevator'}
          </button>
        )}
        {hosted ? (
          <p className="text-muted-foreground text-xs" data-opening-hosted>
            A hatch in the mezzanine: it cuts only the mezzanine’s floor.
          </p>
        ) : owned ? null : (
          <label className="flex items-start gap-3" data-opening-adjacent>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="font-medium text-[13px] text-foreground">{switchLabel}</span>
              <span className="text-muted-foreground text-xs">
                {adjacent?.type === 'level'
                  ? `On ${getLevelDisplayName(adjacent)}, as one void with this opening.`
                  : onCeiling
                    ? 'There is no floor above this storey.'
                    : 'There is no storey below.'}
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
            Done
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
            Delete
          </Button>}
        </div>
      </div>
    </PanelWrapper>
  )
}
