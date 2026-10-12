'use client'

import type { RoofSegmentNode } from '@pascal-app/core'
import { ActionButton, PanelSection, SliderControl, ToggleControl } from '@pascal-app/editor'
import { Lock } from 'lucide-react'
import {
  applyGableRidgeEdit,
  type GableRidgeEdit,
  type GableRidgeLocks,
  readGableRidgeAtWalls,
  readGableRidgeLocks,
} from './gable-ridge-edit'

const COMPASS_POINTS = [
  'North',
  'North-east',
  'East',
  'South-east',
  'South',
  'South-west',
  'West',
  'North-west',
] as const

/**
 * The side of the plan a slope falling toward local +z faces, for a segment
 * turned by `rotation` (roof + segment). North is the top of the plan (−z).
 */
export function slopeFacing(rotation: number): string {
  const bearing = Math.atan2(Math.sin(rotation), -Math.cos(rotation))
  const index = Math.round(bearing / (Math.PI / 4))
  return COMPASS_POINTS[((index % 8) + 8) % 8]!
}

const PITCH_PRESETS: { label: string; deg: number }[] = [
  { label: '3/12', deg: 14.04 },
  { label: '6/12', deg: 26.57 },
  { label: '9/12', deg: 36.87 },
  { label: '12/12', deg: 45 },
]

function LockedRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex h-8 items-center gap-1.5 px-2 text-muted-foreground text-xs">
      <Lock className="h-3 w-3" />
      <span className="font-medium">{label}</span>
      <div className="flex-1" />
      <span className="font-mono tabular-nums">{value}</span>
      <span>{unit}</span>
    </div>
  )
}

/**
 * A gable's ridge group: where the ridge splits the depth, how high each
 * slope's ridge stands (apart, a step wall of the roof closes the gap),
 * each slope's angle and the attic wall it leaves on each side. The values are
 * tied together; the locks pick which of them hold while another one moves.
 */
export function GableRidgeSection({
  node,
  rotation,
  onUpdate,
}: {
  node: RoofSegmentNode
  /** Roof + segment rotation, to name each slope by the side it faces. */
  rotation: number
  onUpdate: (updates: Partial<RoofSegmentNode>) => void
}) {
  const ridge = readGableRidgeAtWalls(node)
  const locks = readGableRidgeLocks(node.metadata)
  const front = slopeFacing(rotation)
  const back = slopeFacing(rotation + Math.PI)

  const setLocks = (next: GableRidgeLocks) => {
    const metadata =
      typeof node.metadata === 'object' && node.metadata !== null ? node.metadata : {}
    onUpdate({ metadata: { ...metadata, gableLocks: next } })
  }
  const apply = (edit: GableRidgeEdit, from: RoofSegmentNode = node) => {
    const update = applyGableRidgeEdit(from, edit, locks)
    if (update) onUpdate(update)
    return update ? { ...from, ...update } : from
  }

  if (!ridge) {
    return (
      <PanelSection title="Ridge">
        <SliderControl
          label="Pitch"
          max={60}
          min={0}
          onChange={(v) => onUpdate({ pitch: v })}
          precision={0}
          step={1}
          unit="°"
          value={Math.round(node.pitch)}
        />
      </PanelSection>
    )
  }

  const ridgeRow = (label: string, value: number, edit: (v: number) => GableRidgeEdit) =>
    locks.ridge ? (
      <LockedRow key={label} label={label} unit="m" value={value.toFixed(2)} />
    ) : (
      <SliderControl
        key={label}
        label={label}
        max={Math.max(node.depth, 30)}
        min={0}
        onChange={(v) => apply(edit(v))}
        precision={2}
        step={0.05}
        unit="m"
        value={value}
      />
    )
  const pitchRow = (label: string, value: number, side: 'front' | 'back') =>
    locks.pitches ? (
      <LockedRow key={label} label={label} unit="°" value={value.toFixed(0)} />
    ) : (
      <SliderControl
        key={label}
        label={label}
        max={60}
        min={1}
        onChange={(v) => apply({ kind: 'pitch', side, value: v })}
        precision={0}
        step={1}
        unit="°"
        value={Math.round(value)}
      />
    )
  const wallRow = (label: string, value: number, side: 'front' | 'back') =>
    locks.pitches && locks.ridge ? (
      <LockedRow key={label} label={label} unit="m" value={value.toFixed(2)} />
    ) : (
      <SliderControl
        key={label}
        label={label}
        max={30}
        min={-5}
        onChange={(v) => apply({ kind: 'wall', side, value: v })}
        precision={2}
        step={0.05}
        unit="m"
        value={value}
      />
    )

  return (
    <>
      <PanelSection title="Ridge">
        {ridgeRow(`To ${front} wall`, ridge.toFrontWall, (v) => ({
          kind: 'position',
          side: 'front',
          value: v,
        }))}
        {ridgeRow(`To ${back} wall`, ridge.toBackWall, (v) => ({
          kind: 'position',
          side: 'back',
          value: v,
        }))}
        {ridgeRow(`${front} height`, ridge.height, (v) => ({
          kind: 'height',
          side: 'front',
          value: v,
        }))}
        {ridgeRow(`${back} height`, ridge.backHeight, (v) => ({
          kind: 'height',
          side: 'back',
          value: v,
        }))}
        <ToggleControl
          checked={locks.ridge}
          label="Lock ridge"
          onChange={(checked) => setLocks({ ...locks, ridge: checked })}
        />
      </PanelSection>
      <PanelSection title="Slopes">
        {pitchRow(front, ridge.frontPitch, 'front')}
        {pitchRow(back, ridge.backPitch, 'back')}
        {!locks.pitches && (
          <div className="flex gap-1.5 px-1 pt-2 pb-1">
            {PITCH_PRESETS.map((preset) => (
              <ActionButton
                key={preset.label}
                label={preset.label}
                onClick={() => {
                  const next = apply({ kind: 'pitch', side: 'front', value: preset.deg })
                  apply({ kind: 'pitch', side: 'back', value: preset.deg }, next)
                }}
              />
            ))}
            <ActionButton
              label="Swap"
              onClick={() => {
                const next = apply({ kind: 'pitch', side: 'front', value: ridge.backPitch })
                apply({ kind: 'pitch', side: 'back', value: ridge.frontPitch }, next)
              }}
            />
          </div>
        )}
        <ToggleControl
          checked={locks.pitches}
          label="Lock pitches"
          onChange={(checked) => setLocks({ ...locks, pitches: checked })}
        />
      </PanelSection>
      <PanelSection title="Attic walls">
        {wallRow(`${front} wall`, ridge.frontAtticWall, 'front')}
        {wallRow(`${back} wall`, ridge.backAtticWall, 'back')}
      </PanelSection>
    </>
  )
}
