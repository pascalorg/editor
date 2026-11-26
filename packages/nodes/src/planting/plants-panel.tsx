'use client'

import {
  PLANTING_LIMITS,
  PlantingNode,
  PlantingSpecies,
  useLiveNodeOverrides,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { PanelSection, SelectControl, SliderControl, ToggleControl } from '@pascal-app/editor'
import { useCallback } from 'react'

type Species = PlantingNode['plants'][number]
type NumberField = 'height' | 'spread' | 'spacing' | 'share'
const DEFAULT_FLOWER_COLOR = '#8062bf'

/** Validate the whole list before one write; a refused edit leaves the bed as it was. */
export function editPlantingPlants(
  id: PlantingNode['id'],
  edit: (plants: Species[]) => Species[],
): boolean {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'planting') return false
  const parsed = PlantingNode.safeParse({
    ...node,
    plants: edit(node.plants.map((plant) => ({ ...plant }))),
  })
  if (!parsed.success) return false
  useScene.getState().updateNode(id, { plants: parsed.data.plants })
  return true
}

function SpeciesNumber({
  id,
  index,
  field,
  value,
  min,
  max,
}: {
  id: PlantingNode['id']
  index: number
  field: NumberField
  value: number
  min: number
  max: number
}) {
  const i18n = usePascalI18n()
  const clear = useCallback(() => {
    useLiveNodeOverrides.getState().clear(id)
    useScene.getState().markDirty(id)
  }, [id])
  const labels: Record<NumberField, string> = {
    height: i18n._({ id: 'node.planting.plants.height', message: 'Height' }),
    spread: i18n._({ id: 'node.planting.plants.spread', message: 'Spread' }),
    spacing: i18n._({ id: 'node.planting.plants.spacing', message: 'Spacing' }),
    share: i18n._({ id: 'node.planting.plants.share', message: 'Relative share' }),
  }
  const preview = useCallback(
    (next: number) => {
      const node = useScene.getState().nodes[id]
      if (node?.type !== 'planting') return
      const plants = node.plants.map((plant, at) =>
        at === index ? { ...plant, [field]: next } : plant,
      )
      useLiveNodeOverrides.getState().set(id, { plants })
      useScene.getState().markDirty(id)
    },
    [id, index, field],
  )
  const commit = useCallback(
    (next: number) => {
      editPlantingPlants(id, (plants) =>
        plants.map((plant, at) => (at === index ? { ...plant, [field]: next } : plant)),
      )
      clear()
    },
    [id, index, field, clear],
  )
  return (
    <SliderControl
      label={labels[field]}
      max={max}
      min={min}
      onCancel={clear}
      onChange={preview}
      onCommit={commit}
      precision={2}
      restoreOnCommit={false}
      step={0.01}
      unit={field === 'share' ? '' : 'm'}
      value={value}
    />
  )
}

function SpeciesRow({ node, plant, index }: { node: PlantingNode; plant: Species; index: number }) {
  const i18n = usePascalI18n()
  const update = (patch: Partial<Species>) =>
    editPlantingPlants(node.id, (plants) =>
      plants.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    )
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium">
        {i18n._({
          id: 'node.planting.plants.plant',
          message: 'Plant {number}',
          values: { number: index + 1 },
        })}
      </legend>
      <SelectControl
        label={i18n._({ id: 'node.planting.plants.habit', message: 'Habit' })}
        onChange={(habit) => update({ habit })}
        options={[
          {
            value: 'mound',
            label: i18n._({ id: 'node.planting.plants.habit.mound', message: 'Mound' }),
          },
          {
            value: 'ball',
            label: i18n._({ id: 'node.planting.plants.habit.ball', message: 'Ball' }),
          },
          {
            value: 'spike',
            label: i18n._({ id: 'node.planting.plants.habit.spike', message: 'Spike' }),
          },
          {
            value: 'tuft',
            label: i18n._({ id: 'node.planting.plants.habit.tuft', message: 'Tuft' }),
          },
          {
            value: 'carpet',
            label: i18n._({ id: 'node.planting.plants.habit.carpet', message: 'Carpet' }),
          },
        ]}
        value={plant.habit}
      />
      <SelectControl
        label={i18n._({ id: 'node.planting.plants.layer', message: 'Layer' })}
        onChange={(layer) => update({ layer })}
        options={[
          {
            value: 'back',
            label: i18n._({ id: 'node.planting.plants.layer.back', message: 'Back' }),
          },
          {
            value: 'mid',
            label: i18n._({ id: 'node.planting.plants.layer.mid', message: 'Middle' }),
          },
          {
            value: 'edge',
            label: i18n._({ id: 'node.planting.plants.layer.edge', message: 'Edge' }),
          },
        ]}
        value={plant.layer}
      />
      <SpeciesNumber
        field="height"
        id={node.id}
        index={index}
        max={PLANTING_LIMITS.maxHeight}
        min={PLANTING_LIMITS.minHeight}
        value={plant.height}
      />
      <SpeciesNumber
        field="spread"
        id={node.id}
        index={index}
        max={PLANTING_LIMITS.maxSpread}
        min={PLANTING_LIMITS.minSpread}
        value={plant.spread}
      />
      <SpeciesNumber
        field="spacing"
        id={node.id}
        index={index}
        max={PLANTING_LIMITS.maxSpacing}
        min={PLANTING_LIMITS.minSpacing}
        value={plant.spacing}
      />
      <SpeciesNumber
        field="share"
        id={node.id}
        index={index}
        max={100}
        min={0.01}
        value={plant.share}
      />
      <label className="flex items-center justify-between text-xs">
        {i18n._({ id: 'node.planting.plants.leafColour', message: 'Leaf color' })}
        <input
          onChange={(event) => update({ leafColor: event.target.value })}
          type="color"
          value={plant.leafColor}
        />
      </label>
      <ToggleControl
        checked={plant.flowerColor !== undefined}
        label={i18n._({ id: 'node.planting.plants.flowers', message: 'Flowers' })}
        onChange={(checked) => update({ flowerColor: checked ? DEFAULT_FLOWER_COLOR : undefined })}
      />
      {plant.flowerColor && (
        <label className="flex items-center justify-between text-xs">
          {i18n._({ id: 'node.planting.plants.flowerColour', message: 'Flower color' })}
          <input
            onChange={(event) => update({ flowerColor: event.target.value })}
            type="color"
            value={plant.flowerColor}
          />
        </label>
      )}
      <button
        className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40"
        disabled={node.plants.length <= 1}
        onClick={() =>
          editPlantingPlants(node.id, (plants) => plants.filter((_, at) => at !== index))
        }
        type="button"
      >
        {i18n._({ id: 'node.planting.plants.remove', message: 'Remove plant' })}
      </button>
    </fieldset>
  )
}

export default function PlantingPlantsPanel({ node }: { node: PlantingNode }) {
  const i18n = usePascalI18n()
  const current = useScene((state) => state.nodes[node.id])
  const planting = current?.type === 'planting' ? current : node
  return (
    <PanelSection title={i18n._({ id: 'node.planting.plants.title', message: 'Plants' })}>
      <p className="mb-3 text-xs text-muted-foreground">
        {i18n._({
          id: 'node.planting.plants.help',
          message:
            'One to eight plant types. Back is away from the seen side (+Z); edge is nearest it. Spread is the mature width; spacing and relative share control the mix.',
        })}
      </p>
      <div className="space-y-3">
        {planting.plants.map((plant, index) => (
          <SpeciesRow index={index} key={`${planting.id}-${index}`} node={planting} plant={plant} />
        ))}
        <button
          className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-40"
          disabled={planting.plants.length >= PLANTING_LIMITS.maxSpecies}
          onClick={() =>
            editPlantingPlants(planting.id, (plants) => [...plants, PlantingSpecies.parse({})])
          }
          type="button"
        >
          {i18n._({ id: 'node.planting.plants.add', message: 'Add plant' })}
        </button>
      </div>
    </PanelSection>
  )
}
