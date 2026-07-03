import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  HandleDescriptor,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from './floorplan'
import { buildCabinetGeometry } from './geometry'
import { cabinetPaint } from './paint'
import { cabinetModuleParametrics, cabinetParametrics } from './parametrics'
import { CabinetModuleNode, CabinetNode } from './schema'
import { cabinetSlots } from './slots'
import {
  backAnchoredModuleZ,
  isHoodCompartmentType,
  minCabinetCarcassHeightForStack,
  stackForCabinet,
} from './stack'

type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType
type CabinetLocalBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  size: [number, number, number]
  center: [number, number, number]
}

const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04
const MIN_CABINET_WIDTH = 0.3
const MIN_CABINET_DEPTH = 0.3
const MIN_CABINET_CARCASS_HEIGHT = 0.4
const CABINET_ADJACENCY_EPSILON = 1e-4

function isCabinetModule(node: AnyNode | undefined): node is CabinetModuleNodeType {
  return node?.type === 'cabinet-module'
}

function isCabinetRun(node: AnyNode | undefined): node is CabinetNodeType {
  return node?.type === 'cabinet'
}

function cabinetLayoutRevision(metadata: CabinetNodeType['metadata']): unknown {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).cabinetLayoutRevision
    : null
}

function cabinetMetadataRecord(metadata: CabinetNodeType['metadata']): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function bumpCabinetRunLayoutRevision(sceneApi: SceneApi, run: CabinetNodeType) {
  const metadataRecord = cabinetMetadataRecord(run.metadata)
  const currentRevision =
    typeof metadataRecord.cabinetLayoutRevision === 'number'
      ? metadataRecord.cabinetLayoutRevision
      : 0
  sceneApi.update(run.id as AnyNodeId, {
    metadata: {
      ...metadataRecord,
      cabinetLayoutRevision: currentRevision + 1,
    },
  } as Partial<AnyNode>)
  sceneApi.markDirty(run.id as AnyNodeId)
}

function cabinetTotalHeight(node: CabinetEditableNode) {
  return (
    (node.showPlinth ? node.plinthHeight : 0) +
    node.carcassHeight +
    (node.withCountertop ? node.countertopThickness : 0)
  )
}

function runModuleBaseY(node: Pick<CabinetNodeType, 'showPlinth' | 'plinthHeight'>) {
  return node.showPlinth ? node.plinthHeight : 0
}

function backAlignZ(baseDepth: number, wallDepth: number) {
  return -(baseDepth - wallDepth) / 2
}

function wallChildOf(
  module: CabinetModuleNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetModuleNodeType | undefined {
  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetModule(child)) return child
  }
  return undefined
}

function resolveCabinetType(
  module: CabinetModuleNodeType,
  parentRun?: CabinetNodeType,
): 'base' | 'tall' {
  if (module.cabinetType) return module.cabinetType
  return parentRun?.runTier === 'tall' ? 'tall' : 'base'
}

function cabinetModulesForRun(
  run: CabinetNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetModuleNodeType[] {
  return (run.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId])
    .filter(isCabinetModule)
}

function includeCabinetModuleBounds(
  module: CabinetModuleNodeType,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  origin: readonly [number, number, number],
  bounds: Pick<CabinetLocalBounds, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
) {
  const x = origin[0] + module.position[0]
  const y = origin[1] + module.position[1]
  const z = origin[2] + module.position[2]
  bounds.minX = Math.min(bounds.minX, x - module.width / 2)
  bounds.maxX = Math.max(bounds.maxX, x + module.width / 2)
  bounds.minY = Math.min(bounds.minY, y - (module.showPlinth ? module.plinthHeight : 0))
  bounds.maxY = Math.max(
    bounds.maxY,
    y + module.carcassHeight + (module.withCountertop ? module.countertopThickness : 0),
  )
  bounds.minZ = Math.min(bounds.minZ, z - module.depth / 2)
  bounds.maxZ = Math.max(bounds.maxZ, z + module.depth / 2)

  for (const childId of module.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (isCabinetModule(child)) includeCabinetModuleBounds(child, nodes, [x, y, z], bounds)
  }
}

function cabinetLocalBounds(
  node: CabinetEditableNode,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
): CabinetLocalBounds {
  const bounds = {
    minX: -node.width / 2,
    maxX: node.width / 2,
    minY: 0,
    maxY: cabinetTotalHeight(node),
    minZ: -node.depth / 2,
    maxZ: node.depth / 2,
  }

  if (isCabinetRun(node) && nodes) {
    const modules = cabinetModulesForRun(node, nodes)
    if (modules.length > 0) {
      bounds.minX = Number.POSITIVE_INFINITY
      bounds.maxX = Number.NEGATIVE_INFINITY
      bounds.minY = 0
      bounds.maxY = (node.showPlinth ? node.plinthHeight : 0) + node.carcassHeight
      bounds.minZ = Number.POSITIVE_INFINITY
      bounds.maxZ = Number.NEGATIVE_INFINITY
      for (const module of modules) {
        includeCabinetModuleBounds(module, nodes, [0, 0, 0], bounds)
      }
      bounds.maxY += node.withCountertop ? node.countertopThickness : 0
    }
  }

  const width = Math.max(0.01, bounds.maxX - bounds.minX)
  const height = Math.max(0.01, bounds.maxY - bounds.minY)
  const depth = Math.max(0.01, bounds.maxZ - bounds.minZ)
  return {
    ...bounds,
    size: [width, height, depth],
    center: [
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    ],
  }
}

function cabinetPlanBoundsAabb(
  node: CabinetNodeType,
  nodes?: Readonly<Record<AnyNodeId, AnyNode>>,
) {
  const bounds = cabinetLocalBounds(node, nodes)
  const cos = Math.cos(node.rotation)
  const sin = Math.sin(node.rotation)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [lx, lz] of [
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.maxX, bounds.maxZ],
    [bounds.minX, bounds.maxZ],
  ] as const) {
    const x = node.position[0] + lx * cos + lz * sin
    const z = node.position[2] - lx * sin + lz * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  return { minX, maxX, minZ, maxZ }
}

function sortedCabinetModules(modules: CabinetModuleNodeType[]) {
  return [...modules].sort((a, b) => a.position[0] - b.position[0])
}

function cabinetModuleSideOpen(
  module: CabinetModuleNodeType,
  side: 'left' | 'right',
  sceneApi: SceneApi,
) {
  const parent = module.parentId
    ? sceneApi.get(module.parentId as AnyNodeId)
    : undefined
  if (!isCabinetRun(parent)) return true
  const sorted = sortedCabinetModules(cabinetModulesForRun(parent, sceneApi.nodes()))
  const index = sorted.findIndex((entry) => entry.id === module.id)
  if (index < 0) return true
  const neighbor = side === 'left' ? sorted[index - 1] : sorted[index + 1]
  if (!neighbor) return true
  const edge = side === 'left'
    ? module.position[0] - module.width / 2
    : module.position[0] + module.width / 2
  const neighborEdge = side === 'left'
    ? neighbor.position[0] + neighbor.width / 2
    : neighbor.position[0] - neighbor.width / 2
  return Math.abs(edge - neighborEdge) > CABINET_ADJACENCY_EPSILON
}

function commitRunResize(
  run: CabinetNodeType,
  patch: Partial<CabinetNodeType>,
  sceneApi: SceneApi,
) {
  sceneApi.update(run.id as AnyNodeId, patch as Partial<AnyNode>)
  const nextRun = { ...run, ...patch }
  const syncDepth = typeof patch.depth === 'number'
  const syncHeight = typeof patch.carcassHeight === 'number'
  const syncPosition =
    patch.showPlinth !== undefined || typeof patch.plinthHeight === 'number'

  if (syncDepth || syncHeight || syncPosition) {
    for (const module of cabinetModulesForRun(run, sceneApi.nodes())) {
      const modulePatch: Partial<CabinetModuleNodeType> = {}
      if (syncDepth) {
        modulePatch.depth = nextRun.depth
        modulePatch.position = [
          module.position[0],
          module.position[1],
          backAnchoredModuleZ(module.position[2], module.depth, nextRun.depth),
        ]
      }
      if (syncHeight) {
        modulePatch.carcassHeight = Math.max(
          nextRun.carcassHeight,
          minCabinetCarcassHeightForStack(module),
        )
      }
      if (syncPosition) {
        modulePatch.position = [
          modulePatch.position?.[0] ?? module.position[0],
          runModuleBaseY(nextRun),
          modulePatch.position?.[2] ?? module.position[2],
        ]
      }
      if (Object.keys(modulePatch).length > 0) {
        sceneApi.update(module.id as AnyNodeId, modulePatch as Partial<AnyNode>)
        const wallChild = wallChildOf(module, sceneApi.nodes())
        if (wallChild && typeof modulePatch.depth === 'number') {
          sceneApi.update(wallChild.id as AnyNodeId, {
            position: [
              wallChild.position[0],
              wallChild.position[1],
              backAlignZ(modulePatch.depth, wallChild.depth),
            ],
          } as Partial<AnyNode>)
        }
      }
    }
  }

  if (syncDepth || syncHeight || syncPosition) {
    bumpCabinetRunLayoutRevision(sceneApi, nextRun)
  }
}

function commitModuleResize(
  module: CabinetModuleNodeType,
  patch: Partial<CabinetModuleNodeType>,
  sceneApi: SceneApi,
) {
  const nodes = sceneApi.nodes()
  const parent = module.parentId ? nodes[module.parentId as AnyNodeId] : undefined
  const parentRun = isCabinetRun(parent) ? parent : undefined

  if (!parentRun) {
    sceneApi.update(module.id as AnyNodeId, patch as Partial<AnyNode>)
    const parentModule = isCabinetModule(parent) ? parent : undefined
    if (parentModule) sceneApi.markDirty(parentModule.id as AnyNodeId)
    return
  }

  if (typeof patch.width === 'number') {
    sceneApi.update(module.id as AnyNodeId, patch as Partial<AnyNode>)
    const wallChild = wallChildOf(module, sceneApi.nodes())
    if (wallChild) {
      sceneApi.update(wallChild.id as AnyNodeId, {
        width: patch.width,
        position: [
          wallChild.position[0],
          wallChild.position[1],
          backAlignZ(patch.depth ?? module.depth, wallChild.depth),
        ],
      } as Partial<AnyNode>)
    }
    bumpCabinetRunLayoutRevision(sceneApi, parentRun)
    return
  }

  const modulePatch: Partial<CabinetModuleNodeType> = { ...patch }
  if (typeof patch.depth === 'number') {
    modulePatch.position = [
      patch.position?.[0] ?? module.position[0],
      patch.position?.[1] ?? module.position[1],
      backAnchoredModuleZ(module.position[2], module.depth, patch.depth),
    ]
  }

  sceneApi.update(module.id as AnyNodeId, modulePatch as Partial<AnyNode>)

  if (resolveCabinetType(module, parentRun) === 'base') {
    const runPatch: Partial<CabinetNodeType> = {}
    if (typeof patch.depth === 'number') runPatch.depth = patch.depth
    if (typeof patch.carcassHeight === 'number') {
      runPatch.carcassHeight = patch.carcassHeight
    }
    if (Object.keys(runPatch).length > 0) {
      commitRunResize(parentRun, runPatch, sceneApi)
    } else {
      bumpCabinetRunLayoutRevision(sceneApi, parentRun)
    }
  } else {
    bumpCabinetRunLayoutRevision(sceneApi, parentRun)
  }

  const wallChild = wallChildOf(module, sceneApi.nodes())
  if (wallChild && typeof modulePatch.depth === 'number') {
    sceneApi.update(wallChild.id as AnyNodeId, {
      position: [
        wallChild.position[0],
        wallChild.position[1],
        backAlignZ(modulePatch.depth, wallChild.depth),
      ],
    } as Partial<AnyNode>)
  }
}

function commitCabinetResize(
  node: CabinetEditableNode,
  patch: Partial<CabinetEditableNode>,
  sceneApi: SceneApi,
) {
  const liveNode = sceneApi.get(node.id as AnyNodeId) ?? node
  if (isCabinetRun(liveNode)) {
    commitRunResize(liveNode, patch as Partial<CabinetNodeType>, sceneApi)
    return
  }
  if (isCabinetModule(liveNode)) {
    commitModuleResize(liveNode, patch as Partial<CabinetModuleNodeType>, sceneApi)
    return
  }
  sceneApi.update(node.id as AnyNodeId, patch as Partial<AnyNode>)
}

function cabinetWidthHandle(side: 'left' | 'right'): HandleDescriptor<CabinetEditableNode> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: side === 'right' ? 'min' : 'max',
    min: MIN_CABINET_WIDTH,
    currentValue: (node) => node.width,
    apply: (node, width) => ({
      width,
      position: [
        node.position[0] + sign * (width - node.width) / 2,
        node.position[1],
        node.position[2],
      ],
    }),
    commit: commitCabinetResize,
    visible: (node, sceneApi) =>
      !isCabinetModule(node) || cabinetModuleSideOpen(node, side, sceneApi),
    placement: {
      position: (node) => [
        sign * (node.width / 2 + SIDE_HANDLE_OFFSET),
        cabinetTotalHeight(node) / 2,
        0,
      ],
      rotationY: () => (side === 'left' ? Math.PI : 0),
    },
  }
}

function cabinetDepthHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'min',
    min: MIN_CABINET_DEPTH,
    currentValue: (node) => node.depth,
    apply: (node, depth) => ({
      depth,
      position: [
        node.position[0],
        node.position[1],
        node.position[2] + (depth - node.depth) / 2,
      ],
    }),
    commit: commitCabinetResize,
    placement: {
      position: (node) => [
        0,
        cabinetTotalHeight(node) / 2,
        node.depth / 2 + SIDE_HANDLE_OFFSET,
      ],
    },
  }
}

function cabinetHeightHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_CABINET_CARCASS_HEIGHT,
    currentValue: (node) => node.carcassHeight,
    apply: (_node, carcassHeight) => ({ carcassHeight }),
    commit: commitCabinetResize,
    placement: {
      position: (node) => [
        0,
        cabinetTotalHeight(node) + HEIGHT_HANDLE_OFFSET,
        0,
      ],
    },
  }
}

function cabinetRotateHandle(): HandleDescriptor<CabinetEditableNode> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta, sceneApi) => {
      const rotation = (initial.rotation ?? 0) - delta
      const bounds = cabinetLocalBounds(initial, sceneApi.nodes())
      const [centerX, , centerZ] = bounds.center
      const previousRotation = initial.rotation ?? 0
      const previousCos = Math.cos(previousRotation)
      const previousSin = Math.sin(previousRotation)
      const nextCos = Math.cos(rotation)
      const nextSin = Math.sin(rotation)
      const pivotWorldX = initial.position[0] + centerX * previousCos + centerZ * previousSin
      const pivotWorldZ = initial.position[2] - centerX * previousSin + centerZ * previousCos
      return {
        rotation,
        position: [
          pivotWorldX - centerX * nextCos - centerZ * nextSin,
          initial.position[1],
          pivotWorldZ + centerX * nextSin - centerZ * nextCos,
        ],
      }
    },
    placement: {
      position: (node, sceneApi) => {
        const bounds = cabinetLocalBounds(node, sceneApi.nodes())
        return [bounds.maxX, bounds.center[1], bounds.maxZ + ROTATE_CORNER_OFFSET]
      },
      rotationY: () => -Math.PI / 4,
    },
    rotationCenter: (node, sceneApi) => cabinetLocalBounds(node, sceneApi.nodes()).center,
    decoration: {
      kind: 'ring',
      radius: (node, sceneApi) => {
        const bounds = cabinetLocalBounds(node, sceneApi.nodes())
        return Math.hypot(bounds.size[0] / 2, bounds.size[2] / 2) + ROTATE_RING_OFFSET
      },
      y: (node) => cabinetTotalHeight(node) / 2,
      center: (node, sceneApi) => cabinetLocalBounds(node, sceneApi.nodes()).center,
    },
  }
}

function cabinetHandles(node: CabinetNodeType): HandleDescriptor<CabinetNodeType>[] {
  if ((node.children ?? []).length > 0) {
    return [cabinetRotateHandle()] as HandleDescriptor<CabinetNodeType>[]
  }
  const handles: HandleDescriptor<CabinetEditableNode>[] = [
    cabinetDepthHandle(),
    cabinetHeightHandle(),
    cabinetRotateHandle(),
  ]
  if ((node.children ?? []).length === 0) {
    handles.unshift(cabinetWidthHandle('left'), cabinetWidthHandle('right'))
  }
  return handles as HandleDescriptor<CabinetNodeType>[]
}

function isHoodOnlyCabinet(node: CabinetEditableNode): boolean {
  const stack = stackForCabinet(node)
  return (
    stack.length > 0 &&
    stack.every((compartment) => isHoodCompartmentType(compartment.type))
  )
}

function cabinetModuleHandles(
  node: CabinetModuleNodeType,
): HandleDescriptor<CabinetModuleNodeType>[] {
  const handles: HandleDescriptor<CabinetEditableNode>[] = [
    cabinetWidthHandle('left'),
    cabinetWidthHandle('right'),
    cabinetRotateHandle(),
  ]
  if (!isHoodOnlyCabinet(node)) {
    handles.splice(1, 0, cabinetDepthHandle(), cabinetHeightHandle())
  }
  return handles as HandleDescriptor<CabinetModuleNodeType>[]
}

export const cabinetDefinition: NodeDefinition<typeof CabinetNode> = {
  kind: 'cabinet',
  schemaVersion: 2,
  schema: CabinetNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    runTier: 'base',
    children: [],
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0.1,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0.02,
    countertopOverhang: 0.02,
    frontThickness: 0.018,
    frontGap: 0.003,
    doorStyle: 'double',
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: true,
    withCountertop: true,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    surfaces: {
      top: {
        height: (node) => {
          const n = node as CabinetNodeType
          return n.plinthHeight + n.carcassHeight + (n.withCountertop ? n.countertopThickness : 0)
        },
      },
    },
    floorPlaced: {
      footprint: (node) => {
        const n = node as CabinetNodeType
        return {
          dimensions: [
            n.width,
            (n.showPlinth ? n.plinthHeight : 0) +
              n.carcassHeight +
              (n.withCountertop ? n.countertopThickness : 0),
            n.depth,
          ] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
    alignmentFootprint: (node, nodes) => {
      const n = node as CabinetNodeType
      return { shape: 'aabb', ...cabinetPlanBoundsAabb(n, nodes) }
    },
    dragBounds: (node, nodes) => {
      const bounds = cabinetLocalBounds(node as CabinetNodeType, nodes)
      return { size: bounds.size, center: bounds.center }
    },
    paint: cabinetPaint,
    slots: () => cabinetSlots(),
  },

  parametrics: cabinetParametrics,
  handles: cabinetHandles,
  geometry: buildCabinetGeometry,
  system: {
    module: () => import('./system'),
    priority: 2,
  },
  // `operationState` is deliberately absent — door/drawer poses are applied
  // per-frame by the cabinet animation system, not by geometry rebuilds.
  geometryKey: (n) =>
    JSON.stringify([
      n.width,
      n.depth,
      n.carcassHeight,
      n.runTier,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.frontThickness,
      n.frontGap,
      n.doorStyle,
      n.handleStyle,
      n.handlePosition,
      n.frontOverlay,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      JSON.stringify(n.material ?? null),
      JSON.stringify(n.materialPreset ?? null),
      JSON.stringify(n.slots ?? null),
      JSON.stringify(cabinetLayoutRevision(n.metadata)),
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place cabinet' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Modular Cabinet',
    description: 'A configurable parametric base cabinet.',
    icon: { kind: 'url', src: '/icons/furniture.webp' },
    paletteSection: 'furnish',
    paletteOrder: 34,
  },

  mcp: {
    description:
      'A configurable parametric base cabinet with plinth, carcass, front panels, optional countertop, and editable dimensions.',
  },
}

export const cabinetModuleDefinition: NodeDefinition<typeof CabinetModuleNode> = {
  kind: 'cabinet-module',
  schemaVersion: 2,
  schema: CabinetModuleNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [],
    cabinetType: 'base',
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0,
    countertopOverhang: 0.02,
    frontThickness: 0.018,
    frontGap: 0.003,
    doorStyle: 'double',
    handleStyle: 'bar',
    handlePosition: 'auto',
    frontOverlay: 'full',
    withBottomPanel: true,
    showPlinth: false,
    withCountertop: false,
    // material / materialPreset left undefined — paint mode writes slot refs.
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprint: (node) => {
        const n = node as CabinetModuleNodeType
        return {
          dimensions: [
            n.width,
            (n.showPlinth ? n.plinthHeight : 0) +
              n.carcassHeight +
              (n.withCountertop ? n.countertopThickness : 0),
            n.depth,
          ] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
    paint: cabinetPaint,
    slots: () => cabinetSlots(),
  },

  parametrics: cabinetModuleParametrics,
  handles: cabinetModuleHandles,
  geometry: buildCabinetGeometry,
  // `operationState` is deliberately absent — see cabinetDefinition.geometryKey.
  geometryKey: (n) =>
    JSON.stringify([
      n.cabinetType,
      n.width,
      n.depth,
      n.carcassHeight,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.frontThickness,
      n.frontGap,
      n.doorStyle,
      n.handleStyle,
      n.handlePosition,
      n.frontOverlay,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      JSON.stringify(n.material ?? null),
      JSON.stringify(n.materialPreset ?? null),
      JSON.stringify(n.slots ?? null),
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetModuleFloorplan,

  presentation: {
    label: 'Cabinet Module',
    description: 'An editable module inside a modular cabinet run.',
    icon: { kind: 'url', src: '/icons/furniture.webp' },
    paletteSection: 'furnish',
    paletteOrder: 35,
  },

  mcp: {
    description: 'A single editable cabinet module inside a modular cabinet run.',
  },
}
