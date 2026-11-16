'use client'

import type { TerrainBreakNode } from '@pascal-app/core'
import { RampNumberField } from '../ramp/number-field'

type Options = Pick<TerrainBreakNode, 'kind' | 'left' | 'right'>

export function TerrainBreakOptions({
  value,
  onChange,
}: {
  value: Options
  onChange: (patch: Partial<Options>) => void
}) {
  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center justify-between">
        Kind
        <select
          aria-label="Terrain break kind"
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(event) => onChange({ kind: event.target.value as Options['kind'] })}
          value={value.kind}
        >
          <option value="cliff">Cliff</option>
          <option value="retaining">Retaining</option>
          <option value="soil">Soil</option>
        </select>
      </label>
      {(['left', 'right'] as const).map((side) => (
        <div className="space-y-1" key={side}>
          <label className="flex items-center justify-between">
            {side === 'left' ? 'Left side' : 'Right side'}
            <select
              aria-label={`${side} height mode`}
              className="rounded border border-border bg-background px-2 py-1"
              onChange={(event) =>
                onChange({ [side]: event.target.value === 'ground' ? 'ground' : 0 })
              }
              value={value[side] === 'ground' ? 'ground' : 'height'}
            >
              <option value="ground">Keep ground</option>
              <option value="height">Set height</option>
            </select>
          </label>
          {typeof value[side] === 'number' && (
            <RampNumberField
              label={side === 'left' ? 'Left elevation' : 'Right elevation'}
              onCommit={(height) => onChange({ [side]: height })}
              value={value[side] as number}
            />
          )}
        </div>
      ))}
    </div>
  )
}
