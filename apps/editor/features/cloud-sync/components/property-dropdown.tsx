'use client'

import { Check, ChevronDown, Home, Plus } from 'lucide-react'
import { useState } from 'react'
import { useActiveProperty, useProperties } from '../lib/properties/hooks'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu'
import { NewPropertyDialog } from './new-property-dialog'

/**
 * PropertyDropdown - Shows active property and allows switching between properties
 */
export function PropertyDropdown() {
  const { properties, isLoading: propertiesLoading, refetch } = useProperties()
  const { activeProperty, setActiveProperty, isPending } = useActiveProperty()
  const [isNewPropertyDialogOpen, setIsNewPropertyDialogOpen] = useState(false)

  const handlePropertySelect = async (propertyId: string) => {
    await setActiveProperty(propertyId)
  }

  const handleAddNew = () => {
    setIsNewPropertyDialogOpen(true)
  }

  const handlePropertyCreated = () => {
    refetch()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 focus:outline-none"
            disabled={propertiesLoading || isPending}
            type="button"
          >
            <Home className="h-4 w-4" />
            <span className="max-w-[150px] truncate">
              {activeProperty
                ? activeProperty.name
                : properties.length > 0
                  ? 'Select Property'
                  : 'Add Property'}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[280px]">
          {/* Property list */}
          {properties.length > 0 ? (
            <div className="max-h-[300px] overflow-y-auto">
              {properties.map((property) => (
                <DropdownMenuItem
                  className={cn(
                    'cursor-pointer text-sm',
                    activeProperty?.id === property.id && 'cursor-default bg-accent',
                  )}
                  key={property.id}
                  onClick={() =>
                    activeProperty?.id === property.id ? null : handlePropertySelect(property.id)
                  }
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex-1 truncate font-medium">{property.name}</div>
                    {activeProperty?.id === property.id && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            <div className="px-2 py-3 text-center text-muted-foreground text-sm">
              No properties yet
            </div>
          )}

          {/* Add new property option */}
          <DropdownMenuItem className="cursor-pointer" onClick={handleAddNew}>
            <Plus className="mr-2 h-4 w-4" />
            <span>Add new property</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewPropertyDialog
        open={isNewPropertyDialogOpen}
        onOpenChange={setIsNewPropertyDialogOpen}
        onSuccess={handlePropertyCreated}
      />
    </>
  )
}
