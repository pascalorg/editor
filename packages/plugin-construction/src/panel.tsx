'use client'

import { useScene } from '@pascal-app/core'
import { useId, useMemo, useState } from 'react'
import { ConstructionExplorer } from './explorer'
import { inspectConstruction } from './inventory'

export default function ConstructionPanel() {
  const nodes = useScene((state) => state.nodes)
  const id = useId()
  const [buildingId, setBuildingId] = useState('')
  const inventory = useMemo(
    () => inspectConstruction(nodes, buildingId || undefined),
    [nodes, buildingId],
  )
  const scopeMessage = inventory.invalidScope
    ? 'The selected building is no longer in this model. Choose a building to continue.'
    : inventory.scopeRequired
      ? 'Choose a building to inspect its records and export an inventory.'
      : undefined

  return (
    <div className="h-full min-w-0 overflow-y-auto p-4">
      <header className="mb-5 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg">Construction</h2>
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs">
            Preview
          </span>
        </div>
        <p className="text-muted-foreground text-sm">Understand the model. Prepare the handoff.</p>
        {inventory.buildings.length > 1 || inventory.invalidScope ? (
          <div className="pt-2">
            <label className="text-muted-foreground text-xs" htmlFor={id}>
              Building to review
            </label>
            <select
              className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id={id}
              onChange={(event) => setBuildingId(event.target.value)}
              value={inventory.invalidScope ? '' : buildingId}
            >
              <option value="">Choose a building</option>
              {inventory.buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="pt-1 text-muted-foreground text-xs">
            {inventory.buildings[0]?.name ?? 'Current model'} · {inventory.records.length}{' '}
            recognized {inventory.records.length === 1 ? 'record' : 'records'}
          </p>
        )}
        {inventory.unrecognizedCount > 0 && (
          <p className="text-muted-foreground text-xs">
            {inventory.unrecognizedCount} other{' '}
            {inventory.unrecognizedCount === 1 ? 'record is' : 'records are'} outside this
            inventory’s categories.
          </p>
        )}
        {inventory.unscopedCount > 0 && (
          <p className="text-muted-foreground text-xs">
            {inventory.unscopedCount}{' '}
            {inventory.unscopedCount === 1 ? 'record has' : 'records have'} no building or site
            assignment and cannot be included in this scope.
          </p>
        )}
      </header>
      <ConstructionExplorer records={inventory.records} scopeMessage={scopeMessage} />
    </div>
  )
}
