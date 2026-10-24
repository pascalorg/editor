import type { ToolOption } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { HVAC_PRESETS } from './presets'

export const hvacEquipmentToolOptions: ToolOption[] = [
  {
    id: 'equipmentType',
    label: 'Equipment',
    choices: Object.entries(HVAC_PRESETS).map(([value, preset]) => ({
      value,
      label: preset.name,
      description: 'Generic cabinet dimensions; edit the placed unit to match your equipment.',
    })),
    subscribe: (callback) => useEditor.subscribe(callback),
    value: () =>
      String(useEditor.getState().toolDefaults['hvac-equipment']?.equipmentType ?? 'furnace'),
    set: (value) => {
      if (!(value in HVAC_PRESETS)) return
      const equipmentType = value as keyof typeof HVAC_PRESETS
      useEditor.getState().setToolDefaults('hvac-equipment', {
        ...useEditor.getState().toolDefaults['hvac-equipment'],
        ...HVAC_PRESETS[equipmentType],
        equipmentType,
      })
    },
  },
]
