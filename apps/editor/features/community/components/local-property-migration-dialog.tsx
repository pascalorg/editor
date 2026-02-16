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
import type { LocalProperty } from '../lib/local-storage/property-store'

interface LocalPropertyMigrationDialogProps {
  localProperties: LocalProperty[]
  open: boolean
  onMigrate: () => Promise<void>
  onSkip: () => void
}

export function LocalPropertyMigrationDialog({
  localProperties,
  open,
  onMigrate,
  onSkip,
}: LocalPropertyMigrationDialogProps) {
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
          <DialogTitle>Save Local Properties to Cloud</DialogTitle>
          <DialogDescription>
            You have {localProperties.length} local {localProperties.length === 1 ? 'property' : 'properties'} that {localProperties.length === 1 ? 'hasn\'t' : 'haven\'t'} been saved to the cloud yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <p className="text-sm text-muted-foreground">
            Would you like to save {localProperties.length === 1 ? 'it' : 'them'} to your account?
          </p>
          <ul className="space-y-1 text-sm">
            {localProperties.map((property) => (
              <li key={property.id} className="flex items-center gap-2">
                <span className="text-muted-foreground">•</span>
                <span className="font-medium">{property.name}</span>
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
