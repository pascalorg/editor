import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../../../components/ui/primitives/dialog'
import { Slider } from '../../../../../components/ui/slider'
import useAudio from '../../../../../store/use-audio'

export function AudioSettingsDialog() {
  const {
    masterVolume,
    sfxVolume,
    radioVolume,
    muted,
    setMasterVolume,
    setSfxVolume,
    setRadioVolume,
    toggleMute,
  } = useAudio()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          Audio Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Audio Settings</DialogTitle>
          <DialogDescription>Adjust volume levels and mute settings</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Master Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-sm">Master Volume</label>
              <span className="text-muted-foreground text-sm">{masterVolume}%</span>
            </div>
            <Slider
              disabled={muted}
              max={100}
              onValueChange={(value) => value[0] !== undefined && setMasterVolume(value[0])}
              step={1}
              value={[masterVolume]}
            />
          </div>

          {/* Radio Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-sm">Radio Volume</label>
              <span className="text-muted-foreground text-sm">{radioVolume}%</span>
            </div>
            <Slider
              disabled={muted}
              max={100}
              onValueChange={(value) => value[0] !== undefined && setRadioVolume(value[0])}
              step={1}
              value={[radioVolume]}
            />
          </div>

          {/* SFX Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-sm">Sound Effects</label>
              <span className="text-muted-foreground text-sm">{sfxVolume}%</span>
            </div>
            <Slider
              disabled={muted}
              max={100}
              onValueChange={(value) => value[0] !== undefined && setSfxVolume(value[0])}
              step={1}
              value={[sfxVolume]}
            />
          </div>

          {/* Mute Toggle */}
          <div className="border-t pt-4">
            <Button
              className="w-full justify-start gap-2"
              onClick={toggleMute}
              variant={muted ? 'default' : 'outline'}
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {muted ? 'Unmute All Sounds' : 'Mute All Sounds'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
