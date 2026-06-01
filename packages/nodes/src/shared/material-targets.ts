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
