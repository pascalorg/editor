'use client'

import { area, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import {
  endFloorEdit,
  finishFloorEdit,
  roomSurfaceOpenings,
  startFloorEdit,
  useFloorEditSession,
} from '../../../lib/floor-edit-session'
import { type OpeningSurface, startOpeningDraft } from '../../../lib/floor-opening-draft'
import { formatAreaLabel } from '../../../lib/measurements'
import { pill } from './room-construction-rows'
import { ShapeChoice } from './shape-choice'

const count = (n: number) => `${n} ${n === 1 ? 'opening' : 'openings'}`

/**
 * A room's openings through its floor (or its ceiling), inside the row's
 * settings. The floor has "Edit floor": a session that outlines the openings
 * and lists them, with "Cut opening" to draw another — Rectangle or Polygon,
 * picked before drawing. The ceiling cuts directly (its own shape editing is
 * "Edit shape").
 */
export function RoomOpeningsField({
  zoneId,
  surface,
}: {
  zoneId: string
  surface: OpeningSurface
}) {
  const nodes = useScene((scene) => scene.nodes)
  const unit = useViewer((s) => s.unit)
  const readOnly = useScene((scene) => scene.readOnly)
  const openings = useMemo(
    () => roomSurfaceOpenings(nodes, zoneId, surface),
    [nodes, zoneId, surface],
  )
  const editing = useFloorEditSession((s) => surface === 'floor' && s.session?.zoneId === zoneId)
  const cut = (
    <ShapeChoice
      data={`cut-opening-${surface}`}
      disabled={readOnly}
      label="Cut opening"
      onPick={(shape) => startOpeningDraft(zoneId, surface, shape)}
    />
  )
  if (surface === 'ceiling')
    return (
      <div className="flex flex-col gap-1" data-room-openings={surface}>
        {openings.length > 0 && <span>{count(openings.length)}</span>}
        {cut}
      </div>
    )
  if (!editing)
    return (
      <div className="flex min-h-7 items-center justify-between gap-3" data-room-openings={surface}>
        <span>{openings.length ? count(openings.length) : 'No openings'}</span>
        <button
          className={pill}
          data-edit-floor
          onClick={() => startFloorEdit(zoneId)}
          type="button"
        >
          Edit floor
        </button>
      </div>
    )
  return (
    <div className="flex flex-col gap-1.5" data-room-openings={surface} data-editing-floor>
      {openings.length === 0 ? (
        <p>No openings yet. Cut one for a stair void or a hatch.</p>
      ) : (
        openings.map((opening, index) => (
          <button
            className="flex items-center justify-between rounded-md px-2 py-1 text-left transition-colors hover:bg-accent"
            data-floor-opening-row={opening.id}
            key={opening.id}
            onClick={() => useViewer.getState().setSelection({ selectedIds: [opening.id] })}
            type="button"
          >
            <span className="text-foreground">
              {opening.source === 'stair'
                ? 'Stair opening'
                : opening.source === 'elevator'
                  ? 'Elevator opening'
                  : `Opening ${index + 1}`}
            </span>
            <span className="font-mono tabular-nums">
              {formatAreaLabel(area([{ outer: opening.polygon, holes: [] }]), unit, 2)}
            </span>
          </button>
        ))
      )}
      {cut}
      <div className="flex items-center justify-end gap-2">
        <button
          className={pill}
          data-finish-floor-edit
          onClick={() => (finishFloorEdit() ? undefined : endFloorEdit())}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  )
}
