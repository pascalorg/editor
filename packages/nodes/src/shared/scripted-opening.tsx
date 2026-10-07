'use client'

import {
  type AnyNodeId,
  artifactUrl,
  type ColumnNode,
  type DoorNode,
  type ItemNode,
  type ScriptedNode,
  scriptedOrigin,
  scriptedSize,
  scriptInteractive,
  useInteractive,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { SCRIPTED_MODEL_FLAG } from '@pascal-app/viewer'
import { useCallback, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { ScriptedModel } from '../item/renderer'

/**
 * A window, door or column built from a script, rendered exactly as an authored
 * item: the same artifact, paint slots, clips and lights. The artifact's origin
 * is its bottom centre: an opening's mesh is centred on the opening, a column's
 * sits on its support point.
 */
export function ScriptedOpeningModel({ node }: { node: WindowNode | DoorNode | ColumnNode }) {
  const source = node.source!
  const ref = useRef<Group>(null)
  const modelData = useMemo(() => ({ [SCRIPTED_MODEL_FLAG]: true }), [])
  const view = useMemo(() => {
    const [width, height, depth] = scriptedSize(source.manifest)
    return {
      id: node.id,
      type: 'item',
      parentId: node.parentId,
      metadata: node.metadata,
      slots: node.slots,
      source,
      scale: [1, 1, 1],
      asset: {
        src: artifactUrl(source.artifact),
        dimensions: [width, height, depth],
        offset: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        interactive: scriptInteractive(
          source.manifest,
          scriptedOrigin({ type: node.type, source } as ScriptedNode),
        ),
      },
    } as unknown as ItemNode
  }, [node.id, node.type, node.parentId, node.metadata, node.slots, source])
  const setSettled = useCallback(
    (settled: boolean) => {
      if (ref.current) {
        ref.current.userData.itemModelSettled = settled
        // A column has no system of its own: its renderer and batch read the flag on the node's group.
        if (node.type === 'column' && ref.current.parent)
          ref.current.parent.userData.itemModelSettled = settled
      }
      // The opening's system holds its dirty mark until the artifact has loaded.
      if (settled) useScene.getState().markDirty(node.id)
    },
    [node.id, node.type],
  )
  const [, height] = scriptedSize(source.manifest)
  return (
    <group position-y={node.type === 'column' ? 0 : -height / 2} ref={ref} userData={modelData}>
      <ScriptedModel setSettled={setSettled} view={view} />
    </group>
  )
}

/** The toggle that plays a scripted opening's `open` clip, as the item's Open control. */
function openControl(node: { source?: WindowNode['source'] }): number | undefined {
  if (!node.source) return undefined
  const effect = scriptInteractive(node.source.manifest)?.effects.find(
    (candidate) => candidate.kind === 'animation' && candidate.mode === 'open-close',
  )
  return effect?.kind === 'animation' ? effect.control : undefined
}

/** Open and Close for a window or door built from a script: its `open` clip, through the item toggles. */
export const scriptedOpening = {
  has: (node: { source?: WindowNode['source'] }) => openControl(node) !== undefined,
  isOn: (node: { id: string; source?: WindowNode['source'] }) => {
    const control = openControl(node)
    if (control === undefined) return false
    return Boolean(useInteractive.getState().items[node.id as AnyNodeId]?.controlValues[control])
  },
  set: (node: { id: string; source?: WindowNode['source'] }, on: boolean) => {
    const control = openControl(node)
    if (control !== undefined)
      useInteractive.getState().setControlValue(node.id as AnyNodeId, control, on)
  },
}
