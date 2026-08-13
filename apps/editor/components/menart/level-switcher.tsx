'use client'

import { cn } from '@/lib/utils'
import { PlusIcon } from './icons'
import { MENART_LEVELS } from './scene-data'

export interface LevelSwitcherProps {
  activeLevelId: string
  onSelect: (id: string) => void
}

export function LevelSwitcher({ activeLevelId, onSelect }: LevelSwitcherProps) {
  return (
    <div className="absolute top-14 left-4 z-20 w-[196px] border-2 border-[var(--rule-strong)] bg-[var(--ground)]">
      <div className="flex h-[26px] items-center justify-between border-[var(--rule-strong)] border-b-2 px-2">
        <span className="mn-mono font-semibold text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">
          Katlar
        </span>
        <button
          className="flex h-4 w-4 items-center justify-center text-[var(--muted)] hover:text-[var(--accent)]"
          title="Kat ekle"
          type="button"
        >
          <PlusIcon size={12} strokeWidth={2.5} />
        </button>
      </div>

      {MENART_LEVELS.map((level, index) => {
        const isActive = level.id === activeLevelId
        return (
          <button
            aria-pressed={isActive}
            className={cn(
              'flex h-[30px] w-full items-center gap-2 px-2 text-[13px]',
              index < MENART_LEVELS.length - 1 && 'border-[var(--rule)] border-b',
              isActive
                ? 'bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[inset_3px_0_0_var(--accent)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
            )}
            key={level.id}
            onClick={() => onSelect(level.id)}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate text-left">{level.label}</span>
            <span
              className={cn(
                'mn-mono text-[10px]',
                isActive ? 'text-[var(--muted)]' : 'text-[var(--faint)]',
              )}
            >
              {level.value} m
            </span>
          </button>
        )
      })}
    </div>
  )
}
