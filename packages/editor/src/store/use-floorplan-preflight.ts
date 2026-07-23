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

function preflightIssuesEqual(
  left: readonly FloorplanPreflightIssue[],
  right: readonly FloorplanPreflightIssue[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((issue, index) => {
    const candidate = right[index]
    return (
      candidate !== undefined &&
      issue.id === candidate.id &&
      issue.kind === candidate.kind &&
      issue.severity === candidate.severity &&
      issue.message === candidate.message
    )
  })
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
    set((state) =>
      preflightIssuesEqual(state.layoutIssues, issues)
        ? state
        : { layoutIssues: [...issues], issues: [...issues, ...state.auditIssues] },
    ),
  setAuditIssues: (issues) =>
    set((state) =>
      preflightIssuesEqual(state.auditIssues, issues)
        ? state
        : { auditIssues: [...issues], issues: [...state.layoutIssues, ...issues] },
    ),
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
