import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import {
  COOKTOP_STANDARD_WIDTH,
  cooktopCabinetStack,
  DISHWASHER_STANDARD_HEIGHT,
  DISHWASHER_STANDARD_WIDTH,
  FRIDGE_COLUMN_WIDTH,
  fridgeCabinetStack,
  MICROWAVE_STANDARD_WIDTH,
  newCabinetCompartment,
  TALL_CABINET_CARCASS_HEIGHT,
} from './stack'

export type CabinetPresetId =
  | 'base-door'
  | 'drawer-base'
  | 'dishwasher'
  | 'cooktop-gas'
  | 'cooktop-induction'
  | 'tall-pantry'
  | 'oven-tower'
  | 'fridge-single'

export type CabinetPreset = {
  id: CabinetPresetId
  label: string
  createPatch: (run?: CabinetNode) => Partial<CabinetModuleNode>
}

const baseShared = (run?: CabinetNode): Partial<CabinetModuleNode> => ({
  cabinetType: 'base',
  depth: run?.depth ?? 0.58,
  carcassHeight: run?.carcassHeight ?? 0.72,
  plinthHeight: run?.plinthHeight ?? 0.1,
  toeKickDepth: run?.toeKickDepth ?? 0.075,
  countertopThickness: 0,
  countertopOverhang: run?.countertopOverhang ?? 0.02,
  showPlinth: false,
  withCountertop: false,
})

const runDepth = (run?: CabinetNode) => run?.depth ?? 0.58

export const CABINET_PRESETS: CabinetPreset[] = [
  {
    id: 'base-door',
    label: 'Base',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Base Cabinet',
      width: 0.6,
      handleStyle: 'bar',
      handlePosition: 'auto',
      frontOverlay: 'inset',
      stack: [
        { ...newCabinetCompartment('drawer'), height: 0.44, drawerCount: 3 },
        { ...newCabinetCompartment('door'), doorType: 'double', shelfCount: 2 },
      ],
    }),
  },
  {
    id: 'drawer-base',
    label: 'Drawer Base',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Drawer Base',
      width: 0.6,
      handleStyle: 'bar',
      handlePosition: 'top',
      frontOverlay: 'full',
      stack: [{ ...newCabinetCompartment('drawer'), drawerCount: 3 }],
    }),
  },
  {
    id: 'dishwasher',
    label: 'Dishwasher',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Dishwasher',
      width: DISHWASHER_STANDARD_WIDTH,
      carcassHeight: DISHWASHER_STANDARD_HEIGHT,
      handleStyle: 'bar',
      handlePosition: 'top',
      frontOverlay: 'full',
      stack: [{ ...newCabinetCompartment('dishwasher'), height: DISHWASHER_STANDARD_HEIGHT }],
    }),
  },
  {
    id: 'cooktop-gas',
    label: 'Gas Hob',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Gas Hob Base',
      width: COOKTOP_STANDARD_WIDTH,
      handleStyle: 'bar',
      handlePosition: 'top',
      frontOverlay: 'full',
      stack: cooktopCabinetStack('cooktop-gas'),
    }),
  },
  {
    id: 'cooktop-induction',
    label: 'Induction',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Induction Base',
      width: COOKTOP_STANDARD_WIDTH,
      handleStyle: 'bar',
      handlePosition: 'top',
      frontOverlay: 'full',
      stack: cooktopCabinetStack('cooktop-induction'),
    }),
  },
  {
    id: 'tall-pantry',
    label: 'Tall Pantry',
    createPatch: (run) => ({
      cabinetType: 'tall',
      name: 'Tall Pantry',
      width: 0.6,
      depth: run?.depth ?? 0.58,
      carcassHeight: 2.07,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
      countertopThickness: 0,
      countertopOverhang: run?.countertopOverhang ?? 0.02,
      showPlinth: false,
      withCountertop: false,
      handleStyle: 'bar',
      handlePosition: 'auto',
      frontOverlay: 'full',
      stack: [{ ...newCabinetCompartment('door'), doorType: 'double', shelfCount: 4 }],
    }),
  },
  {
    id: 'oven-tower',
    label: 'Oven Tower',
    createPatch: (run) => ({
      cabinetType: 'tall',
      name: 'Oven Tower',
      width: MICROWAVE_STANDARD_WIDTH,
      depth: run?.depth ?? 0.58,
      carcassHeight: 2.07,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
      countertopThickness: 0,
      countertopOverhang: run?.countertopOverhang ?? 0.02,
      showPlinth: false,
      withCountertop: false,
      handleStyle: 'bar',
      handlePosition: 'top',
      frontOverlay: 'full',
      stack: [
        { ...newCabinetCompartment('drawer'), height: 0.42, drawerCount: 2 },
        newCabinetCompartment('oven'),
        newCabinetCompartment('microwave'),
        { ...newCabinetCompartment('door'), doorType: 'double', shelfCount: 2 },
      ],
    }),
  },
  {
    id: 'fridge-single',
    label: 'Single Fridge',
    createPatch: (run) => ({
      cabinetType: 'tall',
      name: 'Single Door Refrigerator',
      width: FRIDGE_COLUMN_WIDTH,
      depth: runDepth(run),
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
      countertopThickness: 0,
      countertopOverhang: run?.countertopOverhang ?? 0.02,
      showPlinth: false,
      withCountertop: false,
      handleStyle: 'bar',
      handlePosition: 'center',
      frontOverlay: 'full',
      stack: fridgeCabinetStack('fridge-single'),
    }),
  },
]

export function cabinetPresetById(id: CabinetPresetId): CabinetPreset {
  return CABINET_PRESETS.find((preset) => preset.id === id) ?? CABINET_PRESETS[0]!
}
