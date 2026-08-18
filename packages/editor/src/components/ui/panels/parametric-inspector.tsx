'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type IconRef,
  nodeRegistry,
  type ParamAction,
  type ParamField,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { Move, Trash2 } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useCallback } from 'react'
import { resolveMoveActionNode } from '../../../lib/direct-manipulation'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { collectZoneContentIds } from '../../../lib/zone-content'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { ParametricFieldControl } from './parametric-field-control'
import { InspectorFooterContext, PanelWrapper } from './panel-wrapper'

/**
 * Auto-derived right-panel inspector for any registry-backed node.
 *
 * Reads `definition.parametrics` from the registry and renders one
 * `<PanelSection>` per group, one control per field. Field kinds supported:
 * - `number` → SliderControl with min/max/step/unit from the descriptor
 * - `enum`   → dark-themed `<select>`
 * - `color`  → native color picker + hex input
 * - `vec3`   → three SliderControls for X / Y / Z
 *
 * Generic Actions section appends Move / Delete based on `capabilities`.
 *
 * Phase 4 will expand this with per-field `customEditor` support and a
 * `parametrics.customPanel?` escape hatch for kinds whose parametric editor
 * can't be auto-generated (topology editors etc.).
 */
export function ParametricInspector({
  footer,
  nodeId,
  onClose,
}: { footer?: React.ReactNode; nodeId?: AnyNodeId; onClose?: () => void } = {}) {
  const selectedIdFromSelection = useViewer((s) => s.selection.selectedIds[0]) as
    | AnyNodeId
    | undefined
  const selectedId = nodeId ?? selectedIdFromSelection
  const setSelection = useViewer((s) => s.setSelection)
  // Subscribe only to the *type* — a string primitive that doesn't change
  // when slider values change. Without this, every updateNode tick during
  // a drag re-renders the entire panel + every field + every SliderControl.
  // Per-field subscriptions live on FieldRenderer below.
  const nodeType = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))

  const def = nodeType ? nodeRegistry.get(nodeType) : undefined
  const parametrics = def?.parametrics

  const handleUpdate = useCallback(
    (patch: Partial<AnyNode>) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const node = scene.nodes[selectedId]
      if (parametrics?.derive && node) {
        const next = { ...node, ...patch } as AnyNode
        patch = { ...patch, ...parametrics.derive(next, patch) }
      }
      // Bundle the edited node + any reconcile follow-ups into ONE
      // updateNodes call so a single inspector edit is a single undo step.
      const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = [{ id: selectedId, data: patch }]
      if (parametrics?.reconcile && node) {
        const next = { ...node, ...patch } as AnyNode
        updates.push(...parametrics.reconcile(node as AnyNode, next))
      }
      scene.updateNodes(updates)
    },
    [selectedId, parametrics],
  )

  const clearSelection = useCallback(() => {
    if (onClose) {
      onClose()
      return
    }
    setSelection({ selectedIds: [] })
  }, [onClose, setSelection])

  const handleMove = useCallback(() => {
    if (!selectedId) return
    const sceneNodes = useScene.getState().nodes
    const node = sceneNodes[selectedId]
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(resolveMoveActionNode(node, sceneNodes) as any)
    clearSelection()
  }, [selectedId, clearSelection])

  const handleDelete = useCallback(
    (withZoneContent = false) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const node = scene.nodes[selectedId]
      if (!node) return

      const ids =
        withZoneContent && node.type === 'zone'
          ? [selectedId, ...collectZoneContentIds(scene.nodes, node as ZoneNode)]
          : [selectedId]

      sfxEmitter.emit('sfx:structure-delete')
      scene.deleteNodes(Array.from(new Set(ids)))
      clearSelection()
    },
    [selectedId, clearSelection],
  )

  if (!selectedId || !def || !parametrics) return null

  // `parametrics.customPanel` escape hatch — kind owns its panel
  // entirely (loaded lazily so the bundle isn't eager). Used by kinds
  // whose editor has non-parametric concerns (slab holes list, ceiling
  // height presets, etc.) until per-field `customEditor` + missing
  // field kinds (list/action/computed) graduate the auto-derived
  // panel to cover them.
  if (parametrics.customPanel) {
    const CustomPanel = resolveCustomPanel(parametrics.customPanel)
    // Custom panels render their own `<PanelWrapper>` and don't thread a
    // `footer` prop, so hand the host footer down via context.
    return (
      <InspectorFooterContext.Provider value={footer}>
        <Suspense fallback={null}>
          <CustomPanel />
        </Suspense>
      </InspectorFooterContext.Provider>
    )
  }

  const presentation = def.presentation
  const title = presentation?.label ?? nodeType ?? ''
  const iconNode = renderIcon(presentation?.icon)
  const canMove = !!def.capabilities.movable
  const canDelete = def.capabilities.deletable !== false
  const isZone = nodeType === 'zone'

  const TrailingSection = parametrics.trailingSection
    ? resolveCustomPanel(parametrics.trailingSection)
    : null

  return (
    <PanelWrapper
      footer={footer}
      icon={iconNode}
      onClose={clearSelection}
      title={title}
      width={320}
    >
      {parametrics.groups.map((group, gi) => (
        <PanelSection key={`group-${gi}`} title={group.label}>
          {group.fields.map((field, fi) => (
            <FieldRenderer
              key={`field-${gi}-${fi}-${String(field.key)}`}
              field={field as ParamField<AnyNode>}
              nodeId={selectedId}
              onUpdate={handleUpdate}
            />
          ))}
        </PanelSection>
      ))}
      {TrailingSection && (
        <Suspense fallback={null}>
          <TrailingSection />
        </Suspense>
      )}
      {(canMove || canDelete || (parametrics.actions && parametrics.actions.length > 0)) && (
        <PanelSection title="Actions">
          <ActionGroup className={isZone ? 'flex-col' : undefined}>
            {canMove && (
              <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={handleMove} />
            )}
            {parametrics.actions?.map((action, i) => (
              <ParamActionButton action={action} key={`paramaction-${i}`} nodeId={selectedId} />
            ))}
            {canDelete &&
              (isZone ? (
                <>
                  <ActionButton
                    className="w-full flex-none"
                    icon={<Trash2 className="h-4 w-4 text-red-400" />}
                    label="Delete"
                    onClick={() => handleDelete(false)}
                  />
                  <ActionButton
                    className="w-full flex-none"
                    icon={<Trash2 className="h-4 w-4 text-red-400" />}
                    label="Delete with contents"
                    onClick={() => handleDelete(true)}
                  />
                </>
              ) : (
                <ActionButton
                  className="border-red-500/40 text-red-200 hover:bg-red-500/15"
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Delete"
                  onClick={() => handleDelete()}
                />
              ))}
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

// One inspector action button. Subscribes to `enabledIf`'s boolean result
// (same pattern as FieldRenderer's `visible`) so the disabled state stays
// live as the scene mutates — `===` on the boolean keeps unrelated ticks
// from re-rendering it. The click handler re-reads the live node so the
// handler always acts on current state.
function ParamActionButton({ action, nodeId }: { action: ParamAction<AnyNode>; nodeId: AnyNodeId }) {
  const disabled = useScene((s) => {
    if (!action.enabledIf) return false
    const n = s.nodes[nodeId]
    return n ? !action.enabledIf(n as AnyNode) : false
  })
  return (
    <ActionButton
      className={disabled ? 'opacity-40 pointer-events-none' : ''}
      icon={
        action.iconSrc ? (
          <img alt="" className="h-4 w-4 shrink-0 object-contain" src={action.iconSrc} />
        ) : undefined
      }
      label={action.label}
      onClick={() => {
        const live = useScene.getState().nodes[nodeId]
        if (live) action.onClick(live as AnyNode)
      }}
    />
  )
}

function renderIcon(ref: IconRef | undefined): React.ReactNode | undefined {
  if (!ref) return undefined
  if (ref.kind === 'url') {
    // Plain <img> here so the inspector doesn't pull in next/image's
    // server-only requirements (the file is `'use client'`). Same
    // 16x16 box the legacy panels use.
    return <img alt="" className="h-4 w-4 shrink-0 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={16} icon={ref.name} width={16} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={16} viewBox={ref.viewBox} width={16}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  // `component`: lazy-loaded custom icon component. Suspense-safe.
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}

// Cache lazy custom panel components by their loader so React.lazy isn't
// re-invoked across renders.
const customPanelCache = new WeakMap<() => Promise<unknown>, ComponentType>()

function resolveCustomPanel(loader: () => Promise<{ default: ComponentType<any> }>): ComponentType {
  const cached = customPanelCache.get(loader)
  if (cached) return cached
  const Comp = lazy(loader)
  customPanelCache.set(loader, Comp as ComponentType)
  return Comp as ComponentType
}

// ─── Per-field renderers ─────────────────────────────────────────────

interface FieldRendererProps {
  field: ParamField<AnyNode>
  nodeId: AnyNodeId
  onUpdate: (patch: Partial<AnyNode>) => void
}

function FieldRenderer({ field, nodeId, onUpdate }: FieldRendererProps) {
  const key = String(field.key)
  // Subscribe only to this field's value. Zustand compares with ===, so when
  // another field on the same node changes (which produces a new node object
  // reference), this primitive value stays equal and the field doesn't
  // re-render. Vec3 arrays get a new reference only when the array itself
  // changes — same outcome.
  const value = useScene((s) => {
    const n = s.nodes[nodeId]
    return n ? (n as Record<string, unknown>)[key] : undefined
  })
  // visibleIf may consult other fields on the node — subscribe to its boolean
  // result so we re-evaluate when relevant.
  const visible = useScene((s) => {
    const visibleIf = (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf
    if (!visibleIf) return true
    const n = s.nodes[nodeId]
    return n ? visibleIf(n as AnyNode) : false
  })
  if (!visible) return null

  if (field.kind === 'custom') {
    return <CustomFieldRenderer Comp={field.component} nodeId={nodeId} onUpdate={onUpdate} />
  }

  return <ParametricFieldControl field={field} onChange={onUpdate} value={value} />
}

function CustomFieldRenderer({
  Comp,
  nodeId,
  onUpdate,
}: {
  Comp: ComponentType<{ node: AnyNode; onUpdate: (patch: Partial<AnyNode>) => void }>
  nodeId: AnyNodeId
  onUpdate: (patch: Partial<AnyNode>) => void
}) {
  // Subscribe to the full node — the custom editor may read any
  // field. Tools that don't want this churn should write narrower
  // selectors inside Comp itself.
  const node = useScene((s) => s.nodes[nodeId])
  if (!node) return null
  return <Comp node={node} onUpdate={onUpdate} />
}
