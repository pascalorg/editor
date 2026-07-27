'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_FLOORPLAN_MODE,
  type FloorplanMode,
  normalizeFloorplanModesByProject,
} from '../lib/floorplan/floorplan-mode'

export type FloorplanModeNotice = {
  id: number
  kind: 'info' | 'switch-to-expert'
  message: string
}

type FloorplanModeState = {
  mode: FloorplanMode
  projectId: string | null
  modesByProject: Record<string, FloorplanMode>
  hasShownDefaultReassurance: boolean
  notice: FloorplanModeNotice | null
  dismissNotice: () => void
  setMode: (mode: FloorplanMode) => void
  setProjectId: (projectId: string | null) => void
  showExpertModeNotice: (toolLabel: string) => void
  showNotice: (message: string) => void
}

let nextNoticeId = 0

const useFloorplanMode = create<FloorplanModeState>()(
  persist(
    (set) => ({
      mode: DEFAULT_FLOORPLAN_MODE,
      projectId: null,
      modesByProject: {},
      hasShownDefaultReassurance: false,
      notice: null,
      dismissNotice: () => set({ notice: null }),
      setMode: (mode) =>
        set((state) => {
          const shouldReassure =
            state.mode === 'expert' && mode === 'default' && !state.hasShownDefaultReassurance
          return {
            mode,
            modesByProject: state.projectId
              ? { ...state.modesByProject, [state.projectId]: mode }
              : state.modesByProject,
            hasShownDefaultReassurance: state.hasShownDefaultReassurance || shouldReassure,
            notice: shouldReassure
              ? {
                  id: ++nextNoticeId,
                  kind: 'info',
                  message:
                    'Default mode hides Expert annotations. Your saved work was not deleted.',
                }
              : state.notice,
          }
        }),
      setProjectId: (projectId) =>
        set((state) => ({
          projectId,
          mode: projectId
            ? (state.modesByProject[projectId] ?? DEFAULT_FLOORPLAN_MODE)
            : DEFAULT_FLOORPLAN_MODE,
          notice: null,
        })),
      showExpertModeNotice: (toolLabel) =>
        set({
          notice: {
            id: ++nextNoticeId,
            kind: 'switch-to-expert',
            message: `${toolLabel} is available in Expert mode.`,
          },
        }),
      showNotice: (message) =>
        set({
          notice: {
            id: ++nextNoticeId,
            kind: 'info',
            message,
          },
        }),
    }),
    {
      name: 'pascal-floorplan-mode-by-project',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as
          | { hasShownDefaultReassurance?: unknown; modesByProject?: unknown }
          | undefined
        const modesByProject = normalizeFloorplanModesByProject(persisted?.modesByProject)
        return {
          ...currentState,
          modesByProject,
          hasShownDefaultReassurance: persisted?.hasShownDefaultReassurance === true,
          mode: currentState.projectId
            ? (modesByProject[currentState.projectId] ?? DEFAULT_FLOORPLAN_MODE)
            : DEFAULT_FLOORPLAN_MODE,
        }
      },
      partialize: (state) => ({
        hasShownDefaultReassurance: state.hasShownDefaultReassurance,
        modesByProject: state.modesByProject,
      }),
    },
  ),
)

export default useFloorplanMode
