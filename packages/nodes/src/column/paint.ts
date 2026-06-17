import type { AnyNode } from '@pascal-app/core'
import { createSlotPaintCapability, previewSlotByUserData } from '../shared/slot-paint'
import type { ColumnNode } from './schema'

export const columnPaint = createSlotPaintCapability({
  resolveRole: (args) => {
    const slotId = args.hitObject?.userData?.slotId
    return typeof slotId === 'string' ? slotId : null
  },
  applyPreview: previewSlotByUserData,
  legacyEffective: (node: AnyNode) => {
    const column = node as ColumnNode
    if (column.materialPreset || column.material) {
      return { material: column.material, materialPreset: column.materialPreset }
    }
    return null
  },
})
