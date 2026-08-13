'use client'

import { cn } from '@/lib/utils'
import { CheckIcon } from './icons'

type StepStatus = 'done' | 'current' | 'pending'

const STEPS: { label: string; shortcut?: string; status: StepStatus }[] = [
  { label: 'Kat oluştur', status: 'done' },
  { label: 'İlk duvarı çiz', shortcut: 'W', status: 'current' },
  { label: 'Kapı yerleştir', shortcut: 'D', status: 'pending' },
]

const DONE_COUNT = STEPS.filter((step) => step.status === 'done').length

export function OnboardingChecklist({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="flex-shrink-0 border-[var(--rule-strong)] border-t-2 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="mn-mono font-semibold text-[11px] text-[var(--muted)] uppercase tracking-[0.1em]">
          Başlangıç · {DONE_COUNT}/{STEPS.length}
        </span>
        <button
          className="font-semibold text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
          onClick={onDismiss}
          type="button"
        >
          Gizle
        </button>
      </div>

      <div className="mb-2.5 flex h-1 gap-[3px]">
        {STEPS.map((step) => (
          <div
            className={cn(
              'flex-1',
              step.status === 'done' ? 'bg-[var(--ink)]' : 'bg-[var(--rule)]',
            )}
            key={step.label}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {STEPS.map((step) => (
          <li
            className={cn(
              'flex items-center gap-2 text-[13px]',
              step.status === 'done' && 'text-[var(--muted)] line-through',
              step.status === 'current' && 'font-semibold text-[var(--ink)]',
              step.status === 'pending' && 'text-[var(--muted)]',
            )}
            key={step.label}
          >
            {step.status === 'done' ? (
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center bg-[var(--ink)] text-[var(--ground)]">
                <CheckIcon size={10} />
              </span>
            ) : (
              <span
                className={cn(
                  'h-4 w-4 flex-shrink-0 border-2',
                  step.status === 'current'
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--rule-strong)]',
                )}
              />
            )}
            <span>{step.label}</span>
            {step.shortcut && (
              <span
                className={cn(
                  'mn-mono ml-auto text-[11px]',
                  step.status === 'current' ? 'text-[var(--muted)]' : 'text-[var(--faint)]',
                )}
              >
                {step.shortcut}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
