'use client'

import {
  type AnyNodeId,
  type ConstructionNoteNode,
  ConstructionNoteSpecialty,
  type ConstructionNoteSpecialtyKind,
  useScene,
} from '@pascal-app/core'
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
  const [draftScopeReference, setDraftScopeReference] = useState('')

  useEffect(() => {
    setDraftText(note?.text ?? '')
  }, [note?.text])

  useEffect(() => {
    setDraftScopeReference(note?.scopeReference ?? '')
  }, [note?.scopeReference])

  if (!(note && selectedId)) return null

  const commitText = () => {
    const text = draftText.trim() || 'CONSTRUCTION NOTE'
    setDraftText(text)
    if (text !== note.text) updateNode(note.id, { text })
  }

  const update = (patch: Partial<ConstructionNoteNode>) => updateNode(note.id, patch)
  const updateSpecialty = (patch: Record<string, unknown>) => {
    if (!note.specialty) return
    const parsed = ConstructionNoteSpecialty.safeParse({ ...note.specialty, ...patch })
    if (parsed.success) update({ specialty: parsed.data })
  }
  const setSpecialtyKind = (kind: ConstructionNoteSpecialtyKind | 'general') => {
    update({ specialty: kind === 'general' ? null : ConstructionNoteSpecialty.parse({ kind }) })
  }
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
      <PanelSection title="Classification">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Note type</span>
          <select
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              setSpecialtyKind(event.target.value as ConstructionNoteSpecialtyKind | 'general')
            }
            value={note.specialty?.kind ?? 'general'}
          >
            <option value="general">General</option>
            <option value="access">Attic / crawl access</option>
            <option value="rated-assembly">Rated assembly</option>
            <option value="plumbing-fixture">Tub / shower / spa</option>
            <option value="solid-fuel">Fireplace / solid fuel</option>
            <option value="closet">Closet</option>
            <option value="equipment">Equipment</option>
            <option value="overhead">Overhead outline</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Contract scope</span>
          <select
            className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onChange={(event) =>
              update({
                contractScope: event.target.value as ConstructionNoteNode['contractScope'],
              })
            }
            value={note.contractScope}
          >
            <option value="contract">In contract</option>
            <option value="owner">Owner provided</option>
            <option value="existing">Existing</option>
            <option value="nic">Not in contract (NIC)</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Scope reference</span>
          <input
            className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
            onBlur={() => {
              const scopeReference = draftScopeReference.trim()
              setDraftScopeReference(scopeReference)
              if (scopeReference !== note.scopeReference) update({ scopeReference })
            }}
            onChange={(event) => setDraftScopeReference(event.target.value)}
            placeholder="Optional responsibility or package"
            value={draftScopeReference}
          />
        </label>
      </PanelSection>

      {note.specialty ? (
        <PanelSection title="Specialty data">
          <SpecialtyFields specialty={note.specialty} update={updateSpecialty} />
        </PanelSection>
      ) : null}

      <PanelSection title={note.specialty ? 'Additional note' : 'Note'}>
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

function SpecialtyFields({
  specialty,
  update,
}: {
  specialty: NonNullable<ConstructionNoteNode['specialty']>
  update: (patch: Record<string, unknown>) => void
}) {
  switch (specialty.kind) {
    case 'access':
      return (
        <>
          <SelectField
            label="Space"
            onChange={(spaceType) => update({ spaceType })}
            options={[
              ['attic', 'Attic'],
              ['crawl-space', 'Crawl space'],
            ]}
            value={specialty.spaceType}
          />
          <SelectField
            label="Access"
            onChange={(accessType) => update({ accessType })}
            options={[
              ['scuttle', 'Scuttle'],
              ['panel', 'Panel'],
              ['door', 'Door'],
            ]}
            value={specialty.accessType}
          />
          <LengthSlider
            label="Opening width"
            max={3}
            onChange={(openingWidth) => update({ openingWidth })}
            value={specialty.openingWidth}
          />
          <LengthSlider
            label="Opening height"
            max={3}
            onChange={(openingHeight) => update({ openingHeight })}
            value={specialty.openingHeight}
          />
        </>
      )
    case 'rated-assembly':
      return (
        <>
          <SelectField
            label="Assembly"
            onChange={(assemblyType) => update({ assemblyType })}
            options={[
              ['firewall', 'Firewall'],
              ['fire-barrier', 'Fire barrier'],
              ['smoke-barrier', 'Smoke barrier'],
              ['rated-assembly', 'Rated assembly'],
            ]}
            value={specialty.assemblyType}
          />
          <SliderControl
            label="Rating"
            max={240}
            min={15}
            onChange={(ratingMinutes) => update({ ratingMinutes })}
            precision={0}
            step={15}
            unit="min"
            value={specialty.ratingMinutes}
          />
          <TextField
            label="Assembly reference"
            onCommit={(assemblyReference) => update({ assemblyReference })}
            value={specialty.assemblyReference}
          />
        </>
      )
    case 'plumbing-fixture':
      return (
        <>
          <SelectField
            label="Fixture"
            onChange={(fixtureType) => update({ fixtureType })}
            options={[
              ['tub', 'Tub'],
              ['shower', 'Shower'],
              ['spa', 'Spa'],
            ]}
            value={specialty.fixtureType}
          />
          <LengthSlider
            label="Width"
            max={5}
            onChange={(width) => update({ width })}
            value={specialty.width}
          />
          <LengthSlider
            label="Depth"
            max={5}
            onChange={(depth) => update({ depth })}
            value={specialty.depth}
          />
          <TextField
            label="Material"
            onCommit={(material) => update({ material })}
            value={specialty.material}
          />
        </>
      )
    case 'solid-fuel':
      return (
        <>
          <SelectField
            label="Appliance"
            onChange={(applianceType) => update({ applianceType })}
            options={[
              ['fireplace', 'Fireplace'],
              ['wood-stove', 'Wood stove'],
              ['pellet-stove', 'Pellet stove'],
            ]}
            value={specialty.applianceType}
          />
          <LengthSlider
            label="Minimum clearance"
            max={5}
            min={0}
            onChange={(minimumClearance) => update({ minimumClearance })}
            value={specialty.minimumClearance}
          />
          <TextField
            label="Requirement"
            onCommit={(requirement) => update({ requirement })}
            value={specialty.requirement}
          />
        </>
      )
    case 'closet':
      return (
        <>
          <SelectField
            label="Closet"
            onChange={(closetType) => update({ closetType })}
            options={[
              ['reach-in', 'Reach-in'],
              ['walk-in', 'Walk-in'],
              ['linen', 'Linen'],
            ]}
            value={specialty.closetType}
          />
          <SliderControl
            label="Shelf count"
            max={20}
            min={0}
            onChange={(shelfCount) => update({ shelfCount })}
            precision={0}
            step={1}
            value={specialty.shelfCount}
          />
          <LengthSlider
            label="Shelf depth"
            max={1.5}
            onChange={(shelfDepth) => update({ shelfDepth })}
            value={specialty.shelfDepth}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Shelf pole</span>
            <input
              checked={specialty.hasPole}
              onChange={(event) => update({ hasPole: event.target.checked })}
              type="checkbox"
            />
          </label>
        </>
      )
    case 'equipment':
      return (
        <>
          <TextField
            label="Identifier"
            onCommit={(identifier) => update({ identifier })}
            value={specialty.identifier}
          />
          <TextField
            label="Equipment type"
            onCommit={(equipmentType) => update({ equipmentType })}
            value={specialty.equipmentType}
          />
        </>
      )
    case 'overhead':
      return (
        <>
          <SelectField
            label="Outline"
            onChange={(outlineType) => update({ outlineType })}
            options={[
              ['floor', 'Floor above'],
              ['balcony', 'Balcony above'],
              ['projection', 'Projection above'],
            ]}
            value={specialty.outlineType}
          />
          <LengthSlider
            label="Width"
            max={30}
            onChange={(width) => update({ width })}
            value={specialty.width}
          />
          <LengthSlider
            label="Depth"
            max={30}
            onChange={(depth) => update({ depth })}
            value={specialty.depth}
          />
          <SliderControl
            label="Rotation"
            max={360}
            min={-360}
            onChange={(rotation) => update({ rotation: (rotation * Math.PI) / 180 })}
            precision={0}
            step={1}
            unit="°"
            value={(specialty.rotation * 180) / Math.PI}
          />
        </>
      )
  }
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [value: string, label: string])[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function LengthSlider({
  label,
  value,
  min = 0.05,
  max,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <SliderControl
      label={label}
      max={max}
      min={min}
      onChange={onChange}
      precision={2}
      step={0.05}
      unit="m"
      value={value}
    />
  )
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.target.value.trim())}
      />
    </label>
  )
}
