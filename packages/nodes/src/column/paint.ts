import type { AnyNode } from '@pascal-app/core'
import type { Object3D } from 'three'
import {
  createSlotPaintCapability,
  declaredSlotLook,
  previewSlotByUserData,
} from '../shared/slot-paint'
import type { ColumnNode } from './schema'

export const columnPaint = createSlotPaintCapability({
  resolveRole: (args) => {
    const slotId = args.hitObject?.userData?.slotId
    return typeof slotId === 'string' ? slotId : null
  },
  applyPreview: (args) => {
    // Hosted children can have identical slot names; preview only our own body.
    const body = (args.root as Object3D).children.find((child) => child.name === 'column-body')
    return body ? previewSlotByUserData({ ...args, root: body }) : null
  },
  erasedLook: ({ node, role }) => {
    const column = node as ColumnNode
    return column.materialPreset || column.material
      ? { material: column.material, materialPreset: column.materialPreset }
      : declaredSlotLook(node, role)
  },
  legacyEffective: (node: AnyNode) => {
    const column = node as ColumnNode
    if (column.materialPreset || column.material) {
      return { material: column.material, materialPreset: column.materialPreset }
    }
    return null
  },
})
