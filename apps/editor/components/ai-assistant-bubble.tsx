'use client'

import { Bot } from 'lucide-react'

const AI_ASSISTANT_URL = 'http://localhost:5900/#/thread/019e6cd5-8332-76c1-9338-6e20185faea5'

export function AiAssistantPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <Bot className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate font-medium text-sm">AI Assistant</span>
      </header>
      <iframe
        className="min-h-0 flex-1 border-0 bg-background"
        src={AI_ASSISTANT_URL}
        title="AI Assistant"
      />
    </div>
  )
}
