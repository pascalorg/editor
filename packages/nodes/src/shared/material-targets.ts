import type { MaterialTargetDescriptor } from '@pascal-app/core'

export const overallMaterialTarget = [
  {
    key: 'surface',
    label: 'Overall',
    kind: 'whole',
    materialKey: 'material',
    materialPresetKey: 'materialPreset',
  },
] as const satisfies readonly MaterialTargetDescriptor[]

export const wallSurfaceMaterialTargets = [
  {
    key: 'interior',
    label: 'Interior',
    kind: 'face',
    materialKey: 'interiorMaterial',
    materialPresetKey: 'interiorMaterialPreset',
  },
  {
    key: 'exterior',
    label: 'Exterior',
    kind: 'face',
    materialKey: 'exteriorMaterial',
    materialPresetKey: 'exteriorMaterialPreset',
  },
] as const satisfies readonly MaterialTargetDescriptor[]

export const roofSurfaceMaterialTargets = [
  {
    key: 'top',
    label: 'Top',
    kind: 'face',
    materialKey: 'topMaterial',
    materialPresetKey: 'topMaterialPreset',
  },
  {
    key: 'edge',
    label: 'Edge',
    kind: 'face',
    materialKey: 'edgeMaterial',
    materialPresetKey: 'edgeMaterialPreset',
  },
  {
    key: 'wall',
    label: 'Wall',
    kind: 'face',
    materialKey: 'wallMaterial',
    materialPresetKey: 'wallMaterialPreset',
  },
] as const satisfies readonly MaterialTargetDescriptor[]

export const stairSurfaceMaterialTargets = [
  {
    key: 'tread',
    label: 'Tread',
    kind: 'part',
    materialKey: 'treadMaterial',
    materialPresetKey: 'treadMaterialPreset',
  },
  {
    key: 'side',
    label: 'Side',
    kind: 'part',
    materialKey: 'sideMaterial',
    materialPresetKey: 'sideMaterialPreset',
  },
  {
    key: 'railing',
    label: 'Railing',
    kind: 'part',
    materialKey: 'railingMaterial',
    materialPresetKey: 'railingMaterialPreset',
  },
] as const satisfies readonly MaterialTargetDescriptor[]
