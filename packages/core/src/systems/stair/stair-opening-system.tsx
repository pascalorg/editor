'use client'

import { useEffect, useRef } from 'react'
import type { AnyNode } from '../../schema'
import useScene from '../../store/use-scene'
import { syncAutoStairOpenings } from './stair-opening-sync'

function isOpeningRelevantNode(node: AnyNode | undefined) {
  return (
    node?.type === 'building' ||
    node?.type === 'ceiling' ||
    node?.type === 'level' ||
    node?.type === 'slab' ||
    node?.type === 'stair' ||
    node?.type === 'stair-segment'
  )
}

function hasOpeningRelevantNodeChange(
  nextNodes: Record<string, AnyNode>,
  prevNodes: Record<string, AnyNode>,
) {
  if (nextNodes === prevNodes) return false

  const ids = new Set([...Object.keys(nextNodes), ...Object.keys(prevNodes)])
  for (const id of ids) {
    const nextNode = nextNodes[id]
    const prevNode = prevNodes[id]
    if (nextNode === prevNode) continue
    if (isOpeningRelevantNode(nextNode) || isOpeningRelevantNode(prevNode)) return true
  }

  return false
}

export const StairOpeningSystem = () => {
  const syncingAutoOpeningsRef = useRef(false)

  useEffect(() => {
    const applyUpdates = (updates: ReturnType<typeof syncAutoStairOpenings>) => {
      if (updates.length === 0) return
      syncingAutoOpeningsRef.current = true
      useScene.getState().updateNodes(updates)
      queueMicrotask(() => {
        syncingAutoOpeningsRef.current = false
      })
    }

    applyUpdates(syncAutoStairOpenings(useScene.getState().nodes))

    return useScene.subscribe((state, prevState) => {
      if (syncingAutoOpeningsRef.current) return
      if (!hasOpeningRelevantNodeChange(state.nodes, prevState.nodes)) return
      applyUpdates(syncAutoStairOpenings(state.nodes))
    })
  }, [])

  return null
}
