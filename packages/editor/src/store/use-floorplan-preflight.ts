'use client'

import { create } from 'zustand'

export type FloorplanPreflightIssueKind =
  | 'unresolved-collision'
  | 'short-unreadable-segment'
  | 'plan-geometry-conflict'

export type FloorplanPreflightIssue = {
  id: string
  kind: FloorplanPreflightIssueKind
  severity: 'warning'
  message: string
}

type FloorplanPreflightState = {
  issues: FloorplanPreflightIssue[]
  setIssues: (issues: readonly FloorplanPreflightIssue[]) => void
  reset: () => void
}

export const useFloorplanPreflight = create<FloorplanPreflightState>((set) => ({
  issues: [],
  setIssues: (issues) => set({ issues: [...issues] }),
  reset: () => set((state) => (state.issues.length === 0 ? state : { issues: [] })),
}))

export default useFloorplanPreflight
