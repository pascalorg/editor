import { MapPin, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { useEditor } from '@/hooks/use-editor'

interface EnvironmentItemProps {
  level?: number
  onNodeClick: (nodeId: string, hasChildren: boolean) => void
}

export function EnvironmentItem({ level = 1, onNodeClick }: EnvironmentItemProps) {
  const environment = useEditor(useShallow((state) => state.scene.root.environment))
  const { indent } = useTree()

  const [latitude, setLatitude] = useState(environment?.latitude ?? 0)
  const [longitude, setLongitude] = useState(environment?.longitude ?? 0)
  const [altitude, setAltitude] = useState(environment?.altitude ?? 0)
  const [address, setAddress] = useState(environment?.address ?? '')

  // Update local state when environment changes
  useEffect(() => {
    setLatitude(environment?.latitude ?? 0)
    setLongitude(environment?.longitude ?? 0)
    setAltitude(environment?.altitude ?? 0)
    setAddress(environment?.address ?? '')
  }, [environment])

  // Update in real-time when values change
  const updateEnvironment = (updates: Partial<typeof environment>) => {
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

      updateEnvironment({
        latitude: lat,
        longitude: lng,
        address: selectedAddress,
      })
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
            {address ||
              `${environment?.latitude?.toFixed(4) ?? 0}, ${environment?.longitude?.toFixed(4) ?? 0}`}
          </span>
        </div>
      </TreeNodeContent>
    </TreeNode>
  )
}
