'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AnyNodeDefinition,
  nodeRegistry,
  type ParamField,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

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
export function ParametricInspector() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? s.nodes[selectedId as AnyNodeId] : undefined,
  )

  const def = node ? nodeRegistry.get(node.type) : undefined
  const parametrics = def?.parametrics

  const handleUpdate = useCallback(
    (patch: Partial<AnyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNodeId, patch)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node as any)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:structure-delete')
    deleteNode(selectedId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  if (!node || !def || !parametrics) return null

  const presentation = def.presentation
  const title = presentation?.label ?? node.type
  const canMove = !!def.capabilities.movable
  const canDelete = def.capabilities.deletable !== false

  return (
    <PanelWrapper onClose={handleClose} title={title} width={320}>
      {parametrics.groups.map((group, gi) => (
        <PanelSection key={`group-${gi}`} title={group.label}>
          {group.fields.map((field, fi) => {
            // Skip fields whose visibleIf predicate excludes the current node.
            const visibleIf = (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf
            if (visibleIf && !visibleIf(node)) return null
            return (
              <FieldRenderer
                key={`field-${gi}-${fi}-${String(field.key)}`}
                field={field as ParamField<AnyNode>}
                node={node}
                onUpdate={handleUpdate}
              />
            )
          })}
        </PanelSection>
      ))}
      {(canMove || canDelete) && (
        <PanelSection title="Actions">
          <ActionGroup>
            {canMove && (
              <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={handleMove} />
            )}
            {canDelete && (
              <ActionButton
                className="border-red-500/40 text-red-200 hover:bg-red-500/15"
                icon={<Trash2 className="h-4 w-4" />}
                label="Delete"
                onClick={handleDelete}
              />
            )}
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

// ─── Per-field renderers ─────────────────────────────────────────────

interface FieldRendererProps {
  field: ParamField<AnyNode>
  node: AnyNode
  onUpdate: (patch: Partial<AnyNode>) => void
}

function FieldRenderer({ field, node, onUpdate }: FieldRendererProps) {
  const key = String(field.key)
  const value = (node as Record<string, unknown>)[key]

  switch (field.kind) {
    case 'number': {
      const num = typeof value === 'number' ? value : 0
      const step = field.step ?? 0.01
      const precision = precisionForStep(step)
      return (
        <SliderControl
          label={prettifyKey(key)}
          max={field.max}
          min={field.min}
          onChange={(next) => onUpdate({ [key]: next } as Partial<AnyNode>)}
          precision={precision}
          step={step}
          unit={field.unit ?? ''}
          value={num}
        />
      )
    }

    case 'enum': {
      const str = typeof value === 'string' ? value : (field.options[0] ?? '')
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <select
            className="rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
            onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
            value={str}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {prettifyEnumValue(opt)}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case 'color': {
      const str = typeof value === 'string' ? value : '#888888'
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <div className="flex items-center gap-2">
            <input
              className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
              onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
              type="color"
              value={str}
            />
            <input
              className="w-20 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
              type="text"
              value={str}
            />
          </div>
        </div>
      )
    }

    case 'vec3': {
      const v = Array.isArray(value) && value.length >= 3
        ? (value as [number, number, number])
        : [0, 0, 0]
      const axes: Array<{ label: string; index: 0 | 1 | 2 }> = [
        { label: 'X', index: 0 },
        { label: 'Y', index: 1 },
        { label: 'Z', index: 2 },
      ]
      return (
        <>
          {axes.map(({ label, index }) => {
            // v is a [number, number, number] tuple; the explicit local
            // resolves TS's noUncheckedIndexedAccess concern that v[index]
            // could be undefined.
            const axisValue = v[index] ?? 0
            return (
              <SliderControl
                key={`${key}-${label}`}
                label={label}
                max={axisValue + 5}
                min={axisValue - 5}
                onChange={(next) => {
                  const updated = [...v] as [number, number, number]
                  updated[index] = next
                  onUpdate({ [key]: updated } as Partial<AnyNode>)
                }}
                precision={2}
                step={0.05}
                unit="m"
                value={Math.round(axisValue * 100) / 100}
              />
            )
          })}
        </>
      )
    }

    default:
      // material / ref / unrecognized kinds — not implemented in v1.
      return null
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function precisionForStep(step: number): number {
  if (step <= 0) return 0
  return Math.max(0, Math.ceil(-Math.log10(step)))
}

function prettifyKey(key: string): string {
  // 'bracketStyle' → 'Bracket style'
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function prettifyEnumValue(value: string): string {
  // 'minimal' → 'Minimal'; 'roof-segment' → 'Roof segment'
  return value
    .split(/[-_\s]/)
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase(),
    )
    .join(' ')
}
