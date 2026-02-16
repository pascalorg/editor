'use client'

import { Plus } from 'lucide-react'

interface CreatePropertyButtonProps {
  onCreateProperty: () => void
}

export function CreatePropertyButton({ onCreateProperty }: CreatePropertyButtonProps) {
  return (
    <button
      onClick={onCreateProperty}
      className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      <Plus className="w-4 h-4" />
      <span>Create Property</span>
    </button>
  )
}
