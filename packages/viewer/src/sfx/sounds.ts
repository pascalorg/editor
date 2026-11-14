import type { SoundDefinition } from './player'

/** Built-in interaction and viewer UI cues, keyed by their public names. */
export const SOUNDS = {
  menuHover: {
    src: 'menu_hover.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.2, 0.3],
    minIntervalMs: 0,
  },
  menuClick: {
    src: 'menu_click.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
  },
  doorOpen: { src: 'door_open.mp3', rateRange: [0.96, 1.04], volumeRange: [0.9, 1] },
  doorClose: { src: 'door_close.mp3', rateRange: [0.96, 1.04], volumeRange: [0.9, 1] },
  doorSwing: { src: 'door_swing.mp3', rateRange: [0.97, 1.03] },
  garageDoor: { src: 'garage_door.mp3', volumeRange: [0.9, 1] },
  shuttersOpen: { src: 'shutters_open.mp3', rateRange: [0.96, 1.04] },
  shuttersClose: { src: 'shutters_close.mp3', rateRange: [0.96, 1.04] },
  switchOn: { src: 'switch_on.mp3' },
  switchOff: { src: 'switch_off.mp3' },
  viewerHover: { src: 'viewer_hover.mp3', minIntervalMs: 95 },
  viewerSelect: { src: 'viewer_select.mp3', minIntervalMs: 90 },
  viewerDeselect: { src: 'viewer_deselect.mp3' },
} satisfies Record<string, SoundDefinition>

/** A built-in interaction or viewer UI cue name. */
export type SoundName = keyof typeof SOUNDS
