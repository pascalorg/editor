'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type MechanismCapability,
  nodeMechanism,
  nodeRegistry,
  toggleMechanism,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Play, Square } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'

type Loader = () => Promise<{ default: ComponentType }>
const lazyCache = new WeakMap<Loader, ComponentType>()

function contribution(kind: string): ComponentType | null {
  const loader = getFloorplanNodeExtension(nodeRegistry.get(kind))?.actionMenu?.actions
  if (!loader) return null
  const cached = lazyCache.get(loader)
  if (cached) return cached
  const component = lazy(loader)
  lazyCache.set(loader, component)
  return component
}

/** The node the action menu's Play/Stop runs: the only selected node, when its kind declares a mechanism. */
export function selectedMechanismNode(
  selectedIds: readonly string[],
  nodes: Readonly<Record<string, AnyNode>>,
): AnyNode | undefined {
  const node = selectedIds.length === 1 ? nodes[selectedIds[0]!] : undefined
  return nodeMechanism(node) ? node : undefined
}

export function MechanismButton({
  node,
  mechanism,
  running,
}: {
  node: AnyNode
  mechanism: MechanismCapability
  running: boolean
}) {
  return (
    <button
      type="button"
      aria-label={running ? 'Stop' : 'Play'}
      title={running ? 'Stop' : 'Play'}
      aria-pressed={running}
      className={`tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${running ? 'bg-accent text-foreground' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        toggleMechanism(mechanism, node)
      }}
    >
      {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </button>
  )
}

/** Play/Stop for a single selected node whose kind declares `capabilities.mechanism`. */
function MechanismAction() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const node = useScene((s) => selectedMechanismNode(selected, s.nodes))
  const mechanism = nodeMechanism(node)
  const running = useInteractive((s) => (node && mechanism ? mechanism.isOn(node, s) : false))
  return node && mechanism ? (
    <MechanismButton mechanism={mechanism} node={node} running={running} />
  ) : null
}

/**
 * The buttons kinds add to the action menu for selections holding them
 * (`extensions['pascal:editor/floorplan'].actionMenu.actions`), in 2D and 3D
 * alike. Each contribution reads the selection and decides its own visibility.
 */
export function RegistryActionContributions() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const kinds = useScene(
    useShallow((s) =>
      Array.from(
        new Set(
          selectedIds.flatMap((id) => {
            const type = s.nodes[id as AnyNodeId]?.type
            return type ? [type] : []
          }),
        ),
      ).sort(),
    ),
  )
  return (
    <>
      <MechanismAction />
      {kinds.map((kind) => {
        const Contribution = contribution(kind)
        return Contribution ? (
          <Suspense fallback={null} key={kind}>
            <Contribution />
          </Suspense>
        ) : null
      })}
    </>
  )
}
