'use client'

import { Bot, MessageCircle, X } from 'lucide-react'
import { useState } from 'react'

const AI_ASSISTANT_URL = 'http://localhost:5900/#/thread/019e6cd5-8332-76c1-9338-6e20185faea5'

export function AiAssistantBubble() {
  const [open, setOpen] = useState(false)

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section className="pointer-events-auto flex h-[min(680px,calc(100vh-7rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border/70 bg-background shadow-2xl sm:w-[440px]">
          <header className="flex h-11 shrink-0 items-center justify-between border-border/70 border-b bg-background/95 px-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate font-medium text-sm">AI Assistant</span>
            </div>
            <button
              aria-label="Close AI assistant"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>
          <iframe
            className="min-h-0 flex-1 bg-background"
            src={AI_ASSISTANT_URL}
            title="AI Assistant"
          />
        </section>
      )}
      <button
        aria-label={open ? 'Hide AI assistant' : 'Open AI assistant'}
        aria-pressed={open}
        className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-foreground text-background shadow-xl transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden />
        )}
      </button>
    </div>
  )
}
