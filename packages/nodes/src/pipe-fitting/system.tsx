'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { cycleRotationAxis } from '../duct-fitting/rotation'

/**
 * Selection-time rotation support for placed pipe fittings — mirrors
 * the duct-fitting system. R/T rotation lives in `def.keyboardActions`;
 * this contributes the piece that hook can't: **Alt cycles the active
 * rotation axis** while a single fitting is selected. The axis lives on
 * `useEditor.rotationAxis`, which the floating action menu reads to
 * show the axis pill — so this component renders nothing.
 */
const PipeFittingSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const hasSelectedFitting = useScene((s) => {
    if (selectedIds.length !== 1) return false
    return s.nodes[selectedIds[0] as AnyNodeId]?.type === 'pipe-fitting'
  })

  useEffect(() => {
    if (!hasSelectedFitting) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.repeat) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      cycleRotationAxis()
    }
    // Bubble phase — when the placement tool is active its capture-phase
    // handler stops propagation, so the two never double-cycle.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasSelectedFitting])

  return null
}

export default PipeFittingSystem
