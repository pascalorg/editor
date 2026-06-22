'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { buildDoorPreviewMesh } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { applyGhost } from '../shared/ghost-materials'
import type { DoorNode } from './schema'

/**
 * Translucent preview of a door — used by the placement tool's floating ghost.
 *
 * Builds the door mesh via buildDoorPreviewMesh (so the preview shape stays in
 * lockstep with committed doors), then applies ghost treatment (translucent,
 * raycast-off, tinted red if invalid).
 *
 * The root mesh's layer is set to EDITOR_LAYER because the invisible hitbox
 * material on SCENE_LAYER would poison the WebGPU MRT pass (project gotcha).
 */
const DoorPreview = ({
  node,
  invalid,
  valid,
}: {
  node: DoorNode
  invalid?: boolean
  valid?: boolean
}) => {
  const mesh = useMemo(() => {
    const m = buildDoorPreviewMesh(node)
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

export default DoorPreview
