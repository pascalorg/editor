'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const AUDIO_SETTINGS_STORAGE_KEY = 'pascal-audio-settings'
/**
 * Mute is each tab's own, so someone working in two projects can silence one and hear the other.
 * Under this key `sessionStorage` holds this tab's mute (kept across its reloads) and
 * `localStorage` the last choice made in any tab, which a new tab starts from.
 */
export const AUDIO_MUTED_STORAGE_KEY = 'pascal-audio-muted'

interface AudioState {
  masterVolume: number
  sfxVolume: number
  radioVolume: number
  isRadioPlaying: boolean
  /** This tab's mute; the volumes are every tab's. */
  muted: boolean
  autoplay: boolean
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setRadioVolume: (v: number) => void
  setRadioPlaying: (v: boolean) => void
  toggleRadioPlaying: () => void
  setMuted: (muted: boolean) => void
  toggleMute: () => void
  setAutoplay: (v: boolean) => void
}

type StoredSettings = Pick<
  AudioState,
  'masterVolume' | 'sfxVolume' | 'radioVolume' | 'isRadioPlaying' | 'autoplay'
>

type BrowserStorage = 'localStorage' | 'sessionStorage'

// Storage can be missing (a test, a server render) or refuse access (site data blocked): the page
// then keeps its choices in memory only.
function readStored(storage: BrowserStorage, key: string) {
  try {
    return globalThis[storage]?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStored(storage: BrowserStorage, key: string, value: string) {
  try {
    globalThis[storage]?.setItem(key, value)
  } catch {}
}

/** This tab's mute. A tab without one takes the last choice made in any tab, and keeps it. */
function tabMuted(): boolean {
  const own = readStored('sessionStorage', AUDIO_MUTED_STORAGE_KEY)
  if (own !== null) return own === 'true'
  const muted = readStored('localStorage', AUDIO_MUTED_STORAGE_KEY) === 'true'
  writeStored('sessionStorage', AUDIO_MUTED_STORAGE_KEY, String(muted))
  return muted
}

/** A mute chosen in this tab: this tab's, and where the next new tab starts. Open tabs keep theirs. */
function chooseMuted(muted: boolean) {
  writeStored('sessionStorage', AUDIO_MUTED_STORAGE_KEY, String(muted))
  writeStored('localStorage', AUDIO_MUTED_STORAGE_KEY, String(muted))
  return { muted }
}

// The settings as this tab last read or wrote them. A save carries every setting, so a save that
// changes none (a mute, which is this tab's own) is skipped: this tab's copy may be older than a
// volume another tab has set since.
let heldSettings: string | null = null

const settingsStorage = createJSONStorage<StoredSettings>(() => ({
  getItem: (key) => {
    heldSettings = readStored('localStorage', key)
    return heldSettings
  },
  setItem: (key, value) => {
    if (value === heldSettings) return
    heldSettings = value
    writeStored('localStorage', key, value)
  },
  removeItem: (key) => {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {}
  },
}))

const useAudio = create<AudioState>()(
  persist(
    (set) => ({
      masterVolume: 70,
      sfxVolume: 50,
      radioVolume: 25,
      isRadioPlaying: false,
      muted: false,
      autoplay: true,
      setMasterVolume: (v) => set({ masterVolume: v }),
      setSfxVolume: (v) => set({ sfxVolume: v }),
      setRadioVolume: (v) => set({ radioVolume: v }),
      setRadioPlaying: (v) => set({ isRadioPlaying: v }),
      toggleRadioPlaying: () => set((state) => ({ isRadioPlaying: !state.isRadioPlaying })),
      setMuted: (muted) => set(chooseMuted(muted)),
      toggleMute: () => set((state) => chooseMuted(!state.muted)),
      setAutoplay: (v) => set({ autoplay: v }),
    }),
    {
      name: AUDIO_SETTINGS_STORAGE_KEY,
      storage: settingsStorage,
      version: 1,
      partialize: ({ masterVolume, sfxVolume, radioVolume, isRadioPlaying, autoplay }) => ({
        masterVolume,
        sfxVolume,
        radioVolume,
        isRadioPlaying,
        autoplay,
      }),
      // Version 0 kept one mute for every tab in these settings: whoever had muted stays muted.
      // A choice made since wins over it (a tab still on version 0 can write it again).
      migrate: (persisted, version) => {
        const { muted, ...settings } = (persisted ?? {}) as StoredSettings & { muted?: unknown }
        if (
          version === 0 &&
          typeof muted === 'boolean' &&
          readStored('localStorage', AUDIO_MUTED_STORAGE_KEY) === null
        ) {
          writeStored('localStorage', AUDIO_MUTED_STORAGE_KEY, String(muted))
        }
        return settings
      },
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<StoredSettings> | undefined),
        muted: tabMuted(),
      }),
    },
  ),
)

export default useAudio
