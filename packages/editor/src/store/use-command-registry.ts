import type { ReactNode } from 'react'
import { create } from 'zustand'

export type CommandAction = {
  id: string
  /** Static string or a function evaluated at render time (for reactive labels). */
  label: string | (() => string)
  group: string
  icon?: ReactNode
  keywords?: string[]
  shortcut?: string[]
  /** Static string or a function evaluated at render time (for reactive badges). */
  badge?: string | (() => string)
  /** Show a chevron to indicate this action navigates to a sub-page. */
  navigate?: boolean
  /** Called at render time — returning false disables the item. */
  when?: () => boolean
  execute: () => void
}

interface CommandRegistryStore {
  actions: CommandAction[]
  /** Register actions and return an unsubscribe function. */
  register: (actions: CommandAction[]) => () => void
}

export const useCommandRegistry = create<CommandRegistryStore>((set) => ({
  actions: [],
  register: (newActions) => {
    const ids = newActions.map((a) => a.id)
    set((s) => ({
      actions: [...s.actions.filter((a) => !ids.includes(a.id)), ...newActions],
    }))
    return () => set((s) => ({ actions: s.actions.filter((a) => !ids.includes(a.id)) }))
  },
}))
