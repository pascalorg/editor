'use client'

import { create } from 'zustand'

export type FloorplanPreflightIssueKind =
  | 'unresolved-collision'
  | 'short-unreadable-segment'
  | 'plan-geometry-conflict'
  | 'dimension-completeness'
  | 'clearance-advisory'
  | 'module-advisory'
  | 'sheet-content'

export type FloorplanPreflightIssue = {
  id: string
  kind: FloorplanPreflightIssueKind
  severity: 'info' | 'warning'
  message: string
}

type FloorplanPreflightState = {
  issues: FloorplanPreflightIssue[]
  layoutIssues: FloorplanPreflightIssue[]
  auditIssues: FloorplanPreflightIssue[]
  clearanceChecksEnabled: boolean
  moduleChecksEnabled: boolean
  setIssues: (issues: readonly FloorplanPreflightIssue[]) => void
  setAuditIssues: (issues: readonly FloorplanPreflightIssue[]) => void
  setClearanceChecksEnabled: (enabled: boolean) => void
  setModuleChecksEnabled: (enabled: boolean) => void
  reset: () => void
}

export const useFloorplanPreflight = create<FloorplanPreflightState>((set) => ({
  issues: [],
  layoutIssues: [],
  auditIssues: [],
  clearanceChecksEnabled: false,
  moduleChecksEnabled: false,
  setIssues: (issues) =>
    set((state) => ({ layoutIssues: [...issues], issues: [...issues, ...state.auditIssues] })),
  setAuditIssues: (issues) =>
    set((state) => ({ auditIssues: [...issues], issues: [...state.layoutIssues, ...issues] })),
  setClearanceChecksEnabled: (clearanceChecksEnabled) => set({ clearanceChecksEnabled }),
  setModuleChecksEnabled: (moduleChecksEnabled) => set({ moduleChecksEnabled }),
  reset: () =>
    set((state) =>
      state.layoutIssues.length === 0
        ? state
        : { layoutIssues: [], issues: [...state.auditIssues] },
    ),
}))

export default useFloorplanPreflight
