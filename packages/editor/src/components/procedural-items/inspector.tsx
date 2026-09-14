'use client'
import { type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  ProceduralItemNode,
  snapParameters,
  validateProceduralRelations,
} from '@pascal-app/core/procedural-items'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { useHandleGroup } from '../../store/use-handle-group'
import { PanelSection } from '../ui/controls/panel-section'
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
  useEffect(() => {
    useHandleGroup.setState({ active: partId ? { nodeId, group: partId } : null })
    return () => {
      if (useHandleGroup.getState().active?.nodeId === nodeId)
        useHandleGroup.setState({ active: null })
    }
  }, [nodeId, partId])
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
  const fields = node.recipe.parameters.filter((p) => (partId ? p.part === partId : !p.part))
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
            restoreOnCommit={false}
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
      {!partId && node.recipe.parameters.some((p) => p.part) && (
        <div>
          <h3 className="mb-2 font-medium text-sm">Edit parts</h3>
          <div className="flex flex-wrap gap-2">
            {node.recipe.parts
              .filter((part) => node.recipe.parameters.some((p) => p.part === part.id))
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-sm text-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onPartChange(p.id)}
                >
                  {p.label}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProceduralItemPanel({ node }: { node: ProceduralItemNode }) {
  return <ProceduralPanel key={node.id} node={node} />
}

function ProceduralPanel({ node }: { node: ProceduralItemNode }) {
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
  const changePosition = (index: number, value: number, commit: boolean) => {
    const live = useLiveNodeOverrides.getState().overrides.get(node.id)
    const position = [
      ...((live?.position as typeof node.position | undefined) ?? node.position),
    ] as typeof node.position
    position[index] = Number(value.toFixed(3))
    const patch = { position }
    try {
      validateProceduralRelations({ ...node, ...patch }, useScene.getState().nodes)
      if (commit) {
        useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
        update(patch)
      } else useLiveNodeOverrides.getState().set(node.id as AnyNodeId, patch)
      setError('')
    } catch (e) {
      if (commit) useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      setError(e instanceof Error ? e.message : 'Invalid position')
    }
  }
  return (
    <PanelSection title="Position">
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <SliderControl
          key={axis}
          label={
            <>
              {axis}
              <sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          value={node.position[index]!}
          min={node.position[index]! - 2}
          max={node.position[index]! + 2}
          precision={2}
          step={0.01}
          unit="m"
          onChange={(value) => changePosition(index, value, false)}
          onCommit={(value) => changePosition(index, value, true)}
          restoreOnCommit={false}
        />
      ))}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </PanelSection>
  )
}
