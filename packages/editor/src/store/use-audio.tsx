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

// The settings as this tab last read, wrote or took from another tab. A save carries every
// setting, so a save that changes none (a mute, which is this tab's own) is skipped.
let heldSettings: string | null = null
// Set while this tab takes another tab's volumes: that is no choice of its own to save back.
let adopting = false

const settingsStorage = createJSONStorage<StoredSettings>(() => ({
  getItem: (key) => {
    heldSettings = readStored('localStorage', key)
    return heldSettings
  },
  setItem: (key, value) => {
    if (value === heldSettings) return
    heldSettings = value
    if (!adopting) writeStored('localStorage', key, value)
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
      partialize: ({ masterVolume, sfxVolume, radioVolume, isRadioPlaying, autoplay }) => ({
        masterVolume,
        sfxVolume,
        radioVolume,
        isRadioPlaying,
        autoplay,
      }),
      // The settings once held one mute for every tab: whoever had muted stays muted, unless a tab
      // has chosen since (a tab still on that build can write it again). The format is unchanged,
      // so that build reads these settings back with only the mute gone.
      merge: (persisted, current) => {
        const { muted, ...settings } = (persisted ?? {}) as Partial<StoredSettings> & {
          muted?: unknown
        }
        if (
          typeof muted === 'boolean' &&
          readStored('localStorage', AUDIO_MUTED_STORAGE_KEY) === null
        ) {
          writeStored('localStorage', AUDIO_MUTED_STORAGE_KEY, String(muted))
        }
        return { ...current, ...settings, muted: tabMuted() }
      },
    },
  ),
)

/**
 * Another tab saved the settings: the volumes are every tab's, so this tab takes them at once, and
 * a later save of its own carries them. Its mute and whether its radio plays stay its own.
 */
function adoptOtherTabSettings(event: StorageEvent) {
  if (event.key !== AUDIO_SETTINGS_STORAGE_KEY || event.newValue === null) return
  let stored: Partial<Record<keyof StoredSettings, unknown>> | undefined
  try {
    stored = JSON.parse(event.newValue)?.state
  } catch {
    return
  }
  const shared: Partial<StoredSettings> = {}
  for (const key of ['masterVolume', 'sfxVolume', 'radioVolume'] as const) {
    const value = stored?.[key]
    if (typeof value === 'number') shared[key] = value
  }
  if (typeof stored?.autoplay === 'boolean') shared.autoplay = stored.autoplay
  adopting = true
  try {
    useAudio.setState(shared)
  } finally {
    adopting = false
  }
}

globalThis.addEventListener?.('storage', adoptOtherTabSettings)

export default useAudio
