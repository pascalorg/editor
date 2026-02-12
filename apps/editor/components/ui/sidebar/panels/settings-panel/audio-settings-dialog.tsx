import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/primitives/dialog'
import { Slider } from '@/components/ui/slider'
import useAudio from '@/store/use-audio'

export function AudioSettingsDialog() {
  const { masterVolume, sfxVolume, radioVolume, muted, setMasterVolume, setSfxVolume, setRadioVolume, toggleMute } = useAudio()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="w-full justify-start gap-2"
          variant="outline"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          Audio Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Audio Settings</DialogTitle>
          <DialogDescription>
            Adjust volume levels and mute settings
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Master Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Master Volume</label>
              <span className="text-sm text-muted-foreground">{masterVolume}%</span>
            </div>
            <Slider
              value={[masterVolume]}
              onValueChange={(value) => value[0] !== undefined && setMasterVolume(value[0])}
              max={100}
              step={1}
              disabled={muted}
            />
          </div>

          {/* Radio Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Radio Volume</label>
              <span className="text-sm text-muted-foreground">{radioVolume}%</span>
            </div>
            <Slider
              value={[radioVolume]}
              onValueChange={(value) => value[0] !== undefined && setRadioVolume(value[0])}
              max={100}
              step={1}
              disabled={muted}
            />
          </div>

          {/* SFX Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Sound Effects</label>
              <span className="text-sm text-muted-foreground">{sfxVolume}%</span>
            </div>
            <Slider
              value={[sfxVolume]}
              onValueChange={(value) => value[0] !== undefined && setSfxVolume(value[0])}
              max={100}
              step={1}
              disabled={muted}
            />
          </div>

          {/* Mute Toggle */}
          <div className="pt-4 border-t">
            <Button
              onClick={toggleMute}
              variant={muted ? 'default' : 'outline'}
              className="w-full justify-start gap-2"
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
