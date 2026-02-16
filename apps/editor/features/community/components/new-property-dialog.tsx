'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { createProperty } from '../lib/properties/actions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Switch } from '@/components/ui/primitives/switch'
import { GoogleAddressSearch } from './google-address-search'

interface NewPropertyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (propertyId: string) => void
  localPropertyData?: {
    id: string
    name: string
    sceneGraph: any
  }
}

interface AddressData {
  streetNumber?: string
  route?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  center: [number, number]
  formattedAddress: string
}

/**
 * NewPropertyDialog - Dialog for creating a new property with Google Maps address search
 */
export function NewPropertyDialog({ open, onOpenChange, onSuccess, localPropertyData }: NewPropertyDialogProps) {
  const [address, setAddress] = useState<AddressData | null>(null)
  const [isPrivate, setIsPrivate] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAddressSelect = (addressData: AddressData) => {
    setAddress(addressData)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!address) {
      setError('Please select an address')
      return
    }

    setIsCreating(true)

    try {
      // Use formatted address as property name (like monorepo)
      const result = await createProperty({
        name: address.formattedAddress,
        center: address.center,
        streetNumber: address.streetNumber,
        route: address.route,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || 'US',
        isPrivate,
        sceneGraph: localPropertyData?.sceneGraph,
      })

      if (result.success && result.data) {
        onOpenChange(false)
        setAddress(null)
        setIsPrivate(false)
        onSuccess?.(result.data.id)
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
      setAddress(null)
      setIsPrivate(false)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose} modal={false}>
      <DialogContent
        className="sm:max-w-[500px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
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
          {/* Google Maps Address Search */}
          <GoogleAddressSearch onAddressSelect={handleAddressSelect} disabled={isCreating} />

          {/* Show selected address */}
          {address && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Selected Address:</p>
              <p className="mt-1 text-muted-foreground">{address.formattedAddress}</p>
            </div>
          )}

          {/* Privacy Toggle */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="font-medium text-sm">Privacy</div>
              <div className="text-xs text-muted-foreground">
                {isPrivate ? 'Only you can view this property' : 'Anyone can view this property'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Public</span>
              <Switch checked={!isPrivate} onCheckedChange={(checked) => setIsPrivate(!checked)} />
            </div>
          </div>

          {localPropertyData && (
            <div className="rounded-md border border-blue-500/50 bg-blue-500/10 p-3 text-sm">
              <p className="font-medium text-blue-700 dark:text-blue-300">
                Saving local property: {localPropertyData.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your building data will be preserved
              </p>
            </div>
          )}

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
              disabled={isCreating || !address}
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
