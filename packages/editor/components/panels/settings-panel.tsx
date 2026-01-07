'use client'

import { Clock, Download, FileCode, HelpCircle, Moon, Save, Sun, Sunrise, Sunset, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import SunCalc from 'suncalc'
import { useShallow } from 'zustand/shallow'
import AddressAutocomplete from '@/components/address-auto-complete'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'

interface SettingsPanelProps {
  onOpenJsonInspector: () => void
  onOpenHelp: () => void
}

export function SettingsPanel({ onOpenJsonInspector, onOpenHelp }: SettingsPanelProps) {
  const handleExport = useEditor((state) => state.handleExport)
  const handleResetToDefault = useEditor((state) => state.handleResetToDefault)
  const serializeLayout = useEditor((state) => state.serializeLayout)
  const loadLayout = useEditor((state) => state.loadLayout)
  const environment = useEditor(useShallow((state) => state.scene.root.environment))

  const [excludeImages, setExcludeImages] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Environment state
  const [latitude, setLatitude] = useState(environment?.latitude ?? 0)
  const [longitude, setLongitude] = useState(environment?.longitude ?? 0)
  const [address, setAddress] = useState(environment?.address ?? '')
  const [timeValue, setTimeValue] = useState(0)

  const envTimePreset = environment?.timePreset
  const envTimeMode = environment?.timeMode

  useEffect(() => {
    setLatitude(environment?.latitude ?? 0)
    setLongitude(environment?.longitude ?? 0)
    setAddress(environment?.address ?? '')

    let date = new Date()
    if (environment?.timeMode === 'custom' && environment.staticTime) {
      date = new Date(environment.staticTime)
    }
    const hours = date.getHours() + date.getMinutes() / 60
    setTimeValue(hours)
  }, [environment])

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

    const date = new Date()
    date.setHours(Math.floor(hours))
    date.setMinutes(Math.floor((hours % 1) * 60))
    date.setSeconds(0)

    const position = SunCalc.getPosition(date, latitude, longitude)
    const sunTimes = SunCalc.getTimes(date, latitude, longitude)

    let preset: 'dawn' | 'day' | 'dusk' | 'night' | 'custom' = 'custom'

    if (position.altitude < -0.05) {
      preset = 'night'
    } else if (position.altitude > 0.1) {
      preset = 'day'
    } else if (date.getTime() < sunTimes.solarNoon.getTime()) {
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

      updateEnvironment({
        latitude: lat,
        longitude: lng,
        address: selectedAddress,
      })
    }
  }

  const handleSaveLayout = () => {
    let layout = serializeLayout()

    if (excludeImages) {
      layout = JSON.parse(JSON.stringify(layout))

      const filterNodes = (node: any) => {
        if (node.children && Array.isArray(node.children)) {
          node.children = node.children.filter((child: any) => child.type !== 'reference-image')
          node.children.forEach(filterNodes)
        }
      }

      if (layout.root) {
        filterNodes(layout.root)
      }
    }

    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `layout_${new Date().toISOString().split('T')[0]}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/json') {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string)
          loadLayout(json)
        } catch (error) {
          console.error('Failed to parse layout JSON:', error)
        }
      }
      reader.readAsText(file)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Environment Section */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">Environment</label>

          <div className="space-y-2">
            <label className="text-sm">Location</label>
            <AddressAutocomplete
              className="h-8 text-sm"
              onAddressSelect={handleAddressSelect}
              placeholder={address || 'Search address...'}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm">Time of Day</label>
            <div className="flex justify-between gap-1">
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
                    <Sunrise className="size-4" />
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
                    <Sun className="size-4" />
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
                    <Sunset className="size-4" />
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
                    <Moon className="size-4" />
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
                    <Clock className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Current Time</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-2">
              <Slider
                className="flex-1"
                max={24}
                min={0}
                onValueChange={handleTimeChange}
                step={0.1}
                value={[timeValue]}
              />
              <div className="w-10 text-right font-mono text-xs">
                {Math.floor(timeValue).toString().padStart(2, '0')}:
                {Math.floor((timeValue % 1) * 60)
                  .toString()
                  .padStart(2, '0')}
              </div>
            </div>
          </div>
        </div>

        {/* Export Section */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">Export</label>
          <Button className="w-full justify-start gap-2" onClick={handleExport} variant="outline">
            <Download className="size-4" />
            Export 3D Model
          </Button>
        </div>

        {/* Save/Load Section */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">
            Save & Load
          </label>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="text-sm">Exclude Images</span>
            <Switch
              checked={excludeImages}
              className="scale-90"
              onCheckedChange={setExcludeImages}
            />
          </div>

          <Button
            className="w-full justify-start gap-2"
            onClick={handleSaveLayout}
            variant="outline"
          >
            <Save className="size-4" />
            Save Build
          </Button>

          <Button
            className="w-full justify-start gap-2"
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
          >
            <Upload className="size-4" />
            Load Build
          </Button>

          <input
            accept="application/json"
            className="hidden"
            onChange={handleFileLoad}
            ref={fileInputRef}
            type="file"
          />
        </div>

        {/* Tools Section */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">Tools</label>

          <Button
            className="w-full justify-start gap-2"
            onClick={onOpenJsonInspector}
            variant="outline"
          >
            <FileCode className="size-4" />
            Inspect Data
          </Button>

          <Button className="w-full justify-start gap-2" onClick={onOpenHelp} variant="outline">
            <HelpCircle className="size-4" />
            Help
          </Button>
        </div>

        {/* Danger Zone */}
        <div className="space-y-2">
          <label className="font-medium text-destructive text-xs uppercase">Danger Zone</label>

          <Button
            className="w-full justify-start gap-2"
            onClick={handleResetToDefault}
            variant="destructive"
          >
            <Trash2 className="size-4" />
            Clear & Start New
          </Button>
        </div>
      </div>
    </div>
  )
}
