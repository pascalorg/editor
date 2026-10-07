import { create } from 'zustand'

/** Progress of a "Send to Blender" hand-off. Lives outside the settings panel so
 * switching tabs mid-send neither drops the lock nor loses the outcome. */
export type SendToAppStep = 'probing' | 'exporting' | 'sending' | 'importing'

export type SendToAppMessage = { tone: 'info' | 'error'; text: string }

type SendToAppState = {
  step: SendToAppStep | null
  message: SendToAppMessage | null
  setStep: (step: SendToAppStep | null) => void
  setMessage: (message: SendToAppMessage | null) => void
}

export const useSendToApp = create<SendToAppState>((set) => ({
  step: null,
  message: null,
  setStep: (step) => set({ step }),
  setMessage: (message) => set({ message }),
}))
