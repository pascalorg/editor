'use client'

import { Eye, Heart, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Property } from '../lib/properties/types'
import type { LocalProperty } from '../lib/local-storage/property-store'
import { PropertySettingsDialog } from './property-settings-dialog'
import { getUserPropertyLikes, togglePropertyLike } from '../lib/properties/actions'
import { useAuth } from '../lib/auth/hooks'

interface PropertyGridProps {
  properties: (Property | LocalProperty)[]
  onPropertyClick: (id: string) => void
  onViewClick?: (id: string) => void
  onSaveToCloud?: (property: LocalProperty) => void
  showOwner: boolean
  isLocal?: boolean
  canEdit?: boolean
  onUpdate?: () => void
}

function isLocalProperty(prop: Property | LocalProperty): prop is LocalProperty {
  return 'is_local' in prop && prop.is_local === true
}

export function PropertyGrid({
  properties,
  onPropertyClick,
  onViewClick,
  onSaveToCloud,
  showOwner,
  isLocal = false,
  canEdit = false,
  onUpdate,
}: PropertyGridProps) {
  const { isAuthenticated } = useAuth()
  const [settingsProperty, setSettingsProperty] = useState<Property | null>(null)
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({})
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({})

  // Initialize like counts from properties
  useEffect(() => {
    const counts: Record<string, number> = {}
    properties.forEach((prop) => {
      if (!isLocalProperty(prop)) {
        counts[prop.id] = prop.likes
      }
    })
    setLikeCounts(counts)
  }, [properties])

  // Fetch which properties the user has liked
  useEffect(() => {
    if (!isAuthenticated) {
      setUserLikes({})
      return
    }

    const propertyIds = properties
      .filter((p) => !isLocalProperty(p))
      .map((p) => p.id)

    if (propertyIds.length === 0) return

    getUserPropertyLikes(propertyIds).then((result) => {
      if (result.success && result.data) {
        setUserLikes(result.data)
      }
    })
  }, [properties, isAuthenticated])

  const handleSettingsClick = (e: React.MouseEvent, property: Property | LocalProperty) => {
    e.stopPropagation()
    if (!isLocalProperty(property)) {
      setSettingsProperty(property)
    }
  }

  const handleViewClick = (e: React.MouseEvent, propertyId: string) => {
    e.stopPropagation()
    onViewClick?.(propertyId)
  }

  const handleLikeClick = async (e: React.MouseEvent, propertyId: string) => {
    e.stopPropagation()

    if (!isAuthenticated) {
      // Could show a sign-in prompt here
      return
    }

    // Optimistic update
    const wasLiked = userLikes[propertyId] || false
    const currentCount = likeCounts[propertyId] || 0

    setUserLikes((prev) => ({ ...prev, [propertyId]: !wasLiked }))
    setLikeCounts((prev) => ({
      ...prev,
      [propertyId]: wasLiked ? currentCount - 1 : currentCount + 1
    }))

    // Call server action
    const result = await togglePropertyLike(propertyId)

    if (result.success && result.data) {
      // Update with actual values from server
      const data = result.data
      setUserLikes((prev) => ({ ...prev, [propertyId]: data.liked }))
      setLikeCounts((prev) => ({ ...prev, [propertyId]: data.likes }))
    } else {
      // Revert on error
      setUserLikes((prev) => ({ ...prev, [propertyId]: wasLiked }))
      setLikeCounts((prev) => ({ ...prev, [propertyId]: currentCount }))
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {properties.map((property) => (
          <div
            key={property.id}
            onClick={() => onPropertyClick(property.id)}
            className="group relative overflow-hidden rounded-lg border border-border bg-card hover:border-primary transition-all text-left cursor-pointer"
          >
            {/* Thumbnail */}
            <div className="aspect-video bg-muted relative">
              {!isLocalProperty(property) && property.thumbnail_url ? (
                <img
                  src={property.thumbnail_url}
                  alt={property.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  No preview
                </div>
              )}
              {isLocalProperty(property) && (
                <div className="absolute top-2 right-2">
                  {isAuthenticated && onSaveToCloud ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSaveToCloud(property)
                      }}
                      className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                      title="Save to cloud"
                    >
                      Save to cloud
                    </button>
                  ) : (
                    <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded">
                      Local
                    </div>
                  )}
                </div>
              )}
              {canEdit && !isLocalProperty(property) && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onViewClick && (
                    <button
                      onClick={(e) => handleViewClick(e, property.id)}
                      className="bg-background/80 hover:bg-background rounded-md p-1.5"
                      aria-label="View"
                      title="View in viewer mode"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => handleSettingsClick(e, property)}
                    className="bg-background/80 hover:bg-background rounded-md p-1.5"
                    aria-label="Settings"
                    title="Property settings"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-4">
              <h3 className="font-medium text-left line-clamp-2 mb-2">{property.name}</h3>

              {!isLocalProperty(property) && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    <span>{property.views}</span>
                  </div>
                  <button
                    onClick={(e) => handleLikeClick(e, property.id)}
                    className="flex items-center gap-1 hover:text-red-500 transition-colors"
                    disabled={!isAuthenticated}
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        userLikes[property.id]
                          ? 'fill-red-500 text-red-500'
                          : ''
                      }`}
                    />
                    <span>{likeCounts[property.id] ?? property.likes}</span>
                  </button>
                </div>
              )}

              {isLocalProperty(property) && (
                <div className="text-sm text-muted-foreground">
                  {new Date(property.updated_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Settings Dialog */}
      {settingsProperty && (
        <PropertySettingsDialog
          property={settingsProperty}
          open={!!settingsProperty}
          onOpenChange={(open) => !open && setSettingsProperty(null)}
          onUpdate={onUpdate}
          onDelete={() => {
            setSettingsProperty(null)
            onUpdate?.()
          }}
        />
      )}
    </>
  )
}
