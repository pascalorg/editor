'use client'

/**
 * Custom Address Autocomplete Component
 *
 * This component uses Google Places AutocompleteService API to fetch suggestions
 * and renders them in a custom-designed dropdown instead of using Google's default UI.
 *
 * Features:
 * - Custom dropdown design with icons and styling
 * - Recent searches saved to localStorage
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Debounced search for better performance
 * - Loading states and empty states
 * - Session token management for Google API billing optimization
 */

import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { MapPinSimpleIcon } from '@phosphor-icons/react'
import { Clock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AddressAutocompleteProps {
  onAddressSelect?: (
    address: string | null,
    placeDetails: google.maps.places.PlaceResult | null,
  ) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

interface Suggestion {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  mainTextMatchedSubstrings?: Array<{ offset: number; length: number }>
}

// Helper function to highlight text using Google's matched_substrings data
const highlightMatches = (
  text: string,
  matchedSubstrings?: Array<{ offset: number; length: number }>,
): React.ReactElement => {
  // If no matches, return plain text
  if (!matchedSubstrings || matchedSubstrings.length === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  // Sort matches by offset to ensure proper order
  const sortedMatches = [...matchedSubstrings].sort((a, b) => a.offset - b.offset)

  for (const match of sortedMatches) {
    // Add non-highlighted text before this match
    if (match.offset > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}-${match.offset}`}>
          {text.substring(lastIndex, match.offset)}
        </span>,
      )
    }

    // Add highlighted match
    parts.push(
      <span className="font-bold text-foreground" key={`match-${match.offset}-${match.length}`}>
        {text.substring(match.offset, match.offset + match.length)}
      </span>,
    )

    lastIndex = match.offset + match.length
  }

  // Add any remaining text after the last match
  if (lastIndex < text.length) {
    parts.push(<span key={`text-end-${lastIndex}`}>{text.substring(lastIndex)}</span>)
  }

  return <>{parts}</>
}

export default function AddressAutocomplete({
  onAddressSelect,
  placeholder = 'Enter your address',
  className = '',
  autoFocus = false,
}: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null)
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('recentAddresses')
    if (stored) {
      setRecentSearches(JSON.parse(stored).slice(0, 3))
    }
  }, [])

  // Handle autoFocus with useEffect to ensure it works on remount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      // Small timeout to ensure DOM is ready
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [autoFocus])

  useEffect(() => {
    const initServices = async () => {
      try {
        setOptions({
          key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
          v: 'weekly',
          libraries: ['places'],
        })

        await importLibrary('places')
        await importLibrary('maps')
        const google = window.google

        // Initialize services
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService()
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()

        // Create a dummy map element for PlacesService
        const mapDiv = document.createElement('div')
        const map = new google.maps.Map(mapDiv)
        placesServiceRef.current = new google.maps.places.PlacesService(map)
      } catch {
        // no-op
      }
    }

    initServices()
  }, [])

  const fetchSuggestions = useCallback((input: string) => {
    if (!(autocompleteServiceRef.current && input.trim())) {
      setSuggestions([])
      return
    }

    setIsLoading(true)

    const request: google.maps.places.AutocompletionRequest = {
      input,
      types: ['address'],
      sessionToken: sessionTokenRef.current || undefined,
    }

    autocompleteServiceRef.current.getPlacePredictions(request, (predictions, status) => {
      setIsLoading(false)

      if (status === window.google?.maps?.places.PlacesServiceStatus.OK && predictions) {
        const formattedSuggestions: Suggestion[] = predictions.map((prediction) => ({
          placeId: prediction.place_id,
          description: prediction.description,
          mainText: prediction.structured_formatting.main_text,
          secondaryText: prediction.structured_formatting.secondary_text,
          mainTextMatchedSubstrings: prediction.structured_formatting.main_text_matched_substrings,
        }))
        setSuggestions(formattedSuggestions)
        setShowSuggestions(true)
      } else {
        setSuggestions([])
      }
    })
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setInputValue(value)
      setSelectedIndex(-1)

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Set new timer for debounced search
      if (value.trim()) {
        debounceTimerRef.current = setTimeout(() => {
          fetchSuggestions(value)
        }, 300)
      } else {
        setSuggestions([])
        setShowSuggestions(false)
        // Notify parent that address has been cleared
        if (onAddressSelect && value === '') {
          onAddressSelect(null, null)
        }
      }
    },
    [fetchSuggestions, onAddressSelect],
  )

  const selectAddress = useCallback(
    (suggestion: Suggestion) => {
      if (!placesServiceRef.current) {
        return
      }

      const request = {
        placeId: suggestion.placeId,
        fields: ['formatted_address', 'geometry', 'address_components', 'place_id', 'types'],
        sessionToken: sessionTokenRef.current || undefined,
      }

      placesServiceRef.current.getDetails(request, (place, status) => {
        if (status === window.google?.maps?.places.PlacesServiceStatus.OK && place) {
          setInputValue(place.formatted_address || suggestion.description)
          setShowSuggestions(false)
          setSuggestions([])

          // Create new session token after selection
          sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken()

          // Save to recent searches
          const recent = [place.formatted_address || suggestion.description, ...recentSearches]
            .filter((item, index, self) => self.indexOf(item) === index)
            .slice(0, 3)
          setRecentSearches(recent)
          localStorage.setItem('recentAddresses', JSON.stringify(recent))

          if (onAddressSelect) {
            onAddressSelect(place.formatted_address || suggestion.description, place)
          }
        }
      })
    },
    [onAddressSelect, recentSearches],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions) {
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
          break
        case 'Enter':
          e.preventDefault()
          if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            selectAddress(suggestions[selectedIndex])
          }
          break
        case 'Escape':
          setShowSuggestions(false)
          break
        default:
          break
      }
    },
    [showSuggestions, suggestions, selectedIndex, selectAddress],
  )

  const handleFocus = useCallback(() => {
    if (inputValue.trim() && suggestions.length > 0) {
      setShowSuggestions(true)
    }
  }, [inputValue, suggestions])

  const handleBlur = useCallback(() => {
    // Delay to allow click on suggestion
    setTimeout(() => setShowSuggestions(false), 200)
  }, [])

  return (
    <div className={cn('relative')}>
      <div className="relative">
        <MapPinSimpleIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 z-10 size-4 transform text-muted-foreground" />
        <Input
          autoComplete="on"
          autoFocus={autoFocus}
          className={cn('h-12 pl-10 text-base', className)}
          onBlur={handleBlur}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          type="text"
          value={inputValue}
        />
        {isLoading && (
          <div className="-translate-y-1/2 absolute top-1/2 right-3 transform">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        )}
      </div>

      {/* Custom Dropdown */}
      {showSuggestions && (suggestions.length > 0 || recentSearches.length > 0) && (
        <div
          className={cn(
            'absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-2xl border bg-background',
            className
              .split(' ')
              .filter(
                (c) =>
                  c.includes('ml-') || c.includes('m-') || c.includes('mr-') || c.includes('w-'),
              )
              .join(' '),
          )}
        >
          {/* Recent Searches Section */}
          {!inputValue.trim() && recentSearches.length > 0 && (
            <div className="border-border border-b">
              <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Recent Searches
              </div>
              {recentSearches.map((address) => (
                <button
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/5"
                  key={`recent-${address}`}
                  onClick={() => {
                    setInputValue(address)
                    fetchSuggestions(address)
                  }}
                  type="button"
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground text-sm">{address}</span>
                </button>
              ))}
            </div>
          )}

          {/* Suggestions Section */}
          {suggestions.length > 0 && (
            <div>
              {suggestions.map((suggestion, index) => (
                <button
                  className={cn(
                    'group flex w-full items-center gap-3 px-4 py-3 text-left transition-all',
                    selectedIndex === index ? 'bg-muted' : 'hover:bg-muted',
                  )}
                  key={suggestion.placeId}
                  onClick={() => selectAddress(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'line-clamp-1 text-ellipsis font-base text-sm',
                        selectedIndex === index ? 'text-primary/90' : 'text-foreground',
                      )}
                    >
                      {highlightMatches(suggestion.mainText, suggestion.mainTextMatchedSubstrings)}
                    </div>
                    <div
                      className={cn(
                        'line-clamp-1 truncate text-ellipsis text-xs',
                        selectedIndex === index ? 'text-primary/90' : 'text-muted-foreground',
                      )}
                    >
                      {suggestion.secondaryText}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* No Results Message */}
          {inputValue.trim() && suggestions.length === 0 && !isLoading && (
            <div className="px-4 py-8 text-center">
              <MapPinSimpleIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">No addresses found</p>
              <p className="mt-1 text-muted-foreground/70 text-xs">Try a different search term</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
