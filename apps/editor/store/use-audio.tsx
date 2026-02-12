'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AudioState {
  masterVolume: number
  sfxVolume: number
  radioVolume: number
  muted: boolean
  autoplay: boolean
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setRadioVolume: (v: number) => void
  toggleMute: () => void
  setAutoplay: (v: boolean) => void
}

const useAudio = create<AudioState>()(
  persist(
    (set) => ({
      masterVolume: 70,
      sfxVolume: 50,
      radioVolume: 25,
      muted: false,
      autoplay: true,
      setMasterVolume: (v) => set({ masterVolume: v }),
      setSfxVolume: (v) => set({ sfxVolume: v }),
      setRadioVolume: (v) => set({ radioVolume: v }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setAutoplay: (v) => set({ autoplay: v }),
    }),
    {
      name: 'pascal-audio-settings',
    }
  )
)

export default useAudio
