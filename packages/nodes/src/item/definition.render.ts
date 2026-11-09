import { type AnyNode, getScaledDimensions, type ItemNode as ItemNodeType } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { itemMechanism } from '../shared/item-interactions'
import { itemBatchable } from '../shared/node-batch/batchable'
import { authoredItemFaceHost } from './authored-face-host'
import { ItemNode } from './schema'

export const itemRenderDefinition: NodeRenderDefinition<typeof ItemNode> & { kind: 'item' } = {
  kind: 'item',
  schemaVersion: 2,
  schema: ItemNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  // Defaults shape is cast: the schema requires a fully-typed `asset`
  // field, but in practice items are always created from the catalog
  // (the asset is supplied at placement time). `createNode` re-parses
  // through the schema, so any missing zod defaults fill at runtime.
  defaults: () =>
    ({
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      asset: {
        id: 'placeholder',
        category: 'misc',
        name: 'Item',
        thumbnail: '',
        src: 'asset:placeholder',
        dimensions: [1, 1, 1],
        source: 'library',
      },
    }) as unknown as Omit<ItemNodeType, 'id' | 'type'>,
  capabilities: {
    reveal: { phase: 'furnishing', style: 'drop', height: 0.3 },
    revealOnEdit: ['scale'],
    batchable: itemBatchable,
    selectable: { hitVolume: 'bbox' },
    // Authored objects host ceiling items on their undersides; catalog items do not.
    faceHost: authoredItemFaceHost,
    surfaces: {
      top: {
        height: (node) => {
          const item = node as ItemNodeType
          return (item.asset.surface?.height ?? item.asset.dimensions[1]) * item.scale[1]
        },
      },
    },
    duplicable: { subtree: 'with-children' },
    deletable: true,
    mechanism: itemMechanism,
    // Items participate in compositions — e.g. "table-with-plants",
    // "shelf-with-books-on-top" — so they're presettable in their own
    // right (and as descendants of presettable parents). The GLB-kind
    // catalog still exists alongside; preset-flavoured items become
    // siblings of GLB items inside the unified `items` table.
    //
    // Items can be hosted on walls (assets with `attachTo: 'wall'`)
    // via `wallId` + `wallT`, or on a roof-segment wall face via
    // `roofSegmentId`. When a composition that includes a wall-hosted
    // item is saved as a preset (a sconce, a hanging shelf, etc.), the
    // host app strips these via `getHostRefFields(def)` so the
    // descendant re-attaches against the new host geometry at
    // placement time.
    hostRefFields: ['wallId', 'wallT', 'roofSegmentId', 'roofFace', 'blockFaceId'],
    // Floor items get lifted by slabs underneath via the generic
    // `<FloorElevationSystem>`. Wall- / ceiling-attached items live in
    // their parent's local frame and skip the lift via `applies`.
    floorPlaced: {
      footprint: (node) => {
        const item = node as ItemNodeType
        return { dimensions: getScaledDimensions(item), rotation: item.rotation }
      },
      applies: (node) => !(node as ItemNodeType).asset.attachTo,
      collides: true,
    },
    // Recessed ceiling fixtures cut a hole in their host ceiling. The viewer's
    // CeilingSystem queries this capability on each child of a ceiling so it
    // never needs to branch on `node.type`.
    ceilingCut: {
      buildCeilingHole(rawNode: AnyNode): Array<[number, number]> | null {
        const node = rawNode as ItemNodeType
        if (!node.asset.recessed || node.asset.attachTo !== 'ceiling') return null

        // Inset slightly so the fixture's trim (widest part, sitting in the
        // ceiling plane) overlaps the solid ceiling around the opening and hides
        // the cut edge. Same constant the old ceiling-system used.
        const INSET = 0.82
        const [width, , depth] = getScaledDimensions(node)
        const halfW = (width / 2) * INSET
        const halfD = (depth / 2) * INSET
        const cx = node.position[0]
        const cz = node.position[2]
        const yaw = node.rotation?.[1] ?? 0
        const cos = Math.cos(yaw)
        const sin = Math.sin(yaw)

        // Rotate the (inset) footprint corners about Y and translate to the
        // item's plan position. Y-rotation of (dx, dz): (dx·cos + dz·sin, −dx·sin + dz·cos).
        return (
          [
            [-halfW, -halfD],
            [halfW, -halfD],
            [halfW, halfD],
            [-halfW, halfD],
          ] as Array<[number, number]>
        ).map(([dx, dz]) => [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos])
      },
    },
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Same priority as the legacy ItemSystem.
    priority: 2,
  },
  presentation: {
    label: 'Item',
    description: 'A catalog-backed item (furniture, fixtures, decorations).',
    icon: { kind: 'url', src: '/icons/item.webp' },
    paletteSection: 'furnish',
    paletteOrder: 10,
  },
  mcp: {
    description:
      'A catalog-backed item with asset reference, transforms, and optional attachTo for wall/ceiling mounting.',
  },
}
