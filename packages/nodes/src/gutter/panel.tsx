'use client'

import { type GutterNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  duplicateNodeAndPickUp,
  PanelSection,
  PanelWrapper,
  SliderControl,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import DownspoutsPanel from './downspouts-panel'

export default function GutterPanel({ node: stored }: { node: GutterNode }) {
  const overrides = useLiveNodeOverrides((s) => s.get(stored.id))
  const node = { ...stored, ...overrides } as GutterNode
  const setSelection = useViewer((s) => s.setSelection)
  const commit = (patch: Partial<GutterNode>) => {
    useScene.getState().updateNode(node.id, patch)
    useLiveNodeOverrides.getState().clear(node.id)
  }
  const dimension = (
    key: 'length' | 'size' | 'thickness' | 'hangerSpacing',
    label: string,
    min: number,
    step: number,
  ) => (
    <SliderControl
      label={label}
      value={node[key]}
      min={min}
      max={key === 'thickness' ? node.size * 0.4 : undefined}
      step={step}
      precision={3}
      unit="m"
      restoreOnCommit={false}
      onChange={(value) => useLiveNodeOverrides.getState().set(node.id, { [key]: value })}
      onCommit={(value) => commit({ [key]: value })}
    />
  )
  return (
    <PanelWrapper
      icon="/icons/gutter.webp"
      title={node.name || 'Gutter'}
      width={300}
      onClose={() => setSelection({ selectedIds: [] })}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-3 gap-2">
          {(['k-style', 'half-round', 'box'] as const).map((profile) => (
            <button
              key={profile}
              type="button"
              aria-pressed={node.profile === profile}
              onClick={() => commit({ profile })}
              className={`rounded-lg border p-2 text-xs ${node.profile === profile ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
            >
              <img
                src={`/icons/gutter/${profile}.webp`}
                alt=""
                className="mx-auto h-14 w-14 object-contain"
              />
              {profile === 'k-style' ? 'K-style' : profile === 'half-round' ? 'Half-round' : 'Box'}
            </button>
          ))}
        </div>
      </PanelSection>
      <PanelSection title="Dimensions">
        {dimension('length', 'Run length', 0.05, 0.05)}
        {dimension('size', 'Channel depth', 0.04, 0.005)}
        {dimension('thickness', 'Wall thickness', 0.001, 0.001)}
        <p className="text-xs text-muted-foreground">
          Half-round width is twice the channel depth. Move aligns the run to the roof eave.
        </p>
      </PanelSection>
      <PanelSection title="End caps">
        {(['endCapLeft', 'endCapRight'] as const).map((key) => (
          <label key={key} className="flex items-center justify-between py-2 text-sm">
            {key === 'endCapLeft' ? 'Left cap' : 'Right cap'}
            <input
              type="checkbox"
              checked={node[key]}
              onChange={(event) => commit({ [key]: event.target.checked })}
            />
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Caps are hidden where runs form a mitred corner.
        </p>
      </PanelSection>
      <PanelSection title="Hangers">
        <label className="flex items-center justify-between py-2 text-sm">
          Show straps
          <input
            type="checkbox"
            checked={node.hangerStyle !== 'none'}
            onChange={(event) => commit({ hangerStyle: event.target.checked ? 'strap' : 'none' })}
          />
        </label>
        {node.hangerStyle !== 'none' && dimension('hangerSpacing', 'Maximum spacing', 0.2, 0.05)}
      </PanelSection>
      <DownspoutsPanel />
      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move size={14} />}
            label="Move"
            onClick={() => {
              useEditor.getState().setMovingNode(stored)
              setSelection({ selectedIds: [] })
            }}
          />
          <ActionButton
            icon={<Copy size={14} />}
            label="Duplicate"
            onClick={() => duplicateNodeAndPickUp(stored)}
          />
          <ActionButton
            icon={<Trash2 size={14} />}
            label="Delete"
            onClick={() => {
              useScene.getState().deleteNode(node.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
