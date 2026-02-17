'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import type { LocalProject } from '../lib/local-storage/project-store'

interface LocalProjectMigrationDialogProps {
  localProjects: LocalProject[]
  open: boolean
  onMigrate: () => Promise<void>
  onSkip: () => void
}

export function LocalProjectMigrationDialog({
  localProjects,
  open,
  onMigrate,
  onSkip,
}: LocalProjectMigrationDialogProps) {
  const [isMigrating, setIsMigrating] = useState(false)

  const handleMigrate = async () => {
    setIsMigrating(true)
    try {
      await onMigrate()
    } finally {
      setIsMigrating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && !isMigrating && onSkip()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Save Local Projects to Cloud</DialogTitle>
          <DialogDescription>
            You have {localProjects.length} local {localProjects.length === 1 ? 'project' : 'projects'} that {localProjects.length === 1 ? 'hasn\'t' : 'haven\'t'} been saved to the cloud yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <p className="text-sm text-muted-foreground">
            Would you like to save {localProjects.length === 1 ? 'it' : 'them'} to your account?
          </p>
          <ul className="space-y-1 text-sm">
            {localProjects.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <span className="text-muted-foreground">•</span>
                <span className="font-medium">{project.name}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            disabled={isMigrating}
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleMigrate}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            disabled={isMigrating}
          >
            {isMigrating ? 'Saving...' : 'Save to Cloud'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
