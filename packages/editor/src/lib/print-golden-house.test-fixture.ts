import {
  type AnyNode,
  BuildingNode,
  calculateLevelMiters,
  DoorNode,
  getLevelElevations,
  LevelNode,
  nodeRegistry,
  RoofSegmentNode,
  registerNode,
  SlabNode,
  type SlabPolygonContext,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  generateExtrudedWall,
  generateRoofSegmentGeometry,
  generateSlabGeometry,
} from '@pascal-app/viewer'
import * as THREE from 'three'

const EMPTY_SLAB_CONTEXT: SlabPolygonContext = { walls: [], siblingSlabs: [] }
const PRINT_GOLDEN_FURNITURE_KIND = 'print-golden-furniture'

export const PRINT_GOLDEN_HOUSE_IDS = {
  building: 'building_print-golden-house',
  groundLevel: 'level_print-golden-ground',
  upperLevel: 'level_print-golden-upper',
  groundWalls: [
    'wall_print-golden-ground-front',
    'wall_print-golden-ground-right',
    'wall_print-golden-ground-back',
    'wall_print-golden-ground-left',
  ],
  upperWalls: [
    'wall_print-golden-upper-front',
    'wall_print-golden-upper-right',
    'wall_print-golden-upper-back',
    'wall_print-golden-upper-left',
  ],
  door: 'door_print-golden-ground-front',
  window: 'window_print-golden-upper-back',
  groundSlab: 'slab_print-golden-ground',
  upperSlab: 'slab_print-golden-upper',
  roof: 'rseg_print-golden-upper',
  visibleFurniture: 'furniture_print-golden-visible',
  hiddenFurnitureParent: 'furniture_print-golden-hidden-parent',
  hiddenFurnitureChild: 'furniture_print-golden-hidden-child',
} as const

export type PrintGoldenHouseFixture = {
  root: THREE.Group
  nodes: Record<string, AnyNode>
  structuralNodeIds: string[]
  groundStructuralNodeIds: string[]
  upperStructuralNodeIds: string[]
  dispose: () => void
}

function wall(
  id: string,
  parentId: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
) {
  return WallNode.parse({
    id,
    parentId,
    start,
    end,
    height: 2.5,
    thickness: 0.2,
    children,
  })
}

function slab(id: string, parentId: string) {
  return SlabNode.parse({
    id,
    parentId,
    elevation: 0.2,
    thickness: 0.2,
    polygon: [
      [-2.1, -1.6],
      [2.1, -1.6],
      [2.1, 1.6],
      [-2.1, 1.6],
    ],
  })
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material.dispose()
  })
}

export function createPrintGoldenHouseFixture(): PrintGoldenHouseFixture {
  const ids = PRINT_GOLDEN_HOUSE_IDS
  for (const kind of ['wall', 'door', 'window', 'slab', 'roof-segment']) {
    if (nodeRegistry.has(kind)) continue
    registerNode({
      kind,
      schemaVersion: 1,
      category: 'structure',
      defaults: () => ({}),
      capabilities: {},
    } as never)
  }
  const groundWalls = [
    wall(ids.groundWalls[0], ids.groundLevel, [-2, -1.5], [2, -1.5], [ids.door]),
    wall(ids.groundWalls[1], ids.groundLevel, [2, -1.5], [2, 1.5]),
    wall(ids.groundWalls[2], ids.groundLevel, [2, 1.5], [-2, 1.5]),
    wall(ids.groundWalls[3], ids.groundLevel, [-2, 1.5], [-2, -1.5]),
  ]
  const upperWalls = [
    wall(ids.upperWalls[0], ids.upperLevel, [-2, -1.5], [2, -1.5]),
    wall(ids.upperWalls[1], ids.upperLevel, [2, -1.5], [2, 1.5]),
    wall(ids.upperWalls[2], ids.upperLevel, [2, 1.5], [-2, 1.5], [ids.window]),
    wall(ids.upperWalls[3], ids.upperLevel, [-2, 1.5], [-2, -1.5]),
  ]
  const door = DoorNode.parse({
    id: ids.door,
    parentId: groundWalls[0]!.id,
    wallId: groundWalls[0]!.id,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const window = WindowNode.parse({
    id: ids.window,
    parentId: upperWalls[2]!.id,
    wallId: upperWalls[2]!.id,
    position: [2, 1.4, 0],
    width: 1.2,
    height: 1,
  })
  const groundSlab = slab(ids.groundSlab, ids.groundLevel)
  const upperSlab = slab(ids.upperSlab, ids.upperLevel)
  const roof = RoofSegmentNode.parse({
    id: ids.roof,
    parentId: ids.upperLevel,
    roofType: 'gable',
    position: [0, 2.5, 0],
    width: 4,
    depth: 3,
    wallHeight: 0.5,
    pitch: 30,
    wallThickness: 0.15,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
  })

  if (!nodeRegistry.has(PRINT_GOLDEN_FURNITURE_KIND)) {
    registerNode({
      kind: PRINT_GOLDEN_FURNITURE_KIND,
      schemaVersion: 1,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {},
    } as never)
  }
  const visibleFurniture = {
    object: 'node',
    id: ids.visibleFurniture,
    type: PRINT_GOLDEN_FURNITURE_KIND,
    parentId: ids.groundLevel,
    children: [],
    visible: true,
  } as unknown as AnyNode
  const hiddenFurnitureParent = {
    object: 'node',
    id: ids.hiddenFurnitureParent,
    type: PRINT_GOLDEN_FURNITURE_KIND,
    parentId: ids.groundLevel,
    children: [ids.hiddenFurnitureChild],
    visible: false,
  } as unknown as AnyNode
  const hiddenFurnitureChild = {
    object: 'node',
    id: ids.hiddenFurnitureChild,
    type: PRINT_GOLDEN_FURNITURE_KIND,
    parentId: ids.hiddenFurnitureParent,
    children: [],
    visible: true,
  } as unknown as AnyNode

  const groundLevel = LevelNode.parse({
    id: ids.groundLevel,
    parentId: ids.building,
    name: 'Ground',
    level: 0,
    height: 2.5,
    children: [
      ...groundWalls.map((node) => node.id),
      groundSlab.id,
      visibleFurniture.id,
      hiddenFurnitureParent.id,
    ],
  })
  const upperLevel = LevelNode.parse({
    id: ids.upperLevel,
    parentId: ids.building,
    name: 'Upper',
    level: 1,
    height: 2.5,
    children: [...upperWalls.map((node) => node.id), upperSlab.id, roof.id],
  })
  const building = BuildingNode.parse({
    id: ids.building,
    children: [groundLevel.id, upperLevel.id],
  })
  const nodes = Object.fromEntries(
    [
      building,
      groundLevel,
      upperLevel,
      ...groundWalls,
      ...upperWalls,
      door,
      window,
      groundSlab,
      upperSlab,
      roof,
      visibleFurniture,
      hiddenFurnitureParent,
      hiddenFurnitureChild,
    ].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>

  const root = new THREE.Group()
  root.name = 'print-golden-house'
  const buildingRoot = new THREE.Group()
  buildingRoot.userData = { pascalId: building.id }
  const groundRoot = new THREE.Group()
  groundRoot.userData = { pascalId: groundLevel.id }
  const upperRoot = new THREE.Group()
  upperRoot.userData = { pascalId: upperLevel.id }
  const elevations = getLevelElevations(nodes)
  groundRoot.position.y = elevations.get(groundLevel.id)?.baseY ?? 0
  upperRoot.position.y = elevations.get(upperLevel.id)?.baseY ?? 0
  root.add(buildingRoot)
  buildingRoot.add(groundRoot, upperRoot)

  const registered = new Map<string, THREE.Object3D>()
  const registerObject = (id: string, object: THREE.Object3D) => {
    sceneRegistry.nodes.set(id, object)
    registered.set(id, object)
  }
  registerObject(building.id, buildingRoot)
  registerObject(groundLevel.id, groundRoot)
  registerObject(upperLevel.id, upperRoot)

  const mountWalls = (
    levelRoot: THREE.Group,
    walls: WallNode[],
    openings: Array<typeof door | typeof window>,
  ) => {
    const miters = calculateLevelMiters(walls)
    for (const wallNode of walls) {
      const wallRoot = new THREE.Group()
      wallRoot.userData = { pascalId: wallNode.id }
      wallRoot.position.set(wallNode.start[0], 0, wallNode.start[1])
      wallRoot.rotation.y = -Math.atan2(
        wallNode.end[1] - wallNode.start[1],
        wallNode.end[0] - wallNode.start[0],
      )
      const wallOpenings = openings.filter((opening) => opening.wallId === wallNode.id)
      wallRoot.add(new THREE.Mesh(generateExtrudedWall(wallNode, wallOpenings, miters)))
      for (const opening of wallOpenings) {
        const openingRoot = new THREE.Group()
        openingRoot.userData = { pascalId: opening.id }
        wallRoot.add(openingRoot)
        registerObject(opening.id, openingRoot)
      }
      levelRoot.add(wallRoot)
      registerObject(wallNode.id, wallRoot)
    }
  }
  mountWalls(groundRoot, groundWalls, [door])
  mountWalls(upperRoot, upperWalls, [window])

  const mountSlab = (levelRoot: THREE.Group, node: SlabNode) => {
    const slabRoot = new THREE.Group()
    slabRoot.userData = { pascalId: node.id }
    slabRoot.add(new THREE.Mesh(generateSlabGeometry(node, EMPTY_SLAB_CONTEXT)))
    levelRoot.add(slabRoot)
    registerObject(node.id, slabRoot)
  }
  mountSlab(groundRoot, groundSlab)
  mountSlab(upperRoot, upperSlab)

  const roofRoot = new THREE.Group()
  roofRoot.userData = { pascalId: roof.id }
  roofRoot.position.set(...roof.position)
  roofRoot.add(new THREE.Mesh(generateRoofSegmentGeometry(roof)))
  upperRoot.add(roofRoot)
  registerObject(roof.id, roofRoot)

  const visibleFurnitureRoot = new THREE.Group()
  visibleFurnitureRoot.userData = { pascalId: visibleFurniture.id }
  visibleFurnitureRoot.position.set(1, 0.5, 0)
  visibleFurnitureRoot.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.8)))
  groundRoot.add(visibleFurnitureRoot)
  registerObject(visibleFurniture.id, visibleFurnitureRoot)

  const hiddenFurnitureParentRoot = new THREE.Group()
  hiddenFurnitureParentRoot.userData = { pascalId: hiddenFurnitureParent.id }
  hiddenFurnitureParentRoot.position.set(-1, 0, 0)
  const hiddenFurnitureChildRoot = new THREE.Group()
  hiddenFurnitureChildRoot.userData = { pascalId: hiddenFurnitureChild.id }
  hiddenFurnitureChildRoot.position.y = 0.5
  hiddenFurnitureChildRoot.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.8)))
  hiddenFurnitureParentRoot.add(hiddenFurnitureChildRoot)
  groundRoot.add(hiddenFurnitureParentRoot)
  registerObject(hiddenFurnitureParent.id, hiddenFurnitureParentRoot)
  registerObject(hiddenFurnitureChild.id, hiddenFurnitureChildRoot)

  const groundStructuralNodeIds = [...groundWalls.map((node) => node.id), groundSlab.id].sort()
  const upperStructuralNodeIds = [
    ...upperWalls.map((node) => node.id),
    upperSlab.id,
    roof.id,
  ].sort()

  return {
    root,
    nodes,
    structuralNodeIds: [...groundStructuralNodeIds, ...upperStructuralNodeIds].sort(),
    groundStructuralNodeIds,
    upperStructuralNodeIds,
    dispose: () => {
      for (const [id, object] of registered) {
        if (sceneRegistry.nodes.get(id) === object) sceneRegistry.nodes.delete(id)
      }
      disposeObject(root)
      root.clear()
    },
  }
}
