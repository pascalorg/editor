import type { AnyNode } from '@pascal-app/core'
import { create } from 'zustand'

export type PathDraftKind = 'duct-segment' | 'lineset' | 'liquid-line' | 'pipe-segment'
export type PathDraftPoint = [number, number, number]
export type PathDraftParameter = boolean | number | string
export type PathDraftParameters = Record<string, PathDraftParameter>

type PathDraftPreviewState = {
  kind: PathDraftKind | null
  points: PathDraftPoint[]
  cursor: PathDraftPoint | null
  parameters: PathDraftParameters
  relatedNodes: AnyNode[]
  setDraft(
    kind: PathDraftKind,
    points: readonly PathDraftPoint[],
    cursor: PathDraftPoint | null,
    parameters?: Readonly<PathDraftParameters>,
    relatedNodes?: readonly AnyNode[],
  ): void
  clear(kind: PathDraftKind): void
  reset(): void
}

function pointEquals(a: PathDraftPoint | null, b: PathDraftPoint | null) {
  return (!a && !b) || Boolean(a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2])
}

function pointsEqual(a: readonly PathDraftPoint[], b: readonly PathDraftPoint[]) {
  return a.length === b.length && a.every((point, index) => pointEquals(point, b[index] ?? null))
}

function parametersEqual(a: PathDraftParameters, b: Readonly<PathDraftParameters>) {
  const keys = Object.keys(a)
  const nextKeys = Object.keys(b)
  return keys.length === nextKeys.length && keys.every((key) => a[key] === b[key])
}

function relatedNodesEqual(a: readonly AnyNode[], b: readonly AnyNode[]) {
  return (
    a.length === b.length &&
    a.every((node, index) => JSON.stringify(node) === JSON.stringify(b[index]))
  )
}

const EMPTY_DRAFT: Pick<
  PathDraftPreviewState,
  'cursor' | 'kind' | 'parameters' | 'points' | 'relatedNodes'
> = {
  cursor: null,
  kind: null,
  parameters: {},
  points: [],
  relatedNodes: [],
}

export const usePathDraftPreview = create<PathDraftPreviewState>((set) => ({
  ...EMPTY_DRAFT,
  setDraft: (kind, points, cursor, parameters = {}, relatedNodes = []) =>
    set((state) => {
      if (
        state.kind === kind &&
        pointEquals(state.cursor, cursor) &&
        pointsEqual(state.points, points) &&
        parametersEqual(state.parameters, parameters) &&
        relatedNodesEqual(state.relatedNodes, relatedNodes)
      ) {
        return state
      }
      return {
        cursor: cursor ? [...cursor] : null,
        kind,
        parameters: { ...parameters },
        points: points.map((point) => [...point]),
        relatedNodes: relatedNodes.map((node) => structuredClone(node)),
      }
    }),
  clear: (kind) => set((state) => (state.kind === kind ? EMPTY_DRAFT : state)),
  reset: () =>
    set((state) =>
      state.kind === null &&
      state.points.length === 0 &&
      state.cursor === null &&
      Object.keys(state.parameters).length === 0 &&
      state.relatedNodes.length === 0
        ? state
        : EMPTY_DRAFT,
    ),
}))
