'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { buildWindowPreviewMesh } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { applyGhost } from '../shared/ghost-materials'
import type { WindowNode } from './schema'

/**
 * Translucent preview of a window — used by the placement tool's floating ghost.
 *
 * Builds the window mesh via buildWindowPreviewMesh (so the preview shape stays in
 * lockstep with committed windows), then applies ghost treatment (translucent,
 * raycast-off, tinted red if invalid).
 *
 * The root mesh's layer is set to EDITOR_LAYER because the invisible hitbox
 * material on SCENE_LAYER would poison the WebGPU MRT pass (project gotcha).
 */
const WindowPreview = ({
  node,
  invalid,
  valid,
}: {
  node: WindowNode
  invalid?: boolean
  valid?: boolean
}) => {
  const mesh = useMemo(() => {
    const m = buildWindowPreviewMesh(node)
    m.layers.set(EDITOR_LAYER)
    return m
  }, [node])

  // Ghost treatment (clone + tint + raycast-off) re-applies if the tint flips;
  // its cleanup only disposes the clones it made.
  useEffect(() => applyGhost(mesh, { invalid, valid }), [mesh, invalid, valid])

  // Geometry is freshly built per `mesh` and owned here — dispose it only
  // when the mesh itself is replaced/unmounted, never on an `invalid` toggle.
  useEffect(
    () => () => {
      mesh.traverse((obj) => {
        const m = obj as { geometry?: { dispose: () => void } }
        m.geometry?.dispose()
      })
    },
    [mesh],
  )

  return <primitive object={mesh} />
}

export default WindowPreview
