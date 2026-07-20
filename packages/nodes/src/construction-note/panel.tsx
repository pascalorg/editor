'use client'

import { type AnyNodeId, type ConstructionNoteNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Link2Off, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resolveConstructionNoteAnchor } from './resolve'

export default function ConstructionNotePanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) => (selectedId ? state.nodes[selectedId as AnyNodeId] : undefined))
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const note = node?.type === 'construction-note' ? node : null
  const [draftText, setDraftText] = useState('')

  useEffect(() => {
    setDraftText(note?.text ?? '')
  }, [note?.text])

  if (!(note && selectedId)) return null

  const commitText = () => {
    const text = draftText.trim() || 'CONSTRUCTION NOTE'
    setDraftText(text)
    if (text !== note.text) updateNode(note.id, { text })
  }

  const update = (patch: Partial<ConstructionNoteNode>) => updateNode(note.id, patch)
  const detach = () => {
    const { point } = resolveConstructionNoteAnchor(note, (id) => useScene.getState().nodes[id])
    update({ anchor: [point[0], point[1]], targetId: null, targetOffset: [0, 0] })
  }

  return (
    <PanelWrapper
      icon="/icons/blueprint.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title="Construction Note"
      width={320}
    >
      <PanelSection title="Note">
        <textarea
          className="min-h-28 w-full resize-y rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition focus:border-primary/60"
          onBlur={commitText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder="Enter construction note"
          value={draftText}
        />
      </PanelSection>

      <PanelSection title="Leader">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Style</span>
          <select
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              update({ leaderStyle: event.target.value as ConstructionNoteNode['leaderStyle'] })
            }
            value={note.leaderStyle}
          >
            <option value="straight">Straight</option>
            <option value="curved">Curved</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Terminator</span>
          <select
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              update({ terminator: event.target.value as ConstructionNoteNode['terminator'] })
            }
            value={note.terminator}
          >
            <option value="arrow">Arrow</option>
            <option value="dot">Dot</option>
            <option value="none">None</option>
          </select>
        </label>
        <SliderControl
          label="Shoulder"
          max={1.5}
          min={0.15}
          onChange={(shoulderLength) => update({ shoulderLength })}
          precision={2}
          step={0.05}
          unit="m"
          value={note.shoulderLength}
        />
        <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div>{note.targetId ? 'Attached to scene element' : 'Free leader anchor'}</div>
          {note.leaderStyle === 'curved' ? (
            <div className="mt-1">Drag the teal handle to reshape the curve.</div>
          ) : null}
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          {note.targetId ? (
            <ActionButton icon={<Link2Off className="h-4 w-4" />} label="Detach" onClick={detach} />
          ) : null}
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => {
              triggerSFX('sfx:structure-delete')
              deleteNode(note.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
