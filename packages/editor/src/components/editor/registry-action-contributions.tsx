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
import { DoorClosed, DoorOpen, PanelTopClose, PanelTopOpen, Play, Square } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import { ActionMenuButton } from './action-menu-button'

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

function MechanismGlyph({
  icon,
  running,
}: {
  icon: MechanismCapability['icon']
  running: boolean
}) {
  const Glyph =
    icon === 'door'
      ? running
        ? DoorClosed
        : DoorOpen
      : icon === 'window'
        ? running
          ? PanelTopClose
          : PanelTopOpen
        : running
          ? Square
          : Play
  return <Glyph className="h-4 w-4" />
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
  const label = mechanism.icon ? (running ? 'Close' : 'Open') : running ? 'Stop' : 'Play'
  return (
    <ActionMenuButton
      keys={['E']}
      label={label}
      onClick={(event) => {
        event.stopPropagation()
        toggleMechanism(mechanism, node)
      }}
      pressed={running}
    >
      <MechanismGlyph icon={mechanism.icon} running={running} />
    </ActionMenuButton>
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
