'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type MechanismCapability,
  type MechanismPart,
  nodeMechanism,
  nodeMechanismParts,
  nodeRegistry,
  toggleMechanism,
  toggleMechanismPart,
  useInteractive,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { DoorClosed, DoorOpen, PanelTopClose, PanelTopOpen, Play, Square } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getFloorplanNodeExtension } from '../../lib/floorplan/floorplan-extension'
import { ActionMenuButton } from './action-menu-button'
import { InspectorExtensionActions } from './inspector-extension-actions'

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

/** The node the action menu's mechanism buttons run: the only selected node. */
export function soleSelectedNode(
  selectedIds: readonly string[],
  nodes: Readonly<Record<string, AnyNode>>,
): AnyNode | undefined {
  return selectedIds.length === 1 ? nodes[selectedIds[0]!] : undefined
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

/** Two louvred leaves: shut across the window, or swung out to its sides. */
function ShuttersGlyph({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      {open ? (
        <>
          <rect height="16" rx="1" width="8" x="8" y="4" />
          <path d="M8 4 3 6v12l5 2M16 4l5 2v12l-5 2" />
        </>
      ) : (
        <>
          <rect height="18" rx="1" width="16" x="4" y="3" />
          <path d="M12 3v18M7 8h2M7 12h2M7 16h2M15 8h2M15 12h2M15 16h2" />
        </>
      )}
    </svg>
  )
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
  const i18n = usePascalI18n()
  const label = i18n._({
    id: 'editor.mechanismAction',
    message: '{action, select, close {Close} open {Open} stop {Stop} other {Play}}',
    values: { action: mechanism.icon ? (running ? 'close' : 'open') : running ? 'stop' : 'play' },
  })
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

/** A second control beside the main one (a window's shutters), with its own running state. */
export function MechanismPartButton({
  node,
  part,
  running,
}: {
  node: AnyNode
  part: MechanismPart
  running: boolean
}) {
  const i18n = usePascalI18n()
  const label =
    part.icon === 'shutters'
      ? i18n._({
          id: 'editor.mechanismPartAction.shutters',
          message: '{action, select, close {Close shutters} other {Open shutters}}',
          values: { action: running ? 'close' : 'open' },
        })
      : i18n._({
          id: 'editor.mechanismAction',
          message: '{action, select, close {Close} open {Open} stop {Stop} other {Play}}',
          values: {
            action: part.verb === 'open' ? (running ? 'close' : 'open') : running ? 'stop' : 'play',
          },
        })
  return (
    <ActionMenuButton
      label={label}
      onClick={(event) => {
        event.stopPropagation()
        toggleMechanismPart(part, node)
      }}
      pressed={running}
    >
      {part.icon === 'shutters' ? (
        <ShuttersGlyph open={!running} />
      ) : (
        <MechanismGlyph icon={undefined} running={running} />
      )}
    </ActionMenuButton>
  )
}

function MechanismPartAction({ node, part }: { node: AnyNode; part: MechanismPart }) {
  const running = useInteractive((s) => part.isOn(node, s))
  return <MechanismPartButton node={node} part={part} running={running} />
}

/**
 * Play/Stop for a kind declaring `capabilities.mechanism`, then one button per
 * part the node has. Parts don't need the main mechanism: a fixed window can
 * still have shutters.
 */
export function NodeMechanismActions({ node }: { node: AnyNode }) {
  const mechanism = nodeMechanism(node)
  const running = useInteractive((s) => (mechanism ? mechanism.isOn(node, s) : false))
  return (
    <>
      {mechanism ? <MechanismButton mechanism={mechanism} node={node} running={running} /> : null}
      {nodeMechanismParts(node).map((part) => (
        <MechanismPartAction key={part.id} node={node} part={part} />
      ))}
    </>
  )
}

function MechanismActions() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const node = useScene((s) => soleSelectedNode(selected, s.nodes))
  return node ? <NodeMechanismActions node={node} /> : null
}

/**
 * The buttons kinds add to the action menu for selections holding them
 * (`extensions['pascal:editor/floorplan'].actionMenu.actions`), in 2D and 3D
 * alike, then one per plugin inspector extension of the selected node. Each
 * contribution reads the selection and decides its own visibility.
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
      <MechanismActions />
      {kinds.map((kind) => {
        const Contribution = contribution(kind)
        return Contribution ? (
          <Suspense fallback={null} key={kind}>
            <Contribution />
          </Suspense>
        ) : null
      })}
      <InspectorExtensionActions />
    </>
  )
}
