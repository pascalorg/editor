'use client'
import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { useEffect, useState } from 'react'
import { SliderControl } from '../ui/controls/slider-control'
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
  const [error, setError] = useState('')
  useEffect(() => () => useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId), [nodeId])
  if (!node || !committed) return null
  const change = (id: string, value: number, commit: boolean) => {
    const parameters = { ...node.parameters, [id]: value }
    const parsed = ProceduralItemNode.safeParse({ ...node, parameters })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid edit')
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
          <p className="mt-2 text-stone-500 text-xs">Or double-click a part in the preview.</p>
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
              <input
                aria-label={`${slot.label} color`}
                type="color"
                value={node.slots[slot.id] ?? slot.color}
                onChange={(e) =>
                  useScene
                    .getState()
                    .updateNode(
                      nodeId as AnyNodeId,
                      { slots: { ...node.slots, [slot.id]: e.target.value } } as never,
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
    <ProceduralInspector key={node.id} nodeId={node.id} partId={partId} onPartChange={setPartId} />
  )
}
