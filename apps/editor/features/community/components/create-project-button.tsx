'use client'

import { Plus } from 'lucide-react'

interface CreateProjectButtonProps {
  onCreateProject: () => void
}

export function CreateProjectButton({ onCreateProject }: CreateProjectButtonProps) {
  return (
    <button
      onClick={onCreateProject}
      className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      <Plus className="w-4 h-4" />
      <span>Create Project</span>
    </button>
  )
}
