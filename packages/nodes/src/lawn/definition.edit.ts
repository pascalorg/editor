import { defaultI18n as i18n, LAWN_LIMITS, type LawnNode, type ToolOption } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { LAWN_BRUSH_EFFECTS, useLawnAuthoring } from './brush'
import { lawnFloorplanMoveTarget, lawnOutlineAffordance } from './floorplan-move'
import { lawnFloorplanDependencies } from './ground-invalidation'
import { lawnParametrics } from './parametrics'

const subscribe = (callback: () => void) => useLawnAuthoring.subscribe(callback)
const brushVisible = { subscribe, value: () => useLawnAuthoring.getState().mode === 'brush' }
const flowerVisible = {
  subscribe,
  value: () => brushVisible.value() && useLawnAuthoring.getState().effect === 'more-flowers',
}
const effects = {
  bare: i18n._({ id: 'node.lawn.effect.bare', message: 'Bare ground' }),
  grass: i18n._({ id: 'node.lawn.effect.grass', message: 'Restore grass' }),
  taller: i18n._({ id: 'node.lawn.effect.taller', message: 'Taller grass' }),
  shorter: i18n._({ id: 'node.lawn.effect.shorter', message: 'Shorter grass' }),
  'more-flowers': i18n._({ id: 'node.lawn.effect.moreFlowers', message: 'More flowers' }),
  'fewer-flowers': i18n._({ id: 'node.lawn.effect.fewerFlowers', message: 'Fewer flowers' }),
}
function numericOption(
  key: 'radiusM' | 'strength' | 'flowerDensity',
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
): ToolOption {
  return {
    id: key,
    label,
    choices: [],
    subscribe,
    input: { min, max, step, unit },
    visible:
      key === 'flowerDensity'
        ? {
            subscribe,
            value: () =>
              flowerVisible.value() && useLawnAuthoring.getState().flowerSpecies !== 'existing',
          }
        : brushVisible,
    value: () => String(useLawnAuthoring.getState()[key]),
    set: (value) => {
      const number = Number(value)
      if (Number.isFinite(number) && number >= min && number <= max)
        useLawnAuthoring.setState({ [key]: number })
    },
  }
}
const toolOptions: ToolOption[] = [
  {
    id: 'mode',
    label: i18n._({ id: 'node.lawn.tool.mode', message: 'Lawn tool' }),
    subscribe,
    value: () => useLawnAuthoring.getState().mode,
    set: (mode) => {
      if (mode === 'area' || mode === 'brush') useLawnAuthoring.setState({ mode })
    },
    choices: [
      { value: 'area', label: i18n._({ id: 'node.lawn.tool.area', message: 'Draw area' }) },
      { value: 'brush', label: i18n._({ id: 'node.lawn.tool.brush', message: 'Brush lawn' }) },
    ],
  },
  {
    id: 'effect',
    label: i18n._({ id: 'node.lawn.tool.effect', message: 'Brush effect' }),
    subscribe,
    visible: brushVisible,
    value: () => useLawnAuthoring.getState().effect,
    set: (value) => {
      const effect = LAWN_BRUSH_EFFECTS.find((effect) => effect === value)
      if (effect) useLawnAuthoring.setState({ effect })
    },
    choices: LAWN_BRUSH_EFFECTS.map((value) => ({ value, label: effects[value] })),
  },
  numericOption(
    'radiusM',
    i18n._({ id: 'node.lawn.tool.radius', message: 'Brush radius' }),
    LAWN_LIMITS.minStrokeRadius,
    LAWN_LIMITS.maxStrokeRadius,
    0.05,
    'm',
  ),
  numericOption(
    'strength',
    i18n._({ id: 'node.lawn.tool.strength', message: 'Brush strength' }),
    0,
    1,
    0.05,
  ),
  {
    id: 'flowerSpecies',
    label: i18n._({ id: 'node.lawn.tool.flowerSpecies', message: 'Flower species' }),
    subscribe,
    visible: flowerVisible,
    value: () => useLawnAuthoring.getState().flowerSpecies ?? 'existing',
    set: (flowerSpecies) => {
      if (
        flowerSpecies === 'existing' ||
        flowerSpecies === 'daisy' ||
        flowerSpecies === 'clover' ||
        flowerSpecies === 'yarrow'
      )
        useLawnAuthoring.setState({ flowerSpecies })
    },
    choices: [
      {
        value: 'existing',
        label: i18n._({ id: 'node.lawn.tool.existingMix', message: 'Keep lawn mix' }),
        description: i18n._({
          id: 'node.lawn.tool.existingMixHelp',
          message:
            'Uses this lawn’s species and density. Configure flowers in the inspector first.',
        }),
      },
      {
        value: 'daisy',
        label: i18n._({ id: 'node.lawn.flower.daisy', message: 'Daisy' }),
        description: i18n._({
          id: 'node.lawn.tool.replaceMix',
          message: 'Replaces the lawn’s flower mix with this species when the stroke is committed.',
        }),
      },
      {
        value: 'clover',
        label: i18n._({ id: 'node.lawn.flower.clover', message: 'Clover' }),
        description: i18n._({
          id: 'node.lawn.tool.replaceMix',
          message: 'Replaces the lawn’s flower mix with this species when the stroke is committed.',
        }),
      },
      {
        value: 'yarrow',
        label: i18n._({ id: 'node.lawn.flower.yarrow', message: 'Yarrow' }),
        description: i18n._({
          id: 'node.lawn.tool.replaceMix',
          message: 'Replaces the lawn’s flower mix with this species when the stroke is committed.',
        }),
      },
    ],
  },
  numericOption(
    'flowerDensity',
    i18n._({ id: 'node.lawn.parameters.flowerDensity', message: 'Flower heads per square metre' }),
    0.1,
    LAWN_LIMITS.maxFlowerDensity,
    0.1,
  ),
]

export const lawnEditContribution: NodeEditContribution<typeof LawnNode> = {
  snapProfile: 'structural',
  snapDraftDirectional: false,
  tool: () => import('./tool'),
  toolOptions,
  affordanceTools: {
    selection: () => import('./definition.edit-boundary'),
    move: () => import('./move-tool'),
  },
  floorplanMoveTarget: lawnFloorplanMoveTarget,
  floorplanDependencies: lawnFloorplanDependencies,
  floorplanAffordances: {
    'move-vertex': lawnOutlineAffordance('move-vertex'),
    'add-vertex': lawnOutlineAffordance('add-vertex'),
    'move-edge': lawnOutlineAffordance('move-edge'),
    'delete-vertex': lawnOutlineAffordance('delete-vertex'),
  },
  parametrics: lawnParametrics,
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<LawnNode>,
  },
  toolHints: [
    {
      key: i18n._({ id: 'node.lawn.tool.leftClick', message: 'Left click' }),
      label: i18n._({ id: 'node.lawn.tool.addPoint', message: 'Add an outline point' }),
      visible: { subscribe, value: () => !brushVisible.value() },
    },
    {
      key: 'Enter',
      label: i18n._({ id: 'node.lawn.tool.finish', message: 'Finish the lawn' }),
      visible: { subscribe, value: () => !brushVisible.value() },
    },
    {
      key: 'Backspace',
      label: i18n._({ id: 'node.lawn.tool.back', message: 'Take the last point back' }),
      visible: { subscribe, value: () => !brushVisible.value() },
    },
    {
      key: i18n._({ id: 'node.lawn.tool.drag', message: 'Drag' }),
      label: i18n._({ id: 'node.lawn.tool.paint', message: 'Paint one stroke' }),
      visible: brushVisible,
    },
    { key: 'Esc', label: i18n._({ id: 'node.lawn.tool.cancel', message: 'Cancel' }) },
  ],
}
