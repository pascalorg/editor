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
