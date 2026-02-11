'use client'

import { Autocomplete, LoadScript } from '@react-google-maps/api'
import { MapPin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const libraries: ('places')[] = ['places']

interface AddressComponents {
  streetNumber?: string
  route?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  center: [number, number]
  formattedAddress: string
}

interface GoogleAddressSearchProps {
  onAddressSelect: (address: AddressComponents) => void
  disabled?: boolean
}

export function GoogleAddressSearch({ onAddressSelect, disabled }: GoogleAddressSearchProps) {
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // Fix Google Maps autocomplete dropdown z-index and pointer events to work with dialog
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .pac-container {
        z-index: 9999 !important;
        pointer-events: auto !important;
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  if (!apiKey) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
        <p className="font-medium">Google Maps API Key Missing</p>
        <p className="mt-1 text-xs">
          Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your .env.local file
        </p>
      </div>
    )
  }

  const onLoad = (autocompleteInstance: google.maps.places.Autocomplete) => {
    setAutocomplete(autocompleteInstance)
  }

  const onPlaceChanged = () => {
    if (!autocomplete) return

    const place = autocomplete.getPlace()
    if (!place.geometry?.location || !place.address_components) return

    const components: AddressComponents = {
      center: [place.geometry.location.lng(), place.geometry.location.lat()],
      formattedAddress: place.formatted_address || '',
    }

    // Parse address components
    for (const component of place.address_components) {
      const types = component.types

      if (types.includes('street_number')) {
        components.streetNumber = component.long_name
      } else if (types.includes('route')) {
        components.route = component.long_name
      } else if (types.includes('locality')) {
        components.city = component.long_name
      } else if (types.includes('administrative_area_level_1')) {
        components.state = component.short_name
      } else if (types.includes('postal_code')) {
        components.postalCode = component.long_name
      } else if (types.includes('country')) {
        components.country = component.short_name
      }
    }

    onAddressSelect(components)
  }

  return (
    <LoadScript googleMapsApiKey={apiKey} libraries={libraries}>
      <div className="space-y-2">
        <label className="flex items-center gap-2 font-medium text-sm">
          <MapPin className="h-4 w-4" />
          Property Address
        </label>
        <Autocomplete onLoad={onLoad} onPlaceChanged={onPlaceChanged}>
          <input
            ref={inputRef}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            placeholder="Search for an address..."
            type="text"
          />
        </Autocomplete>
      </div>
    </LoadScript>
  )
}
