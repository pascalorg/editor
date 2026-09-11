import type { AnyNode, HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import {
  evaluateRecipe,
  ProceduralItemNode,
  parameterPatch,
  shelfRecipe,
} from '@pascal-app/core/procedural-items'
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
    movable: { axes: ['x', 'z'], gridSnap: true },
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
        ).surfaces.map((s) => ({ position: s.position, normal: [0, 1, 0] as const })),
    },
    paint: {
      resolveRole: ({ hitObject }) =>
        typeof hitObject?.userData?.slotId === 'string' ? hitObject.userData.slotId : null,
      buildPatch: ({ node, role, material }) => {
        const n = node as unknown as ProceduralItemNode
        return {
          slots: {
            ...n.slots,
            [role]:
              material?.properties?.color ??
              n.recipe.slots.find((s) => s.id === role)?.color ??
              '#ffffff',
          },
        } as Partial<AnyNode>
      },
      applyPreview: () => null,
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
        apply: (n, v) => parameterPatch(n, p.id, Math.min(p.max, Math.max(p.min, v))) ?? {},
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
  floorplan: (node) => {
    const e = evaluateRecipe(node.recipe, node.parameters)
    return {
      kind: 'group',
      transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation[1] },
      children: e.shapes.map((s) => ({
        kind: 'group' as const,
        transform: {
          translate: [s.position[0], s.position[2]] as [number, number],
          rotate: -s.rotation[1],
        },
        children: [
          {
            kind: 'rect' as const,
            x: -s.size[0] / 2,
            y: -s.size[2] / 2,
            width: s.size[0],
            height: s.size[2],
            fill: node.slots[s.slot] ?? node.recipe.slots.find((slot) => slot.id === s.slot)!.color,
            stroke: '#44403c',
            strokeWidth: 0.01,
          },
        ],
      })),
    }
  },
  presentation: {
    label: 'Procedural item',
    description: 'Experimental editable recipe',
    icon: { kind: 'iconify', name: 'lucide:boxes' },
  },
  mcp: { description: 'Experimental procedural item with a validated recipe.' },
}
