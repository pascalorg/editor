import { DrawingSheetNode as DrawingSheetNodeSchema, type NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { DrawingSheetNode } from './schema'

export const drawingSheetDefinition: NodeDefinition<typeof DrawingSheetNode> = {
  kind: 'drawing-sheet',
  bake: 'strip',
  schemaVersion: 4,
  schema: DrawingSheetNode,
  category: 'analysis',
  extensions: {
    'pascal:editor/floorplan': {
      resolveDrawingSheet: ({ node, levelId, drawingType }) =>
        node.placedViews.some(
          (view) =>
            (view.levelId === null || view.levelId === levelId) && view.drawingType === drawingType,
        )
          ? node
          : null,
    } satisfies FloorplanNodeExtension<DrawingSheetNodeSchema>,
  },

  defaults: () => {
    const stub = DrawingSheetNodeSchema.parse({
      id: 'drawing-sheet_default' as never,
      type: 'drawing-sheet',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    deletable: true,
    duplicable: true,
    presettable: false,
  },

  dirtyTracking: false,

  presentation: {
    label: 'Drawing Sheet',
    description: 'A persistent construction-document sheet with placed views and title-block data.',
    icon: { kind: 'iconify', name: 'lucide:file-text' },
    hidden: true,
  },

  mcp: {
    description:
      'A persistent construction-document sheet containing paper setup, placed drawing views, notes, schedules, and title-block metadata.',
  },
}
