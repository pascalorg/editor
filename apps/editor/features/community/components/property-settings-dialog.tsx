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
import { Switch } from '@/components/ui/primitives/switch'
import { updatePropertyAddress, updatePropertyPrivacy, deleteProperty } from '../lib/properties/actions'
import type { Property } from '../lib/properties/types'

interface PropertySettingsDialogProps {
  property: Property
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
  onDelete?: () => void
}

export function PropertySettingsDialog({
  property,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
}: PropertySettingsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPrivate, setIsPrivate] = useState(property.is_private)
  const [address, setAddress] = useState({
    street_number: property.address.street_number || '',
    route: property.address.route || '',
    city: property.address.city || '',
    state: property.address.state || '',
    postal_code: property.address.postal_code || '',
    country: property.address.country || 'US',
  })

  const handleSave = async () => {
    setLoading(true)
    try {
      // Update privacy if changed
      if (isPrivate !== property.is_private) {
        const privacyResult = await updatePropertyPrivacy(property.id, isPrivate)
        if (!privacyResult.success) {
          alert(`Failed to update privacy: ${privacyResult.error}`)
          setLoading(false)
          return
        }
      }

      // Update address if changed
      const addressChanged =
        address.street_number !== (property.address.street_number || '') ||
        address.route !== (property.address.route || '') ||
        address.city !== (property.address.city || '') ||
        address.state !== (property.address.state || '') ||
        address.postal_code !== (property.address.postal_code || '') ||
        address.country !== (property.address.country || 'US')

      if (addressChanged) {
        const addressResult = await updatePropertyAddress(property.id, address)
        if (!addressResult.success) {
          alert(`Failed to update address: ${addressResult.error}`)
          setLoading(false)
          return
        }
      }

      onUpdate?.()
      onOpenChange(false)
    } catch (error) {
      alert('Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this property? This action cannot be undone.')) {
      return
    }

    setIsDeleting(true)
    try {
      const result = await deleteProperty(property.id)
      if (result.success) {
        onDelete?.()
        onOpenChange(false)
      } else {
        alert(`Failed to delete property: ${result.error}`)
      }
    } catch (error) {
      alert('Failed to delete property')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Property Settings</DialogTitle>
          <DialogDescription>Update property address and privacy settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Privacy Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Privacy</div>
              <div className="text-sm text-muted-foreground">
                {isPrivate ? 'Only you can view this property' : 'Anyone can view this property'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Public</span>
              <Switch checked={!isPrivate} onCheckedChange={(checked) => setIsPrivate(!checked)} />
            </div>
          </div>

          {/* Address Fields */}
          <div className="space-y-4">
            <h3 className="font-medium">Address</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Street Number</label>
                <input
                  type="text"
                  value={address.street_number}
                  onChange={(e) => setAddress({ ...address, street_number: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="123"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Street</label>
                <input
                  type="text"
                  value={address.route}
                  onChange={(e) => setAddress({ ...address, route: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Main St"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">City</label>
                <input
                  type="text"
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="San Francisco"
                />
              </div>

              <div>
                <label className="text-sm font-medium">State</label>
                <input
                  type="text"
                  value={address.state}
                  onChange={(e) => setAddress({ ...address, state: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="CA"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Postal Code</label>
                <input
                  type="text"
                  value={address.postal_code}
                  onChange={(e) => setAddress({ ...address, postal_code: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="94102"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Country</label>
                <input
                  type="text"
                  value={address.country}
                  onChange={(e) => setAddress({ ...address, country: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="US"
                />
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-border pt-6">
            <h3 className="font-medium text-destructive mb-2">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Once you delete a property, there is no going back. Please be certain.
            </p>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive hover:bg-destructive/20"
              disabled={isDeleting || loading}
            >
              {isDeleting ? 'Deleting...' : 'Delete Property'}
            </button>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            disabled={loading || isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            disabled={loading || isDeleting}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
