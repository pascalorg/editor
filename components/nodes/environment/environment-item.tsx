import { Clock, MapPin, Moon, Settings2, Sun, Sunrise, Sunset } from 'lucide-react'
import { useEffect, useState } from 'react'
import SunCalc from 'suncalc'
import { useShallow } from 'zustand/shallow'
import AddressAutocomplete from '@/components/address-auto-complete'
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  useTree,
} from '@/components/tree'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'

interface EnvironmentItemProps {
  level?: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function EnvironmentItem({ level = 1, onNodeClick }: EnvironmentItemProps) {
  const environment = useEditor(useShallow((state) => state.scene.root.environment))
  const { indent } = useTree()

  // Derived values from environment for rendering
  const envTimePreset = environment?.timePreset
  const envTimeMode = environment?.timeMode
  const envLatitude = environment?.latitude ?? 0
  const envLongitude = environment?.longitude ?? 0

  const [latitude, setLatitude] = useState(environment?.latitude ?? 0)
  const [longitude, setLongitude] = useState(environment?.longitude ?? 0)
  const [altitude, setAltitude] = useState(environment?.altitude ?? 0)
  const [address, setAddress] = useState(environment?.address ?? '')
  const [timeValue, setTimeValue] = useState(0)

  // Update local state when environment changes
  useEffect(() => {
    setLatitude(environment?.latitude ?? 0)
    setLongitude(environment?.longitude ?? 0)
    setAltitude(environment?.altitude ?? 0)
    setAddress(environment?.address ?? '')

    // Update time slider
    let date = new Date()
    if (environment?.timeMode === 'custom' && environment.staticTime) {
      date = new Date(environment.staticTime)
    }
    const hours = date.getHours() + date.getMinutes() / 60
    setTimeValue(hours)
  }, [environment])

  // Update in real-time when values change
  const updateEnvironment = (updates: Record<string, unknown>) => {
    useEditor.setState((state) => ({
      scene: {
        ...state.scene,
        root: {
          ...state.scene.root,
          environment: {
            ...state.scene.root.environment,
            ...updates,
          },
        },
      },
    }))
  }

  const handleTimeChange = (value: number[]) => {
    const hours = value[0]
    setTimeValue(hours)

    // Convert hours (0-24) to timestamp for today
    const date = new Date()
    date.setHours(Math.floor(hours))
    date.setMinutes(Math.floor((hours % 1) * 60))
    date.setSeconds(0)

    // Check if time matches any preset range based on altitude
    const position = SunCalc.getPosition(date, latitude, longitude)
    const { altitude } = position
    const sunTimes = SunCalc.getTimes(date, latitude, longitude)

    let preset: 'dawn' | 'day' | 'dusk' | 'night' | 'custom' = 'custom'

    if (altitude < -0.05) {
      preset = 'night'
    } else if (altitude > 0.1) {
      preset = 'day'
    } else if (date.getTime() < sunTimes.solarNoon.getTime()) {
      // Transition period - check if before or after solar noon to distinguish dawn/dusk
      preset = 'dawn'
    } else {
      preset = 'dusk'
    }

    updateEnvironment({
      timeMode: 'custom',
      timePreset: preset,
      staticTime: date.getTime(),
    })
  }

  const handleAddressSelect = (
    selectedAddress: string | null,
    place: google.maps.places.PlaceResult | null,
  ) => {
    if (selectedAddress && place?.geometry?.location) {
      const lat = place.geometry.location.lat()
      const lng = place.geometry.location.lng()

      setLatitude(lat)
      setLongitude(lng)
      setAddress(selectedAddress)

      // Get elevation data from Google Maps Elevation Service
      try {
        const elevator = new window.google.maps.ElevationService()
        elevator.getElevationForLocations(
          {
            locations: [{ lat, lng }],
          },
          (results, status) => {
            if (status === window.google.maps.ElevationStatus.OK && results && results[0]) {
              const elevation = results[0].elevation
              setAltitude(elevation)

              updateEnvironment({
                latitude: lat,
                longitude: lng,
                altitude: elevation,
                address: selectedAddress,
              })
            } else {
              // Fallback without elevation
              updateEnvironment({
                latitude: lat,
                longitude: lng,
                address: selectedAddress,
              })
            }
          },
        )
      } catch (error) {
        // Silently fail elevation lookup and just update coordinates
        console.error('Failed to get elevation data:', error)
        updateEnvironment({
          latitude: lat,
          longitude: lng,
          address: selectedAddress,
        })
      }
    }
  }

  return (
    <TreeNode level={level} nodeId="environment">
      <TreeNodeTrigger
        onClick={(e) => {
          e.stopPropagation()
          onNodeClick('environment', true)
        }}
      >
        <TreeExpander hasChildren={true} />
        <TreeIcon
          hasChildren={true}
          icon={
            <img
              alt="environment"
              className="h-4 w-4 object-contain"
              height={16}
              src="/icons/environment.png"
              width={16}
            />
          }
        />
        <TreeLabel>Environment</TreeLabel>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className="h-5 w-5 p-0"
              onClick={(e) => e.stopPropagation()}
              size="sm"
              variant="ghost"
            >
              <Settings2 className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" onClick={(e) => e.stopPropagation()}>
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Environment Settings</h4>
                <p className="text-muted-foreground text-sm">
                  Set location via address or coordinates
                </p>
              </div>

              <div className="space-y-2">
                <label className="font-medium text-sm">Address</label>
                <AddressAutocomplete
                  className="h-8 text-sm"
                  onAddressSelect={handleAddressSelect}
                  placeholder={address || 'Search address...'}
                />
              </div>

              <div className="space-y-2">
                <label className="font-medium text-sm">Time of Day</label>
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          const times = SunCalc.getTimes(new Date(), latitude, longitude)
                          updateEnvironment({
                            timeMode: 'custom',
                            timePreset: 'dawn',
                            staticTime: times.dawn.getTime(),
                          })
                        }}
                        size="icon"
                        variant={envTimePreset === 'dawn' ? 'default' : 'outline'}
                      >
                        <Sunrise className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Dawn</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          const times = SunCalc.getTimes(new Date(), latitude, longitude)
                          updateEnvironment({
                            timeMode: 'custom',
                            timePreset: 'day',
                            staticTime: times.solarNoon.getTime(),
                          })
                        }}
                        size="icon"
                        variant={envTimePreset === 'day' ? 'default' : 'outline'}
                      >
                        <Sun className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Noon</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          const times = SunCalc.getTimes(new Date(), latitude, longitude)
                          updateEnvironment({
                            timeMode: 'custom',
                            timePreset: 'dusk',
                            staticTime: times.dusk.getTime(),
                          })
                        }}
                        size="icon"
                        variant={envTimePreset === 'dusk' ? 'default' : 'outline'}
                      >
                        <Sunset className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Dusk</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          const times = SunCalc.getTimes(new Date(), latitude, longitude)
                          updateEnvironment({
                            timeMode: 'custom',
                            timePreset: 'night',
                            staticTime: times.nadir.getTime(),
                          })
                        }}
                        size="icon"
                        variant={envTimePreset === 'night' ? 'default' : 'outline'}
                      >
                        <Moon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Night</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => updateEnvironment({ timeMode: 'now', timePreset: 'now' })}
                        size="icon"
                        variant={envTimeMode === 'now' || !envTimeMode ? 'default' : 'outline'}
                      >
                        <Clock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Current Time</TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex items-center gap-4">
                  <Slider
                    max={24}
                    min={0}
                    onValueChange={handleTimeChange}
                    step={0.1}
                    value={[timeValue]}
                  />
                  <div className="w-12 text-right font-mono text-xs">
                    {Math.floor(timeValue).toString().padStart(2, '0')}:
                    {Math.floor((timeValue % 1) * 60)
                      .toString()
                      .padStart(2, '0')}
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-sm" htmlFor="latitude">
                      Latitude
                    </label>
                    <span className="text-muted-foreground text-xs">{latitude.toFixed(4)}°</span>
                  </div>
                  <Slider
                    id="latitude"
                    max={90}
                    min={-90}
                    onValueChange={(value) => {
                      setLatitude(value[0])
                      updateEnvironment({ latitude: value[0] })
                    }}
                    step={0.0001}
                    value={[latitude]}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-sm" htmlFor="longitude">
                      Longitude
                    </label>
                    <span className="text-muted-foreground text-xs">{longitude.toFixed(4)}°</span>
                  </div>
                  <Slider
                    id="longitude"
                    max={180}
                    min={-180}
                    onValueChange={(value) => {
                      setLongitude(value[0])
                      updateEnvironment({ longitude: value[0] })
                    }}
                    step={0.0001}
                    value={[longitude]}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-sm" htmlFor="altitude">
                      Altitude
                    </label>
                    <span className="text-muted-foreground text-xs">{altitude.toFixed(1)}m</span>
                  </div>
                  <Slider
                    id="altitude"
                    max={1000}
                    min={-100}
                    onValueChange={(value) => {
                      setAltitude(value[0])
                      updateEnvironment({ altitude: value[0] })
                    }}
                    step={1}
                    value={[altitude]}
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={true}>
        <div
          className="flex items-center gap-2 py-2 text-muted-foreground text-xs"
          style={{ paddingLeft: (level + 1) * (indent ?? 20) + 8 }}
        >
          <MapPin className="h-3 w-3" />
          <span className="truncate">
            {address || `${envLatitude.toFixed(4)}, ${envLongitude.toFixed(4)}`}
          </span>
        </div>
      </TreeNodeContent>
    </TreeNode>
  )
}
