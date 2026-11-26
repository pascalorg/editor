'use client'

import {
  LAWN_LIMITS,
  type LawnFlower,
  LawnNode,
  type LawnStroke,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  PanelSection,
  SelectControl,
  SliderControl,
  ToggleControl,
  ToolOptionsPanel,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

const DEFAULT_CUSTOM_FLOWER_COLOR = '#fff4dd'

export function editLawnFlowers(id: LawnNode['id'], flowers: LawnFlower[]): boolean {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'lawn') return false
  const parsed = LawnNode.safeParse({ ...node, flowers })
  if (!parsed.success) return false
  useScene.getState().updateNode(id, { flowers: parsed.data.flowers })
  return true
}

function updateLawnFlower(id: LawnNode['id'], index: number, patch: Partial<LawnFlower>) {
  const live = useScene.getState().nodes[id]
  if (live?.type === 'lawn')
    editLawnFlowers(
      id,
      live.flowers.map((flower, at) => (at === index ? { ...flower, ...patch } : flower)),
    )
}

function LawnSeasonControl({ lawn }: { lawn: LawnNode }) {
  const i18n = usePascalI18n()
  const seasons: Record<LawnNode['season'], string> = {
    spring: i18n._({ id: 'node.lawn.season.spring', message: 'Spring' }),
    summer: i18n._({ id: 'node.lawn.season.summer', message: 'Summer' }),
    autumn: i18n._({ id: 'node.lawn.season.autumn', message: 'Autumn' }),
    winter: i18n._({ id: 'node.lawn.season.winter', message: 'Winter' }),
  }
  return (
    <SelectControl
      label={i18n._({ id: 'node.lawn.parameters.season', message: 'Season' })}
      onChange={(season) => useScene.getState().updateNode(lawn.id, { season })}
      options={Object.entries(seasons).map(([value, label]) => ({
        value: value as LawnNode['season'],
        label,
      }))}
      value={lawn.season}
    />
  )
}

type FlowerControlProps = { flower: LawnFlower; update: (patch: Partial<LawnFlower>) => void }
function LawnFlowerSpeciesControl({ flower, update }: FlowerControlProps) {
  const i18n = usePascalI18n()
  const species: Record<LawnFlower['species'], string> = {
    daisy: i18n._({ id: 'node.lawn.flower.daisy', message: 'Daisy' }),
    clover: i18n._({ id: 'node.lawn.flower.clover', message: 'Clover' }),
    yarrow: i18n._({ id: 'node.lawn.flower.yarrow', message: 'Yarrow' }),
  }
  return (
    <SelectControl
      label={i18n._({ id: 'node.lawn.flowers.species', message: 'Species' })}
      onChange={(next) => update({ species: next })}
      options={Object.entries(species).map(([value, label]) => ({
        value: value as LawnFlower['species'],
        label,
      }))}
      value={flower.species}
    />
  )
}

function LawnFlowerColorControl({ flower, update }: FlowerControlProps) {
  const i18n = usePascalI18n()
  return (
    <>
      <ToggleControl
        checked={flower.color !== undefined}
        label={i18n._({ id: 'node.lawn.flowers.customColor', message: 'Custom flower color' })}
        onChange={(checked) => update({ color: checked ? DEFAULT_CUSTOM_FLOWER_COLOR : undefined })}
      />
      {flower.color && (
        <label className="flex items-center justify-between text-xs">
          {i18n._({ id: 'node.lawn.flowers.color', message: 'Flower color' })}
          <input
            className="w-24 rounded border border-border bg-background px-2 py-1"
            key={flower.color}
            type="text"
            defaultValue={flower.color}
            pattern="#[0-9a-fA-F]{6}"
            onBlur={(event) => {
              if (event.target.value !== flower.color) update({ color: event.target.value })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') event.currentTarget.value = flower.color ?? ''
            }}
          />
        </label>
      )}
    </>
  )
}

function LawnFlowerRow({
  lawn,
  flower,
  index,
}: {
  lawn: LawnNode
  flower: LawnFlower
  index: number
}) {
  const i18n = usePascalI18n()
  const update = (patch: Partial<LawnFlower>) => updateLawnFlower(lawn.id, index, patch)
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <LawnFlowerSpeciesControl flower={flower} update={update} />
      <SliderControl
        label={i18n._({ id: 'node.lawn.flowers.share', message: 'Relative share' })}
        max={100}
        min={0.01}
        onChange={(share) => update({ share })}
        precision={2}
        restoreOnCommit={false}
        step={0.1}
        value={flower.share}
      />
      <LawnFlowerColorControl flower={flower} update={update} />
      <button
        className="rounded-full border border-border px-3 py-1 text-xs"
        type="button"
        onClick={() =>
          editLawnFlowers(
            lawn.id,
            lawn.flowers.filter((_, at) => at !== index),
          )
        }
      >
        {i18n._({ id: 'node.lawn.flowers.remove', message: 'Remove species' })}
      </button>
    </fieldset>
  )
}

function useLawnEffectLabels(): Record<LawnStroke['effect'], string> {
  const i18n = usePascalI18n()
  return {
    bare: i18n._({ id: 'node.lawn.effect.bare', message: 'Bare ground' }),
    grass: i18n._({ id: 'node.lawn.effect.grass', message: 'Restore grass' }),
    taller: i18n._({ id: 'node.lawn.effect.taller', message: 'Taller grass' }),
    shorter: i18n._({ id: 'node.lawn.effect.shorter', message: 'Shorter grass' }),
    'more-flowers': i18n._({ id: 'node.lawn.effect.moreFlowers', message: 'More flowers' }),
    'fewer-flowers': i18n._({ id: 'node.lawn.effect.fewerFlowers', message: 'Fewer flowers' }),
  }
}

function LawnStrokeRow({ lawn, index, label }: { lawn: LawnNode; index: number; label: string }) {
  const i18n = usePascalI18n()
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span>
        {index + 1}. {label}
      </span>
      <button
        className="rounded-full border border-border px-3 py-1 text-xs"
        type="button"
        onClick={() => {
          const live = useScene.getState().nodes[lawn.id]
          if (live?.type !== 'lawn' || live.strokes !== lawn.strokes) return
          useScene
            .getState()
            .updateNode(lawn.id, { strokes: live.strokes.filter((_, at) => at !== index) })
        }}
      >
        {i18n._({ id: 'node.lawn.strokes.remove', message: 'Remove stroke' })}
      </button>
    </li>
  )
}

function LawnStrokesPanel({ lawn }: { lawn: LawnNode }) {
  const i18n = usePascalI18n()
  const effects = useLawnEffectLabels()
  return (
    <PanelSection title={i18n._({ id: 'node.lawn.strokes.title', message: 'Brush strokes' })}>
      <ToolOptionsPanel
        className="mb-3"
        kind="lawn"
        onSelect={() => {
          const selection = useViewer.getState().selection
          useEditor.getState().setTool('lawn')
          // Keep the lawn's inspector available while its existing tool is armed.
          useViewer.getState().setSelection(selection)
        }}
      />
      <ol className="space-y-2">
        {lawn.strokes.map((stroke, index) => (
          <LawnStrokeRow
            key={`${lawn.id}-stroke-${index}`}
            lawn={lawn}
            index={index}
            label={effects[stroke.effect]}
          />
        ))}
      </ol>
    </PanelSection>
  )
}

export default function LawnFlowersPanel({ node }: { node: LawnNode }) {
  const i18n = usePascalI18n()
  const current = useScene((state) => state.nodes[node.id])
  const lawn = current?.type === 'lawn' ? current : node
  return (
    <>
      <PanelSection title={i18n._({ id: 'node.lawn.flowers.mix', message: 'Flower mix' })}>
        <p className="mb-3 text-xs text-muted-foreground">
          {i18n._({
            id: 'node.lawn.flowers.help',
            message:
              'Choose up to three species and a positive flower density. Flowers are off until you choose them; winter has no blooms.',
          })}
        </p>
        <div className="space-y-3">
          <LawnSeasonControl lawn={lawn} />
          {lawn.flowers.map((flower, index) => (
            <LawnFlowerRow key={`${lawn.id}-${index}`} lawn={lawn} flower={flower} index={index} />
          ))}
          <button
            className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40"
            type="button"
            disabled={lawn.flowers.length >= LAWN_LIMITS.maxSpecies}
            onClick={() =>
              editLawnFlowers(lawn.id, [...lawn.flowers, { species: 'daisy', share: 1 }])
            }
          >
            {i18n._({ id: 'node.lawn.flowers.add', message: 'Add flower species' })}
          </button>
        </div>
      </PanelSection>
      <LawnStrokesPanel lawn={lawn} />
    </>
  )
}
