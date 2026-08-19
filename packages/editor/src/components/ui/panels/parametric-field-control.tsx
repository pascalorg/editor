'use client'

import type { AnyNode, ParamField } from '@pascal-app/core'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { precisionForStep, prettifyEnumValue, prettifyKey } from './parametric-field-utils'

interface ParametricFieldControlProps {
  field: ParamField<AnyNode>
  value: unknown
  mixed?: boolean
  onChange: (patch: Partial<AnyNode>) => void
  onCommit?: (patch: Partial<AnyNode>) => void
}

export function ParametricFieldControl({
  field,
  value,
  mixed = false,
  onChange,
  onCommit,
}: ParametricFieldControlProps) {
  const key = String(field.key)

  switch (field.kind) {
    case 'number': {
      const num = typeof value === 'number' ? value : 0
      const step = field.step ?? 0.01
      const precision = precisionForStep(step)
      return (
        <SliderControl
          label={prettifyKey(key)}
          max={field.max}
          min={field.min}
          mixed={mixed}
          onChange={(next) => onChange({ [key]: next } as Partial<AnyNode>)}
          onCommit={onCommit ? (next) => onCommit({ [key]: next } as Partial<AnyNode>) : undefined}
          precision={precision}
          restoreOnCommit={!onCommit}
          step={step}
          unit={field.unit ?? ''}
          value={num}
        />
      )
    }

    case 'boolean': {
      const checked = !mixed && value === true
      return (
        <ToggleControl
          checked={checked}
          label={prettifyKey(key)}
          mixed={mixed}
          onChange={(next) => {
            const patch = { [key]: next } as Partial<AnyNode>
            onChange(patch)
            onCommit?.(patch)
          }}
        />
      )
    }

    case 'enum': {
      const str = typeof value === 'string' ? value : (field.options[0] ?? '')
      const apply = (next: string) => {
        const patch = { [key]: next } as Partial<AnyNode>
        onChange(patch)
        onCommit?.(patch)
      }
      if (field.display === 'segmented') {
        return (
          <SegmentedControl
            mixed={mixed}
            onChange={apply}
            options={field.options.map((opt) => ({ label: prettifyEnumValue(opt), value: opt }))}
            value={str}
          />
        )
      }
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <select
            className="rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
            onChange={(e) => apply(e.target.value)}
            value={mixed ? '' : str}
          >
            {mixed && (
              <option disabled value="">
                Mixed
              </option>
            )}
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {prettifyEnumValue(opt)}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case 'color': {
      const str = typeof value === 'string' ? value : '#888888'
      const apply = (next: string) => {
        const patch = { [key]: next } as Partial<AnyNode>
        onChange(patch)
        onCommit?.(patch)
      }
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <div className="flex items-center gap-2">
            <input
              className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
              onChange={(e) => apply(e.target.value)}
              type="color"
              value={str}
            />
            <input
              className="w-20 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(e) => apply(e.target.value)}
              type="text"
              value={mixed ? 'Mixed' : str}
            />
          </div>
        </div>
      )
    }

    case 'vec3': {
      const v =
        Array.isArray(value) && value.length >= 3
          ? (value as [number, number, number])
          : ([0, 0, 0] as [number, number, number])
      const axes: Array<{ label: string; index: 0 | 1 | 2 }> = [
        { label: 'X', index: 0 },
        { label: 'Y', index: 1 },
        { label: 'Z', index: 2 },
      ]
      return (
        <>
          {axes.map(({ label, index }) => {
            const axisValue = v[index] ?? 0
            const apply = (next: number): Partial<AnyNode> => {
              const updated = [...v] as [number, number, number]
              updated[index] = next
              return { [key]: updated } as Partial<AnyNode>
            }
            return (
              <SliderControl
                key={`${key}-${label}`}
                label={label}
                max={axisValue + 5}
                min={axisValue - 5}
                mixed={mixed}
                onChange={(next) => onChange(apply(next))}
                onCommit={onCommit ? (next) => onCommit(apply(next)) : undefined}
                precision={2}
                restoreOnCommit={!onCommit}
                step={0.05}
                unit="m"
                value={Math.round(axisValue * 100) / 100}
              />
            )
          })}
        </>
      )
    }

    default:
      return null
  }
}
