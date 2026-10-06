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

type Nodes = ReturnType<typeof useScene.getState>['nodes']
type Overrides = ReturnType<typeof useLiveNodeOverrides.getState>['overrides']
const effectiveNodesMemo = new WeakMap<Nodes, WeakMap<Overrides, Nodes>>()

function effectiveRiseNodes(nodes: Nodes, overrides: Overrides): Nodes {
  if (!overrides.size) return nodes
  let cache = effectiveNodesMemo.get(nodes)
  if (!cache) {
    cache = new WeakMap()
    effectiveNodesMemo.set(nodes, cache)
  }
  const cached = cache.get(overrides)
  if (cached) return cached
  const effective = { ...nodes }
  for (const [id, override] of overrides) {
    const node = nodes[id as AnyNodeId]
    if (node) effective[id as AnyNodeId] = { ...node, ...override } as AnyNode
  }
  cache.set(overrides, effective)
  return effective
}

export function useStairTotalRise(stair: StairNode) {
  const selector = useMemo(() => {
    let lastNodes: Nodes | undefined
    let rise = 0
    const snapshot = () => {
      if (stair.totalRise !== undefined) return stair.totalRise
      const nodes = effectiveRiseNodes(
        useScene.getState().nodes,
        useLiveNodeOverrides.getState().overrides,
      )
      if (nodes !== lastNodes) {
        rise = resolveStairTotalRise(stair, nodes)
        lastNodes = nodes
      }
      return rise
    }
    const subscribe = (onChange: () => void) => {
      let previous = snapshot()
      const check = () => {
        const current = snapshot()
        if (Object.is(previous, current)) return
        previous = current
        onChange()
      }
      const scene = useScene.subscribe(check)
      const live = useLiveNodeOverrides.subscribe(check)
      return () => {
        scene()
        live()
      }
    }
    return { snapshot, subscribe }
  }, [stair])
  return useSyncExternalStore(selector.subscribe, selector.snapshot, selector.snapshot)
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

export type StairRenderData = ReturnType<typeof useStairRenderData>
