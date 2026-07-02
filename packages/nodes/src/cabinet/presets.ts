import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { MICROWAVE_STANDARD_WIDTH, newCabinetCompartment } from './stack'

export type CabinetPresetId =
  | 'base-door'
  | 'drawer-base'
  | 'open-shelf'
  | 'tall-pantry'
  | 'appliance-tower'
  | 'oven-tower'

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
    id: 'open-shelf',
    label: 'Open Shelf',
    createPatch: (run) => ({
      ...baseShared(run),
      name: 'Open Shelf Base',
      width: 0.6,
      handleStyle: 'none',
      stack: [{ ...newCabinetCompartment('shelf'), shelfCount: 2 }],
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
    id: 'appliance-tower',
    label: 'Appliance Tower',
    createPatch: (run) => ({
      cabinetType: 'tall',
      name: 'Appliance Tower',
      width: 0.7,
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
        { ...newCabinetCompartment('shelf'), height: 0.76, shelfCount: 0 },
        { ...newCabinetCompartment('door'), doorType: 'single-right', shelfCount: 2 },
      ],
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
]

export function cabinetPresetById(id: CabinetPresetId): CabinetPreset {
  return CABINET_PRESETS.find((preset) => preset.id === id) ?? CABINET_PRESETS[0]!
}
