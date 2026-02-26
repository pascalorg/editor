'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AudioState {
  masterVolume: number
  sfxVolume: number
  radioVolume: number
  isRadioPlaying: boolean
  muted: boolean
  autoplay: boolean
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setRadioVolume: (v: number) => void
  setRadioPlaying: (v: boolean) => void
  toggleRadioPlaying: () => void
  toggleMute: () => void
  setAutoplay: (v: boolean) => void
}

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
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setAutoplay: (v) => set({ autoplay: v }),
    }),
    {
      name: 'pascal-audio-settings',
    }
  )
)

export default useAudio
