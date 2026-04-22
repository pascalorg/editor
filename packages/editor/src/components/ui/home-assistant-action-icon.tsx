'use client'

import {
  Aperture,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  AudioLines,
  Blend,
  Blinds,
  CirclePause,
  CirclePlay,
  CirclePower,
  CircleStop,
  Disc3,
  Dock,
  DoorClosed,
  DoorOpen,
  Droplets,
  Fan,
  Gauge,
  Link2,
  Link2Off,
  LocateFixed,
  Lock,
  LockOpen,
  Monitor,
  MoveHorizontal,
  MoveVertical,
  PanelTop,
  PanelTopClose,
  PanelTopOpen,
  Pause,
  Play,
  Power,
  PowerOff,
  Repeat2,
  Rows3,
  Search,
  SkipBack,
  SkipForward,
  Square,
  SunMedium,
  SwatchBook,
  Thermometer,
  TvMinimalPlay,
  Volume1,
  Volume2,
  VolumeX,
  Wind,
  WindArrowDown,
} from 'lucide-react'
import type { ComponentProps } from 'react'
import type { HomeAssistantActionIcon } from '../../lib/home-assistant'

type HomeAssistantActionIconProps = {
  className?: string
  icon: HomeAssistantActionIcon | 'connectivity'
}

export function HomeAssistantActionIconView({
  className = 'h-4 w-4',
  icon,
}: HomeAssistantActionIconProps) {
  const iconProps = { className } satisfies ComponentProps<typeof Monitor>

  switch (icon) {
    case 'turn_on':
      return <Power {...iconProps} />
    case 'turn_off':
      return <PowerOff {...iconProps} />
    case 'toggle':
    case 'power_toggle':
      return <CirclePower {...iconProps} />
    case 'play':
    case 'start':
      return <CirclePlay {...iconProps} />
    case 'play_pause':
      return <Play {...iconProps} />
    case 'pause':
      return <CirclePause {...iconProps} />
    case 'stop':
      return <CircleStop {...iconProps} />
    case 'next':
      return <SkipForward {...iconProps} />
    case 'previous':
      return <SkipBack {...iconProps} />
    case 'volume_up':
      return <Volume2 {...iconProps} />
    case 'volume_down':
      return <Volume1 {...iconProps} />
    case 'volume_set':
      return <AudioLines {...iconProps} />
    case 'volume_mute':
      return <VolumeX {...iconProps} />
    case 'connect':
    case 'connectivity':
      return <TvMinimalPlay {...iconProps} />
    case 'lock':
      return <Lock {...iconProps} />
    case 'unlock':
      return <LockOpen {...iconProps} />
    case 'open':
      return <DoorOpen {...iconProps} />
    case 'close':
      return <DoorClosed {...iconProps} />
    case 'sound_mode':
      return <Disc3 {...iconProps} />
    case 'repeat':
      return <Repeat2 {...iconProps} />
    case 'shuffle':
      return <Blend {...iconProps} />
    case 'seek':
      return <Gauge {...iconProps} />
    case 'group':
      return <Link2 {...iconProps} />
    case 'ungroup':
      return <Link2Off {...iconProps} />
    case 'playlist_clear':
      return <Rows3 {...iconProps} />
    case 'position':
      return <PanelTop {...iconProps} />
    case 'position_stop':
      return <Square {...iconProps} />
    case 'tilt_open':
      return <PanelTopOpen {...iconProps} />
    case 'tilt_close':
      return <PanelTopClose {...iconProps} />
    case 'tilt_position':
      return <MoveHorizontal {...iconProps} />
    case 'tilt_stop':
      return <Blinds {...iconProps} />
    case 'speed_up':
      return <ArrowUpWideNarrow {...iconProps} />
    case 'speed_down':
      return <ArrowDownWideNarrow {...iconProps} />
    case 'speed':
      return <Fan {...iconProps} />
    case 'direction':
      return <WindArrowDown {...iconProps} />
    case 'preset_mode':
      return <Rows3 {...iconProps} />
    case 'fan_mode':
      return <Fan {...iconProps} />
    case 'climate_mode':
      return <Aperture {...iconProps} />
    case 'temperature':
      return <Thermometer {...iconProps} />
    case 'humidity':
      return <Droplets {...iconProps} />
    case 'swing':
      return <MoveVertical {...iconProps} />
    case 'swing_horizontal':
      return <MoveHorizontal {...iconProps} />
    case 'clean_spot':
      return <Aperture {...iconProps} />
    case 'clean_area':
      return <Rows3 {...iconProps} />
    case 'return_to_base':
      return <Dock {...iconProps} />
    case 'locate':
      return <LocateFixed {...iconProps} />
    case 'brightness':
      return <SunMedium {...iconProps} />
    case 'color':
      return <SwatchBook {...iconProps} />
    case 'color_temperature':
      return <Thermometer {...iconProps} />
    case 'search':
      return <Search {...iconProps} />
    case 'custom':
      return <Monitor {...iconProps} />
    default:
      return <Monitor {...iconProps} />
  }
}
