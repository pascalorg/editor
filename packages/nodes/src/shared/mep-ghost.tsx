'use client'

import type {
  DuctFittingNode,
  DuctSegmentNode,
  PipeFittingNode,
  PipeSegmentNode,
} from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useMemo } from 'react'
import { Mesh, MeshBasicMaterial } from 'three'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { buildDuctSegmentGeometry } from '../duct-segment/geometry'
import { buildPipeFittingGeometry } from '../pipe-fitting/geometry'
import { buildPipeSegmentGeometry } from '../pipe-segment/geometry'
import { INVALID_GHOST_COLOR, VALID_GHOST_COLOR } from './ghost-materials'

/** Indigo-400 — the shared MEP preview accent (matches the draw-tool ghost). */
export const GHOST_COLOR = '#818cf8'
export const GHOST_OPACITY = 0.55

/** Tint state for an auto-routed offset preview: green = a buildable offset
 *  that will mint on release, red = no valid offset at this height (the run
 *  lifts as a preview only and snaps back). Undefined = the neutral indigo
 *  preview used everywhere else. */
export type GhostTint = 'valid' | 'invalid' | undefined

function ghostColor(tint: GhostTint): number | string {
  if (tint === 'valid') return VALID_GHOST_COLOR
  if (tint === 'invalid') return INVALID_GHOST_COLOR
  return GHOST_COLOR
}

/** Repaint every mesh in `group` as a translucent, depth-test-free preview. */
function ghostify(group: { traverse: (cb: (child: object) => void) => void }, tint: GhostTint) {
  const color = ghostColor(tint)
  group.traverse((child) => {
    if (child instanceof Mesh) {
      child.layers.set(EDITOR_LAYER)
      child.material = new MeshBasicMaterial({
        color,
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
export function FittingGhost({ fitting, tint }: { fitting: DuctFittingNode; tint?: GhostTint }) {
  const ghost = useMemo(() => {
    const group = buildDuctFittingGeometry(fitting)
    group.position.set(...fitting.position)
    group.rotation.set(fitting.rotation[0], fitting.rotation[1], fitting.rotation[2])
    ghostify(group, tint)
    return group
  }, [fitting, tint])
  return <primitive object={ghost} />
}

/**
 * Translucent ghost of a duct-segment run. Path coords are level-local and
 * the node's transform is identity, so the built group renders at the origin
 * — the same frame the fitting ghosts use.
 */
export function DuctSegmentGhost({ duct, tint }: { duct: DuctSegmentNode; tint?: GhostTint }) {
  const ghost = useMemo(() => {
    const group = buildDuctSegmentGeometry(duct)
    ghostify(group, tint)
    return group
  }, [duct, tint])
  return <primitive object={ghost} />
}

export function PipeFittingGhost({
  fitting,
  tint,
}: {
  fitting: PipeFittingNode
  tint?: GhostTint
}) {
  const ghost = useMemo(() => {
    const group = buildPipeFittingGeometry(fitting)
    group.position.set(...fitting.position)
    group.rotation.set(fitting.rotation[0], fitting.rotation[1], fitting.rotation[2])
    ghostify(group, tint)
    return group
  }, [fitting, tint])
  return <primitive object={ghost} />
}

export function PipeSegmentGhost({ pipe, tint }: { pipe: PipeSegmentNode; tint?: GhostTint }) {
  const ghost = useMemo(() => {
    const group = buildPipeSegmentGeometry(pipe)
    ghostify(group, tint)
    return group
  }, [pipe, tint])
  return <primitive object={ghost} />
}
