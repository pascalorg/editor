import type { AnyNode, FloorplanGeometry, HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  boundsOf,
  boxCorners,
  evaluateRecipe,
  frame,
  ProceduralItemNode,
  parameterPatch,
  proceduralFootprint,
  proceduralSlotColor,
  queryProceduralItem,
  resolveProceduralWallPlacement,
  setProceduralMaterial,
  shelfRecipe,
  snapParameters,
  transformPoint,
  validateProceduralRelations,
} from '@pascal-app/core/procedural-items'
import { itemPaint } from '../item/paint'
import { restingFloorplanAffectedIds } from '../shared/resting-surface-plan'
import { proceduralFloorplanMoveTarget } from './move-session'

const GIZMO_SIDE_OFFSET = 0.3
const GIZMO_FRONT_OFFSET = 0.3
const ROTATE_RING_OFFSET = 0.06

function handleBounds(node: ProceduralItemNode, part?: string) {
  const e = evaluateRecipe(node.recipe, node.parameters)
  const shapes = part ? e.shapes.filter((shape) => shape.partId === part) : []
  return shapes.length
    ? boundsOf(
        shapes.flatMap((shape) =>
          boxCorners(
            shape.size.map((v) => -v / 2) as [number, number, number],
            shape.size.map((v) => v / 2) as [number, number, number],
          ).map((point) => transformPoint(frame(shape.position, shape.rotation), point)),
        ),
      )
    : e
}

function proceduralRotateHandle(): HandleDescriptor<ProceduralItemNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => {
      const [rx, ry, rz] = initial.rotation
      return { rotation: [rx, ry - delta, rz] }
    },
    placement: {
      position: (n) => {
        const b = evaluateRecipe(n.recipe, n.parameters)
        return [
          b.max[0] + GIZMO_SIDE_OFFSET,
          (b.min[1] + b.max[1]) / 2,
          b.max[2] + GIZMO_FRONT_OFFSET,
        ]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      center: (n) => {
        const b = evaluateRecipe(n.recipe, n.parameters)
        return b.min.map((v, i) => (v + b.max[i]!) / 2) as [number, number, number]
      },
      radius: (n) => {
        const b = evaluateRecipe(n.recipe, n.parameters)
        return Math.hypot(b.dimensions[0] / 2, b.dimensions[2] / 2) + ROTATE_RING_OFFSET
      },
      y: (n) => {
        const b = evaluateRecipe(n.recipe, n.parameters)
        return (b.min[1] + b.max[1]) / 2
      },
    },
  }
}

export const proceduralItemDefinition: NodeDefinition<typeof ProceduralItemNode> = {
  kind: 'procedural-item',
  schemaVersion: 1,
  schema: ProceduralItemNode,
  category: 'furnish',
  snapProfile: 'item',
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
  extensions: { 'pascal:editor/floorplan': { directDrag: true } },
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
    hostable: {
      parents: ['level', 'wall', 'ceiling', 'procedural-item', 'item', 'shelf'],
      align: 'face',
    },
    hostRefFields: ['wallId', 'side', 'supportSlabId'],
    floorPlaced: {
      footprint: (n) => proceduralFootprint(n as unknown as ProceduralItemNode),
      applies: (n) => !(n as unknown as ProceduralItemNode).recipe.mounting,
      collides: true,
    },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 4, Math.PI / 2, Math.PI] },
    duplicable: { subtree: 'with-children' },
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
  affordanceTools: { move: () => import('./move-tool') },
  floorplanMoveTarget: proceduralFloorplanMoveTarget,
  floorplanAffectedIds: restingFloorplanAffectedIds,
  keyboardActions: {
    r: {
      appliesTo: (n) => Boolean((n as unknown as ProceduralItemNode).wallId),
      run: (n) => {
        const node = n as unknown as ProceduralItemNode
        const nodes = useScene.getState().nodes
        const wall = nodes[node.wallId as AnyNodeId]
        if (wall?.type !== 'wall') return
        const next = resolveProceduralWallPlacement(
          node,
          wall,
          node.position[0],
          node.position[1],
          node.side === 'back' ? 'front' : 'back',
          nodes,
        )
        if (next)
          useScene.getState().updateNode(
            node.id as AnyNodeId,
            {
              side: next.side,
              position: [next.position[0], next.position[1], node.position[2]],
            } as never,
          )
      },
    },
  },
  handles: (node) => {
    const result: HandleDescriptor<ProceduralItemNode>[] = []
    for (const p of node.recipe.parameters) {
      if (!p.axis) continue
      const axis = p.axis,
        index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      const downward = axis === 'y' && node.recipe.mounting?.attachTo === 'ceiling'
      result.push({
        kind: 'linear-resize',
        latchGroup: p.part,
        faceNormal: Boolean(node.wallId),
        portal: node.recipe.mounting ? 'grandparent' : 'self',
        axis,
        direction: downward ? -1 : undefined,
        anchor: axis === 'y' ? (downward ? 'max' : 'min') : 'center',
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
          clearance: {
            edge: (n) => handleBounds(n, p.part)[downward ? 'min' : 'max'][index],
            distance: 0.4,
          },
          position: (n) => {
            const b = handleBounds(n, p.part)
            const pos = b.max.map((v, i) => (i === index ? v + 0.15 : (b.min[i]! + v) / 2)) as [
              number,
              number,
              number,
            ]
            if (downward) pos[index] = b.min[index] - 0.15
            return pos
          },
        },
      })
    }
    if (node.recipe.mounting?.attachTo !== 'wall-side')
      result.push({
        ...proceduralRotateHandle(),
        portal: node.recipe.mounting ? 'grandparent' : 'self',
      })
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
