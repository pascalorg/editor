import {
  type AnyNode,
  type FloorplanGeometry,
  getEffectiveNode,
  proceduralItemSlots,
} from '@pascal-app/core'

import {
  evaluateRecipe,
  ProceduralItemNode,
  proceduralCeilingHole,
  proceduralFootprint,
  proceduralSlotColor,
  queryProceduralItem,
  shelfRecipe,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import type { NodeRenderDefinition } from '../definition-contributions'
import { proceduralMechanism } from '../shared/item-interactions'
import { bakeProceduralAnimationClips, isProceduralMotionPlaying } from './animation'

export const proceduralItemRenderDefinition: NodeRenderDefinition<typeof ProceduralItemNode> & {
  kind: 'procedural-item'
} = {
  kind: 'procedural-item',
  schemaVersion: 1,
  schema: ProceduralItemNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    recipe: shelfRecipe,
    parameters: {},
    slots: {},
    children: [],
    attachments: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),
  capabilities: {
    reveal: { phase: 'furnishing', style: 'drop', height: 0.3 },
    revealOnEdit: ['recipe'],
    batchable: {
      scope: 'level',
      // Part lights clone their emissive slot per node, and a playing motion
      // moves meshes under the static copy.
      excluded: (n) =>
        (n as unknown as ProceduralItemNode).recipe.parts.some((part) => part.light) ||
        isProceduralMotionPlaying(n.id),
    },
    selectable: { hitVolume: 'bbox' },
    mechanism: proceduralMechanism,
    dragBounds: (n) => {
      const node = n as unknown as ProceduralItemNode
      const e = evaluateRecipe(node.recipe, node.parameters)
      return {
        size: e.dimensions,
        center: e.min.map((v, i) => (v + e.max[i]!) / 2) as [number, number, number],
      }
    },
    hostable: {
      parents: ['level', 'wall', 'ceiling', 'procedural-item', 'item', 'shelf'],
      align: 'face',
    },
    hostRefFields: ['wallId', 'side', 'supportSlabId'],
    ceilingCut: {
      buildCeilingHole: (n) => {
        const node = getEffectiveNode(n as unknown as ProceduralItemNode)
        return node.visible === false ? null : proceduralCeilingHole(node)
      },
    },
    floorPlaced: {
      footprint: (n) => proceduralFootprint(n as unknown as ProceduralItemNode),
      applies: (n) => !(n as unknown as ProceduralItemNode).recipe.mounting,
      collides: true,
    },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 4, Math.PI / 2, Math.PI] },
    duplicable: { subtree: 'with-children' },
    deletable: true,
    slots: (n) => proceduralItemSlots(n as unknown as ProceduralItemNode),
    surfaces: {
      custom: (n) =>
        evaluateRecipe(
          (n as unknown as ProceduralItemNode).recipe,
          (n as unknown as ProceduralItemNode).parameters,
        ).surfaces.map((s) => ({
          id: s.id,
          position: s.position,
          normal: s.normal,
          rotation: s.rotation,
          size: s.size,
        })),
    },
  },
  relations: { hosts: ['item', 'procedural-item'], cascadeDelete: 'descendants' },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  exportAnimation: ({ node, object }) => bakeProceduralAnimationClips(node, object),
  floorplan: (node, ctx) => {
    const chain: Record<string, AnyNode | ProceduralItemNode> = { [node.id]: node }
    let current = node.parentId,
      depth = 0
    while (current && depth++ < 32) {
      const parent = ctx.resolve(current as never)
      if (!parent) break
      chain[current] = parent
      current = parent.parentId
    }
    const q = queryProceduralItem(node, chain),
      b = q.levelBounds
    const floorPlanUrl = node.metadata.floorPlanUrl
    if (typeof floorPlanUrl === 'string' && floorPlanUrl.trim()) {
      const local = q.localBounds
      const center = transformPoint(
        q.frame,
        local.min.map((v, i) => (v + local.max[i]!) / 2) as [number, number, number],
      )
      const points = [
        [local.min[0], local.min[2]],
        [local.max[0], local.min[2]],
        [local.max[0], local.max[2]],
        [local.min[0], local.max[2]],
      ].map(([x, z]) => {
        const point = transformPoint(q.frame, [x!, 0, z!])
        return [point[0], point[2]] as [number, number]
      })
      const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
      const stroke = selected ? (ctx.viewState?.palette?.selectedStroke ?? '#3b82f6') : '#92400e'
      const strokeWidth = selected ? 0.035 : 0.012
      const children: FloorplanGeometry[] = [
        { kind: 'polygon', points, fill: 'transparent', stroke, strokeWidth, opacity: 0.85 },
        {
          kind: 'image',
          url: floorPlanUrl,
          center: [center[0], center[2]],
          width: local.dimensions[0],
          height: local.dimensions[2],
          rotation: Math.atan2(q.frame.axes[0][2], q.frame.axes[0][0]),
        },
      ]
      if (selected) children.push({ kind: 'polygon', points, fill: 'none', stroke, strokeWidth })
      return { kind: 'group', children }
    }
    return {
      kind: 'rect',
      x: b.min[0],
      y: b.min[2],
      width: b.dimensions[0],
      height: b.dimensions[2],
      fill: proceduralSlotColor(
        node.slots[node.recipe.slots[0]!.id],
        node.recipe.slots[0]!.color,
        ctx.materials ?? {},
      ),
      stroke: '#44403c',
      strokeWidth: 0.01,
    }
  },
  presentation: {
    label: 'Procedural item',
    description: 'Experimental editable recipe',
    icon: { kind: 'iconify', name: 'lucide:boxes' },
  },
  mcp: { description: 'Experimental procedural item with a validated recipe.' },
}
