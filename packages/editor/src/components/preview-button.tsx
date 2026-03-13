'use client'

import { Eye } from 'lucide-react'
import useEditor from '../store/use-editor'

export function PreviewButton() {
  return (
    <button
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 font-medium text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent/90"
      onClick={() => useEditor.getState().setPreviewMode(true)}
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="hidden whitespace-nowrap sm:inline">Preview</span>
    </button>
  )
}
