'use client'

import { type AnyNode, type AnyNodeId, useInteractive } from '@pascal-app/core'
import { useCallback } from 'react'
import type { Object3D } from 'three'
import useViewer from '../../store/use-viewer'
import {
  type CalloutActionInput,
  calloutSubtitle,
  calloutToggle,
  hasCallout,
  interactiveActions,
  OPEN_SOUNDS,
  openingSound,
  proceduralActions,
  SHUTTERS,
} from '../../systems/interactive/callout-actions'
import type { GlbInteractiveItem } from './glb-interactive'
import { toggleGlbShutters } from './glb-scene-motion'
import { type CalloutAction, SelectionCallout } from './selection-callout'

type BakedExtras = {
  pascalId?: string
  kind?: string
  label?: string
  shutters?: boolean
  openable?: boolean
  clips?: string[]
}

/**
 * The baked viewer's callout on the one selected element. The controls drive
 * the same baked clips and interactive state the walkthrough does.
 */
export function GlbSelectionCallout({
  identity,
  items,
  sceneNodes,
  loopMechanisms,
  isOpen,
  toggleOpen,
}: {
  identity: ReadonlyMap<string, Object3D>
  items: GlbInteractiveItem[] | undefined
  sceneNodes: Readonly<Record<string, AnyNode>> | undefined
  loopMechanisms: ReadonlyMap<string, unknown>
  /** Baked doors and windows open through their `: open` clip, tracked by the scene. */
  isOpen: (id: string) => boolean
  toggleOpen: (object: Object3D) => void
}) {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const id = selectedIds.length === 1 ? selectedIds[0]! : null
  const object = id ? identity.get(id) : undefined
  const interactive = useInteractive()
  const dismiss = useCallback(() => {
    const { selection, setSelection } = useViewer.getState()
    if (id && selection.selectedIds.includes(id)) setSelection({ selectedIds: [] })
  }, [id])

  if (walkthrough || !id || !object) return null
  const extras = object.userData as BakedExtras
  if (!hasCallout(extras.kind)) return null
  const node = sceneNodes?.[id]
  const title = extras.label ?? node?.name ?? 'Item'
  const opening = (node ?? { type: extras.kind ?? 'item' }) as CalloutActionInput

  const actions: CalloutAction[] = []
  const item = items?.find((candidate) => candidate.pascalId === id)
  if (item?.procedural) {
    actions.push(
      ...proceduralActions(
        id as AnyNodeId,
        title,
        item.procedural.recipe ?? { parts: item.procedural.parts },
        interactive,
      ),
    )
  } else if (item) {
    actions.push(
      ...interactiveActions(
        title,
        item.interactive,
        interactive.items[item.pascalId]?.controlValues,
        (index, value) => useInteractive.getState().setControlValue(item.pascalId, index, value),
        opening,
      ),
    )
  } else if (extras.openable && extras.clips?.some((clip) => clip.endsWith(': open'))) {
    actions.push(
      calloutToggle(
        'open',
        extras.kind === 'window' ? 'window' : 'door',
        isOpen(id),
        title,
        openingSound(opening),
        () => toggleOpen(object),
      ),
    )
  } else if (loopMechanisms.has(id)) {
    actions.push(
      calloutToggle(
        'mechanism',
        'power',
        Boolean(interactive.mechanisms[id as AnyNodeId]),
        title,
        OPEN_SOUNDS.switch,
        () => {
          const state = useInteractive.getState()
          state.setMechanism(id as AnyNodeId, !state.mechanisms[id as AnyNodeId])
        },
      ),
    )
  }
  if (extras.shutters)
    actions.push(
      calloutToggle(
        'shutters',
        'shutters',
        Boolean(interactive.mechanismParts[`${id as AnyNodeId}:shutters`]),
        title,
        OPEN_SOUNDS.shutters,
        () => toggleGlbShutters(object),
        SHUTTERS,
      ),
    )

  return (
    <SelectionCallout
      actions={actions}
      key={id}
      object={object}
      onDismiss={dismiss}
      subtitle={calloutSubtitle(node ?? ({ type: extras.kind } as AnyNode), title)}
      title={title}
    />
  )
}
