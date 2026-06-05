'use client'

import { Bot } from 'lucide-react'

const DEFAULT_AI_ASSISTANT_PATH = '/'

function aiAssistantUrl(): string {
  if (process.env.NEXT_PUBLIC_AI_ASSISTANT_URL) {
    return process.env.NEXT_PUBLIC_AI_ASSISTANT_URL
  }
  if (typeof window === 'undefined') {
    return `http://localhost:5900${DEFAULT_AI_ASSISTANT_PATH}`
  }
  return `${window.location.protocol}//${window.location.hostname}:5900${DEFAULT_AI_ASSISTANT_PATH}`
}

export function AiAssistantPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <Bot className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate font-medium text-sm">AI Assistant</span>
      </header>
      <iframe
        className="min-h-0 flex-1 border-0 bg-background"
        src={aiAssistantUrl()}
        title="AI Assistant"
      />
    </div>
  )
}
