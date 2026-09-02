'use client'

import { nodeRegistry, type ToolOption } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'
import { cn } from '../../../lib/utils'
import { triggerSFX } from '../../../lib/sfx-bus'

const ALWAYS_VISIBLE = {
  subscribe: () => () => {},
  value: () => true,
}

function ToolOptionRow({
  option,
  onSelect,
}: {
  option: ToolOption
  onSelect?: (option: ToolOption, value: string) => void
}) {
  const visibility = option.visible ?? ALWAYS_VISIBLE
  const visible = useSyncExternalStore(visibility.subscribe, visibility.value, visibility.value)
  const value = useSyncExternalStore(option.subscribe, option.value, option.value)
  if (!visible) return null

  const activeChoice = option.choices.find((choice) => choice.value === value)
  return (
    <div className="flex flex-col gap-2">
      <div className="px-0.5 font-medium text-muted-foreground text-xs">{option.label}</div>
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(option.choices.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {option.choices.map((choice) => {
          const active = choice.value === value
          return (
            <button
              aria-pressed={active}
              className={cn(
                'rounded-lg px-2 py-2 text-center font-medium text-xs transition-colors',
                active
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/50'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              key={choice.value}
              onClick={() => {
                triggerSFX('sfx:menu-click')
                option.set(choice.value)
                onSelect?.(option, choice.value)
              }}
              onMouseEnter={() => triggerSFX('sfx:menu-hover')}
              type="button"
            >
              {choice.label}
            </button>
          )
        })}
      </div>
      {activeChoice?.description ? (
        <p className="px-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {activeChoice.description}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The pick-one option rows a kind declares via `def.toolOptions` (e.g. the
 * roof's 'Create from: Draw / Room'), for whichever sidebar the host mounts
 * it in — the standalone Build tab and the community Build sidebar both get
 * every kind's options with no per-kind wiring. Renders nothing for kinds
 * without options. Selecting a choice only writes the kind's own state;
 * hosts that want selection to also arm the tool pass `onSelect`.
 */
export function ToolOptionsPanel({
  kind,
  className,
  onSelect,
}: {
  kind: string | null | undefined
  className?: string
  onSelect?: (option: ToolOption, value: string) => void
}) {
  const options = (kind ? nodeRegistry.get(kind)?.toolOptions : undefined) ?? []
  if (options.length === 0) return null
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {options.map((option) => (
        <ToolOptionRow key={option.id} onSelect={onSelect} option={option} />
      ))}
    </div>
  )
}
