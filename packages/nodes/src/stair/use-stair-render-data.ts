'use client'

import {
  type AnyNode,
  type AnyNodeId,
  resolveStairTotalRise,
  type StairNode,
  type StairSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'

function subscribeRise(onChange: () => void) {
  const scene = useScene.subscribe(onChange)
  const live = useLiveNodeOverrides.subscribe(onChange)
  return () => {
    scene()
    live()
  }
}

/** Structural context can change a following stair's rise, but only the
 * resulting scalar belongs in rendering dependencies. */
export function useStairTotalRise(stair: StairNode) {
  const snapshot = useMemo(() => {
    let lastNodes: ReturnType<typeof useScene.getState>['nodes'] | undefined
    let lastOverrides: ReturnType<typeof useLiveNodeOverrides.getState>['overrides'] | undefined
    let rise = 0
    return () => {
      if (stair.totalRise !== undefined) return stair.totalRise
      const nodes = useScene.getState().nodes
      const overrides = useLiveNodeOverrides.getState().overrides
      if (nodes === lastNodes && overrides === lastOverrides) return rise
      const effective: Record<string, AnyNode> = { ...nodes }
      for (const [id, override] of overrides) {
        const node = nodes[id as AnyNodeId]
        if (node) effective[id] = { ...node, ...override } as AnyNode
      }
      rise = resolveStairTotalRise(stair, effective)
      lastNodes = nodes
      lastOverrides = overrides
      return rise
    }
  }, [stair])
  return useSyncExternalStore(subscribeRise, snapshot, snapshot)
}

export function useStairRenderData(stair: StairNode) {
  const children = useScene(useShallow((state) => stair.children.map((id) => state.nodes[id])))
  const overrides = useLiveNodeOverrides(
    useShallow((state) => stair.children.map((id) => state.overrides.get(id))),
  )
  const segments = useMemo(
    () =>
      children
        .map((child, index) => {
          const override = overrides[index]
          return child && override ? { ...child, ...override } : child
        })
        .filter((child): child is StairSegmentNode => child?.type === 'stair-segment'),
    [children, overrides],
  )
  const totalRise = useStairTotalRise(stair)
  const resolvedStair = useMemo(
    () => (stair.totalRise === totalRise ? stair : { ...stair, totalRise }),
    [stair, totalRise],
  )
  const nodes = useMemo(
    () => Object.fromEntries(segments.map((segment) => [segment.id, segment])),
    [segments],
  )
  return { stair: resolvedStair, segments, nodes, totalRise }
}
