'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'

function useHangerDependencies(kind: 'duct-segment' | 'pipe-segment') {
  useEffect(
    () =>
      useScene.subscribe((state, previous) => {
        if (state.nodes === previous.nodes) return
        const structural = new Set([
          'wall',
          'ceiling',
          'slab',
          'level',
          'building',
          'site',
          'door',
          'window',
        ])
        const changed = new Set([...Object.keys(state.nodes), ...Object.keys(previous.nodes)])
        const needsUpdate = [...changed].some((id) => {
          const a = state.nodes[id as keyof typeof state.nodes]
          const b = previous.nodes[id as keyof typeof previous.nodes]
          return a !== b && (structural.has(a?.type ?? '') || structural.has(b?.type ?? ''))
        })
        if (!needsUpdate) return
        for (const node of Object.values(state.nodes)) {
          if (node.type === kind && node.autoHangers) state.markDirty(node.id)
        }
      }),
    [kind],
  )
}

export function DuctHangerSystem() {
  useHangerDependencies('duct-segment')
  return null
}
export function PipeHangerSystem() {
  useHangerDependencies('pipe-segment')
  return null
}
