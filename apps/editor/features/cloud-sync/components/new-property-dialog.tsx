'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { createProperty } from '../lib/properties/actions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { GoogleAddressSearch } from './google-address-search'

interface NewPropertyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (propertyId: string) => void
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
export function NewPropertyDialog({ open, onOpenChange, onSuccess }: NewPropertyDialogProps) {
  const [address, setAddress] = useState<AddressData | null>(null)
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
      })

      if (result.success && result.data) {
        onOpenChange(false)
        setAddress(null)
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
