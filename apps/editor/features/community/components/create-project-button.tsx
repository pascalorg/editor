'use client'

import { Plus } from 'lucide-react'

interface CreateProjectButtonProps {
  onCreateProject: () => void
}

export function CreateProjectButton({ onCreateProject }: CreateProjectButtonProps) {
  return (
    <button
      onClick={onCreateProject}
      className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      <Plus className="w-4 h-4" />
      <span>Create Project</span>
    </button>
  )
}
