'use client'
import { type AnyNodeId, MaterialSchema, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  ProceduralItemNode,
  proceduralSlotColor,
  setProceduralMaterial,
  snapParameters,
  validateProceduralRelations,
} from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { SliderControl } from '../ui/controls/slider-control'
import { PanelWrapper } from '../ui/panels/panel-wrapper'
export function ProceduralInspector({
  nodeId,
  partId,
  onPartChange,
}: {
  nodeId: string
  partId: string | null
  onPartChange: (id: string | null) => void
}) {
  const committed = useScene((s) => s.nodes[nodeId as AnyNodeId]) as unknown as
    | ProceduralItemNode
    | undefined
  const override = useLiveNodeOverrides((s) => s.overrides.get(nodeId))
  const node = committed ? ({ ...committed, ...override } as ProceduralItemNode) : null
  const materials = useScene((s) => s.materials)
  const [error, setError] = useState('')
  useEffect(() => () => useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId), [nodeId])
  if (!node || !committed) return null
  const change = (id: string, value: number, commit: boolean) => {
    const values = { ...node.parameters, [id]: value }
    const parameters = commit ? snapParameters(node.recipe, values) : values
    const parsed = ProceduralItemNode.safeParse({ ...node, parameters })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid edit')
      if (commit) useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId)
      return
    }
    try {
      validateProceduralRelations({ ...node, parameters }, useScene.getState().nodes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid attachment')
      if (commit) useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId)
      return
    }
    setError('')
    if (commit) {
      useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId)
      useScene.getState().updateNode(nodeId as AnyNodeId, { parameters } as never)
    } else useLiveNodeOverrides.getState().set(nodeId as AnyNodeId, { parameters } as never)
  }
  const fields = node.recipe.parameters.filter((p) =>
    partId ? p.part === partId : !p.part || Boolean(p.axis),
  )
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">
          {partId ? node.recipe.parts.find((p) => p.id === partId)?.label : 'Adjust design'}
        </h2>
        {partId && (
          <button
            className="rounded-full border px-3 py-1 text-xs"
            onClick={() => onPartChange(null)}
            type="button"
          >
            Back
          </button>
        )}
      </div>
      <div className="space-y-3">
        {fields.map((p) => (
          <SliderControl
            key={p.id}
            label={p.label}
            value={node.parameters[p.id] ?? p.default}
            min={p.min}
            max={p.max}
            step={p.step}
            precision={3}
            unit={p.unit === 'm' ? 'm' : ''}
            onChange={(v) => change(p.id, v, false)}
            onCommit={(v) => change(p.id, v, true)}
          />
        ))}
      </div>
      {partId && (
        <button
          type="button"
          className="rounded-full border px-3 py-1 text-xs"
          onClick={() => {
            const parameters = { ...committed.parameters }
            for (const p of fields) delete parameters[p.id]
            try {
              ProceduralItemNode.parse({ ...committed, parameters })
              useScene.getState().updateNode(nodeId as AnyNodeId, { parameters } as never)
              setError('')
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid reset')
            }
          }}
        >
          Reset this part
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}
      {!partId && (
        <div>
          <h3 className="mb-2 font-medium text-sm">Edit parts</h3>
          <div className="flex flex-wrap gap-2">
            {node.recipe.parts.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-stone-100"
                onClick={() => onPartChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-3 font-medium text-sm">Materials</h3>
        {node.recipe.slots
          .filter(
            (slot) =>
              !partId ||
              node.recipe.parts
                .find((p) => p.id === partId)
                ?.shapes.some((s) => s.slot === slot.id),
          )
          .map((slot) => (
            <label key={slot.id} className="mb-2 flex items-center justify-between text-sm">
              {slot.label}
              <select
                aria-label={`${slot.label} material`}
                className="max-w-28 rounded border text-xs"
                value={
                  node.slots[slot.id]?.startsWith('scene:') ||
                  node.slots[slot.id]?.startsWith('library:')
                    ? node.slots[slot.id]
                    : ''
                }
                onChange={(e) =>
                  setProceduralMaterial(nodeId, slot.id, e.target.value || undefined)
                }
              >
                <option value="">Design default</option>
                {node.slots[slot.id]?.startsWith('library:') && (
                  <option value={node.slots[slot.id]}>Library material</option>
                )}
                {Object.values(materials).map((m) => (
                  <option key={m.id} value={`scene:${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${slot.label} color`}
                type="color"
                value={proceduralSlotColor(node.slots[slot.id], slot.color, materials)}
                onChange={(e) =>
                  setProceduralMaterial(
                    nodeId,
                    slot.id,
                    undefined,
                    MaterialSchema.parse({
                      properties: { color: e.target.value, roughness: 0.75 },
                    }),
                  )
                }
              />
            </label>
          ))}
      </div>
    </div>
  )
}

export default function ProceduralItemPanel({ node }: { node: ProceduralItemNode }) {
  const [partId, setPartId] = useState<string | null>(null)
  return (
    <PanelWrapper
      title={node.name ?? node.recipe.name}
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
    >
      <div className="space-y-5 p-3">
        <ProceduralInspector
          key={node.id}
          nodeId={node.id}
          partId={partId}
          onPartChange={setPartId}
        />
        <ProceduralPlacementControls node={node} />
      </div>
    </PanelWrapper>
  )
}

function ProceduralPlacementControls({ node }: { node: ProceduralItemNode }) {
  const [error, setError] = useState('')
  const update = (patch: Partial<ProceduralItemNode>) => {
    try {
      useScene.getState().updateNode(node.id as AnyNodeId, patch as never)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid placement')
    }
  }
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer font-medium text-sm">Placement</summary>
      <div className="grid grid-cols-3 gap-2">
        {(node.wallId ? ['Along wall', 'Height', 'Gap'] : ['X', 'Y', 'Z']).map((label, i) => (
          <label className="text-xs" key={`${node.id}:${i}:${node.position[i]}`}>
            {label} (m)
            <input
              className="mt-1 w-full rounded border border-border bg-background p-1"
              defaultValue={node.position[i]}
              step="0.01"
              type="number"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onBlur={(e) => {
                const position = [...node.position] as [number, number, number]
                position[i] = Math.round(e.currentTarget.valueAsNumber * 1000) / 1000
                update({ position })
                e.currentTarget.value = String(
                  (useScene.getState().nodes[node.id as AnyNodeId] as unknown as ProceduralItemNode)
                    .position[i],
                )
              }}
            />
          </label>
        ))}
      </div>
      {node.wallId && (
        <label className="block text-xs">
          Side
          <select
            className="ml-2 rounded border border-border bg-background p-1"
            value={node.side ?? 'front'}
            onChange={(e) => update({ side: e.target.value as 'front' | 'back' })}
          >
            <option value="front">Front</option>
            <option value="back">Back</option>
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-red-600 text-xs">
          {error}
        </p>
      )}
    </details>
  )
}
