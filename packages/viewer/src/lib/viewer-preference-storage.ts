import type { StateStorage } from 'zustand/middleware'

/** Browser privacy settings can deny even access to the localStorage property. */
export const viewerPreferenceStorage = {
  getItem(name) {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem(name, value) {
    try {
      window.localStorage.setItem(name, value)
    } catch {}
  },
  removeItem(name) {
    try {
      window.localStorage.removeItem(name)
    } catch {}
  },
} satisfies StateStorage
