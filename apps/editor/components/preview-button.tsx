'use client'

import { Eye } from 'lucide-react'
import useEditor from '@/store/use-editor'

export function PreviewButton() {
  return (
    <button
      onClick={() => useEditor.getState().setPreviewMode(true)}
      className="flex items-center gap-2 rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-md px-3 py-2 text-sm font-medium cursor-pointer hover:bg-accent/90 transition-colors"
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline whitespace-nowrap">Preview</span>
    </button>
  )
}
