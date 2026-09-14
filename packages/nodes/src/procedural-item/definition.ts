import type { AnyNode, HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import {
  evaluateRecipe,
  ProceduralItemNode,
  parameterPatch,
  proceduralFootprint,
  proceduralSlotColor,
  queryProceduralItem,
  setProceduralMaterial,
  shelfRecipe,
  snapParameters,
  validateProceduralRelations,
} from '@pascal-app/core/procedural-items'
import { itemPaint } from '../item/paint'
export const proceduralItemDefinition: NodeDefinition<typeof ProceduralItemNode> = {
  kind: 'procedural-item',
  schemaVersion: 1,
  schema: ProceduralItemNode,
  category: 'furnish',
  snapProfile: 'item',
  surfaceRole: 'furnishing',
  dirtyTracking: false,
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
    selectable: { hitVolume: 'bbox' },
    dragBounds: (n) => {
      const node = n as unknown as ProceduralItemNode
      const e = evaluateRecipe(node.recipe, node.parameters)
      return {
        size: e.dimensions,
        center: e.min.map((v, i) => (v + e.max[i]!) / 2) as [number, number, number],
      }
    },
    hostable: { parents: ['level', 'wall', 'procedural-item'], align: 'face' },
    hostRefFields: ['wallId', 'side', 'supportSlabId'],
    floorPlaced: {
      footprint: (n) => proceduralFootprint(n as unknown as ProceduralItemNode),
      applies: (n) => !(n as unknown as ProceduralItemNode).wallId,
      collides: true,
    },
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      override: ({ node }) =>
        (node as unknown as ProceduralItemNode).wallId
          ? { axes: [], gridSnap: false }
          : { axes: ['x', 'z'], gridSnap: true },
    },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 4, Math.PI / 2, Math.PI] },
    duplicable: true,
    deletable: true,
    slots: (n) => {
      const node = n as unknown as ProceduralItemNode
      return node.recipe.slots.map((s) => ({ slotId: s.id, label: s.label, default: s.color }))
    },
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
    paint: {
      ...itemPaint,
      commit: ({ node, role, material, materialPreset }) =>
        setProceduralMaterial(node.id, role, materialPreset, material),
    },
  },
  relations: { hosts: ['item', 'procedural-item'], cascadeDelete: 'descendants' },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  parametrics: { groups: [], customPanel: () => import('@pascal-app/editor/procedural-items') },
  handles: (node) => {
    const result: HandleDescriptor<ProceduralItemNode>[] = []
    for (const p of node.recipe.parameters) {
      if (!p.axis) continue
      const axis = p.axis,
        index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      result.push({
        kind: 'linear-resize',
        axis,
        anchor: axis === 'y' ? 'min' : 'center',
        min: p.min,
        max: p.max,
        currentValue: (n) => n.parameters[p.id] ?? p.default,
        apply: (n, v, scene) => {
          const patch = parameterPatch(n, p.id, Math.min(p.max, Math.max(p.min, v)))
          if (!patch) return {}
          try {
            validateProceduralRelations({ ...n, ...patch }, scene.nodes())
            validateProceduralRelations(
              { ...n, parameters: snapParameters(n.recipe, patch.parameters) },
              scene.nodes(),
            )
            return patch
          } catch {
            return {}
          }
        },
        commit: (n, patch, scene) => {
          const parameters = snapParameters(n.recipe, patch.parameters ?? n.parameters)
          validateProceduralRelations({ ...n, parameters }, scene.nodes())
          scene.update(n.id as never, { parameters } as never)
        },
        placement: {
          position: (n) => {
            const e = evaluateRecipe(n.recipe, n.parameters)
            const pos = e.max.map((v, i) => (i === index ? v + 0.15 : (e.min[i]! + v) / 2)) as [
              number,
              number,
              number,
            ]
            return pos
          },
        },
      })
    }
    return result
  },
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
