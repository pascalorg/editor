'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { createProperty } from '@/lib/properties/actions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './primitives/dialog'

interface NewPropertyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * NewPropertyDialog - Dialog for creating a new property
 *
 * TODO: Add Google Maps address search integration
 * TODO: Add address parsing and validation
 * TODO: Add duplicate checking before creation
 */
export function NewPropertyDialog({ open, onOpenChange, onSuccess }: NewPropertyDialogProps) {
  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsCreating(true)

    try {
      // TODO: Replace with actual address data from Google Maps
      const result = await createProperty({
        name,
        center: [0, 0], // TODO: Get from Google Maps
        city: '',
        state: '',
        postalCode: '',
        country: 'US',
      })

      if (result.success) {
        onOpenChange(false)
        setName('')
        onSuccess?.()
      } else {
        setError(result.error || 'Failed to create property')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false)
      setName('')
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Property</DialogTitle>
          <button
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none"
            disabled={isCreating}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* TODO: Add Google Maps address search component */}
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="property-name">
              Property Name
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isCreating}
              id="property-name"
              placeholder="Enter property name"
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* TODO: Add address fields with Google Maps autocomplete */}
          <div className="rounded-md border border-border bg-muted/30 p-4 text-muted-foreground text-sm">
            <p>TODO: Google Maps address search will be integrated here</p>
            <p className="mt-2 text-xs">
              For now, property creation is not fully functional. This is a placeholder for the UI.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              className="rounded-md border border-input px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={isCreating}
              type="button"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={isCreating || !name}
              type="submit"
            >
              {isCreating ? 'Creating...' : 'Create Property'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
