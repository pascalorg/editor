'use client'

import { emitter } from '@pascal-app/core'
import {
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useEffect } from 'react'

let owners = 0

/** Two view adapters share one armed point-placement scope, never two scene drafts. */
export function useRockPlacementScope() {
  useEffect(() => {
    owners++
    if (owners === 1) useInteractionScope.getState().begin({ kind: 'drafting', tool: 'rock' })
    const cancel = () => {
      const scope = useInteractionScope.getState().scope
      if (scope.kind !== 'drafting' || scope.tool !== 'rock') return
      markToolCancelConsumed()
      useInteractionScope.getState().end()
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return
      event.preventDefault()
      cancel()
    }
    window.addEventListener('keydown', key)
    emitter.on('tool:cancel', cancel)
    return () => {
      window.removeEventListener('keydown', key)
      emitter.off('tool:cancel', cancel)
      owners--
      if (!owners)
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'rock')
    }
  }, [])
}
