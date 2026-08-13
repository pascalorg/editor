'use client'

import { type RefObject, useState } from 'react'
import { ArrowRightIcon } from './icons'
import { ASSISTANT_SUGGESTIONS } from './scene-data'

export interface AssistantBarProps {
  inputRef: RefObject<HTMLInputElement | null>
}

export function AssistantBar({ inputRef }: AssistantBarProps) {
  const [command, setCommand] = useState('')
  const canRun = command.trim().length > 0

  return (
    <form
      className="-translate-x-1/2 absolute bottom-4 left-1/2 z-30 w-[min(560px,calc(100%-140px))] border-2 border-[var(--rule-strong)] bg-[var(--ground)] shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canRun) return
        setCommand('')
      }}
    >
      <div className="flex items-center gap-2.5 border-[var(--rule)] border-b px-3 py-2">
        <span className="h-2 w-2 flex-shrink-0 bg-[var(--accent)]" />
        <span className="mn-mono font-semibold text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">
          Menart Asistan
        </span>
        <span className="ml-auto text-[12px] text-[var(--faint)]">⌘K</span>
      </div>

      <div className="flex items-stretch">
        <input
          className="mn-input p-3 text-[14px]"
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Zemin katta 3.5 m'lik iç duvar çiz…"
          ref={inputRef}
          value={command}
        />
        <button
          className="flex items-center gap-2 bg-[var(--accent)] px-[18px] font-extrabold text-[13px] text-[var(--color-bg)] hover:bg-[var(--accent-hi)] disabled:opacity-45"
          disabled={!canRun}
          type="submit"
        >
          <span>Çalıştır</span>
          <ArrowRightIcon size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-[var(--rule)] border-t px-3 py-2">
        {ASSISTANT_SUGGESTIONS.map((suggestion) => (
          <button
            className="border border-[var(--rule-strong)] px-2 py-[3px] text-[12px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
            key={suggestion}
            onClick={() => {
              setCommand(suggestion)
              inputRef.current?.focus()
            }}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  )
}
