'use client'

import type { DuctFittingNode, DuctSegmentNode } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useMemo } from 'react'
import { Mesh, MeshBasicMaterial } from 'three'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { buildDuctSegmentGeometry } from '../duct-segment/geometry'

/** Indigo-400 — the shared MEP preview accent (matches the draw-tool ghost). */
export const GHOST_COLOR = '#818cf8'
export const GHOST_OPACITY = 0.55

/** Repaint every mesh in `group` as a translucent, depth-test-free preview. */
function ghostify(group: { traverse: (cb: (child: object) => void) => void }) {
  group.traverse((child) => {
    if (child instanceof Mesh) {
      child.layers.set(EDITOR_LAYER)
      child.material = new MeshBasicMaterial({
        color: GHOST_COLOR,
        depthTest: false,
        transparent: true,
        opacity: GHOST_OPACITY,
      })
      child.renderOrder = 999
    }
  })
}

/**
 * Translucent ghost of a duct fitting, built from the same geometry the
 * placed node uses so the preview matches the result. The node carries its
 * level-local `position` / `rotation`, applied here on the group (the
 * renderer normally bakes that in).
 */
export function FittingGhost({ fitting }: { fitting: DuctFittingNode }) {
  const ghost = useMemo(() => {
    const group = buildDuctFittingGeometry(fitting)
    group.position.set(...fitting.position)
    group.rotation.set(fitting.rotation[0], fitting.rotation[1], fitting.rotation[2])
    ghostify(group)
    return group
  }, [fitting])
  return <primitive object={ghost} />
}

/**
 * Translucent ghost of a duct-segment run. Path coords are level-local and
 * the node's transform is identity, so the built group renders at the origin
 * — the same frame the fitting ghosts use.
 */
export function DuctSegmentGhost({ duct }: { duct: DuctSegmentNode }) {
  const ghost = useMemo(() => {
    const group = buildDuctSegmentGeometry(duct)
    ghostify(group)
    return group
  }, [duct])
  return <primitive object={ghost} />
}
