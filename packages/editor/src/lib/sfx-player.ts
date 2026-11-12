import {
  disposeSounds,
  playSound,
  preloadSounds,
  SOUNDS,
  type SoundDefinition,
  type SoundPlaybackOptions,
  startSoundLoop,
  stopSoundLoop,
  updateSoundVolumes,
} from '@pascal-app/viewer/sfx'

export const SFX = {
  ...SOUNDS,
  gridSnap: {
    src: ['grid_snap_0.mp3', 'grid_snap_1.mp3', 'grid_snap_2.mp3'],
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
    minIntervalMs: 50,
  },
  itemDelete: {
    src: 'item_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
  },
  itemPick: {
    src: 'item_pick.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.92, 1.0],
  },
  itemPlace: {
    src: 'item_place.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.9, 1.0],
  },
  itemRotate: {
    src: 'item_rotate.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
  },
  resize: {
    src: ['resize_0.mp3', 'resize_1.mp3', 'resize_2.mp3'],
    rateRange: [0.98, 1.02],
    volumeRange: [0.26, 0.34],
    minIntervalMs: 80,
  },
  structureBuildStart: {
    src: 'structure_build_start.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
  },
  structureBuildEnd: {
    src: 'structure_build_end.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
  },
  structureDelete: {
    src: 'structure_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
  },
  snapshotCapture: {
    // Shutter should sound consistent — no variation.
    src: 'snapshot_capture.mp3',
  },
  paintApply: {
    src: 'paint_apply.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.85, 1.0],
    minIntervalMs: 60,
  },
  success: {
    src: 'success.mp3',
    minIntervalMs: 3_000,
  },
  turnDone: { src: 'turn_done.mp3' },
  turnFailed: { src: 'turn_failed.mp3' },
  turnNeedsInput: { src: 'turn_needs_input.mp3' },
} satisfies Record<string, SoundDefinition>

export type SFXName = keyof typeof SFX

export const LOOP_SFX = {
  terrainRaise: {
    src: 'terrain_raise.mp3',
    loop: true,
    volumeMultiplier: 0.2,
  },
  terrainLower: {
    src: 'terrain_lower.mp3',
    loop: true,
    volumeMultiplier: 0.2,
  },
  terrainFlatten: {
    src: 'terrain_flatten.mp3',
    loop: true,
    volumeMultiplier: 0.2,
  },
  terrainSmooth: {
    src: 'terrain_smooth.mp3',
    loop: true,
    volumeMultiplier: 0.2,
  },
} as const satisfies Record<string, SoundDefinition>

export type LoopSFXName = keyof typeof LOOP_SFX

export type SFXPlaybackOptions = SoundPlaybackOptions

export function preloadSFX() {
  preloadSounds([...Object.values(SFX), ...Object.values(LOOP_SFX)])
}

export function playSFX(name: SFXName, options?: SFXPlaybackOptions) {
  preloadSFX()
  playSound(SFX[name], options)
}

export function startLoopSFX(name: LoopSFXName) {
  preloadSFX()
  startSoundLoop(LOOP_SFX[name])
}

export const stopLoopSFX = stopSoundLoop
export const updateSFXVolumes = updateSoundVolumes
export const disposeSFX = disposeSounds
