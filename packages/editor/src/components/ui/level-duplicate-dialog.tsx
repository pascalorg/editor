'use client'

import type { LevelNode } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import type { LevelDuplicatePreset } from '../../lib/level-duplication'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'

const DUPLICATE_PRESETS: Array<{
  id: LevelDuplicatePreset
  label: string
  description: string
}> = [
  {
    id: 'everything',
    label: 'Everything',
    description: 'Structure, materials, furniture, and references.',
  },
  {
    id: 'structure',
    label: 'Structure only',
    description: 'Walls, slabs, roofs, stairs, windows, and doors without finishes.',
  },
  {
    id: 'structure-materials',
    label: 'Structure + materials',
    description: 'Structure with the current material and finish assignments.',
  },
  {
    id: 'structure-furniture',
    label: 'Structure + furniture',
    description: 'Structure, finishes, and placed items, without guide references.',
  },
]

function getLevelLabel(level: LevelNode | null) {
  if (!level) return 'this level'
  return level.name || `Level ${level.level}`
}

export function LevelDuplicateDialog({
  open,
  level,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  level: LevelNode | null
  onConfirm: (preset: LevelDuplicatePreset) => void
  onOpenChange: (open: boolean) => void
}) {
  const [preset, setPreset] = useState<LevelDuplicatePreset>('everything')

  useEffect(() => {
    if (open) {
      setPreset('everything')
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Duplicate Level</DialogTitle>
          <DialogDescription>
            Choose what to copy from {getLevelLabel(level)}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {DUPLICATE_PRESETS.map((option) => (
            <button
              className={cn(
                'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                preset === option.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background hover:bg-accent/40',
              )}
              key={option.id}
              onClick={() => setPreset(option.id)}
              type="button"
            >
              <div className="font-medium text-sm">{option.label}</div>
              <div className="mt-1 text-muted-foreground text-xs">{option.description}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button
            className="cursor-pointer rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity hover:opacity-90"
            onClick={() => onConfirm(preset)}
            type="button"
          >
            Duplicate
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
