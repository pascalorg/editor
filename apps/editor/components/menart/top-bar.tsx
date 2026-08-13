'use client'

import Image from 'next/image'
import { AssistantIcon, RulerIcon, SunIcon } from './icons'
import { MENART_PROJECT } from './scene-data'

const CELL =
  'flex h-full items-center gap-2 border-[var(--rule-strong)] border-l-2 px-3.5 font-semibold text-[13px] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'

export interface TopBarProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  assistantOpen: boolean
  onToggleAssistant: () => void
}

export function TopBar({ theme, onToggleTheme, assistantOpen, onToggleAssistant }: TopBarProps) {
  return (
    <header className="flex h-12 flex-shrink-0 items-stretch border-[var(--rule-strong)] border-b-2 bg-[var(--ground)]">
      <div className="flex w-14 flex-shrink-0 items-center justify-center border-[var(--rule-strong)] border-r-2">
        <Image
          alt="Menart"
          className="h-6 w-6 object-contain"
          height={24}
          src="/menartlogo.webp"
          style={{ filter: 'var(--logo-filter)' }}
          width={24}
        />
      </div>

      <div className="flex items-center gap-2 border-[var(--rule-strong)] border-r-2 px-4">
        <span className="font-extrabold text-[15px] tracking-[-0.01em]">MENART</span>
        <span className="font-extrabold text-[15px] text-[var(--muted)]">3D</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="whitespace-nowrap font-semibold text-[14px]">{MENART_PROJECT.title}</span>
        <span className="mn-mono text-[11px] text-[var(--muted)] uppercase tracking-[0.06em]">
          {MENART_PROJECT.savedAt}
        </span>
      </div>

      <div className="flex items-center">
        <button className={CELL} type="button">
          <RulerIcon size={15} />
          <span>Metrik · m</span>
        </button>

        <button className={CELL} onClick={onToggleTheme} type="button">
          <SunIcon size={15} />
          <span>{theme === 'dark' ? 'Koyu' : 'Açık'}</span>
        </button>

        <button
          aria-pressed={assistantOpen}
          className="flex h-full items-center gap-2 border-[var(--rule-strong)] border-l-2 px-[18px] font-extrabold text-[13px] text-[var(--ink)] hover:bg-[var(--surface)]"
          onClick={onToggleAssistant}
          type="button"
        >
          <AssistantIcon size={15} />
          <span>Asistan</span>
        </button>
      </div>
    </header>
  )
}
