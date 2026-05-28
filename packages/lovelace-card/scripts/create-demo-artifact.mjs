import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

const resourceFixturePath = process.env.PASCAL_HOME_ASSISTANT_RESOURCES_PATH
const outDir = path.join(repoRoot, 'docs/examples/lovelace')

const PASCAL_ASSET_PREFIX = '/items'

const SUPABASE_ITEM_BASE =
  'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system'

const interactivePower = {
  controls: [{ default: false, kind: 'toggle', label: 'Power' }],
  effects: [],
}

const interactiveLight = {
  controls: [
    { default: false, kind: 'toggle', label: 'Power' },
    {
      default: 100,
      displayMode: 'dial',
      kind: 'slider',
      label: 'Intensity',
      max: 100,
      min: 0,
      step: 1,
      unit: '%',
    },
  ],
  effects: [{ color: '#ffffff', intensityRange: [0, 2], kind: 'light', offset: [0, 1.4, 0] }],
}

const assets = {
  floorLamp: {
    category: 'furniture',
    dimensions: [1, 1.9, 1],
    floorPlanUrl: `${SUPABASE_ITEM_BASE}/floor-lamp/floor-plan.png`,
    id: 'floor-lamp',
    interactive: interactiveLight,
    name: 'Floor Lamp',
    offset: [0.04, 0, 0.02],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    src: `${SUPABASE_ITEM_BASE}/floor-lamp/model.glb`,
    tags: ['lamp', 'light', 'lighting'],
    thumbnail: `${SUPABASE_ITEM_BASE}/floor-lamp/thumbnail.png`,
  },
  recessedLight: {
    attachTo: 'ceiling',
    category: 'furniture',
    dimensions: [0.5, 0.1, 0.5],
    floorPlanUrl: `${SUPABASE_ITEM_BASE}/recessed-light/floor-plan.png`,
    id: 'recessed-light',
    interactive: {
      ...interactiveLight,
      effects: [{ color: '#ffffff', intensityRange: [0, 2], kind: 'light', offset: [0, -0.1, 0] }],
    },
    name: 'Recessed Light',
    offset: [0, 0.094, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    src: `${SUPABASE_ITEM_BASE}/recessed-light/model.glb`,
    tags: ['recessed', 'downlight', 'light'],
    thumbnail: `${SUPABASE_ITEM_BASE}/recessed-light/thumbnail.png`,
  },
  television: {
    category: 'appliance',
    dimensions: [2, 1.1, 0.5],
    floorPlanUrl: `${SUPABASE_ITEM_BASE}/television/floor-plan.png`,
    id: 'television',
    interactive: interactivePower,
    name: 'Television',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    src: `${SUPABASE_ITEM_BASE}/television/model.glb`,
    tags: ['tv', 'media', 'electronics'],
    thumbnail: `${SUPABASE_ITEM_BASE}/television/thumbnail.png`,
  },
  ceilingFan: {
    attachTo: 'ceiling',
    category: 'appliance',
    dimensions: [1.4, 0.45, 1.4],
    floorPlanUrl: `${SUPABASE_ITEM_BASE}/ceiling-fan/floor-plan.png`,
    id: 'ceiling-fan',
    interactive: interactivePower,
    name: 'Ceiling Fan',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    src: `${SUPABASE_ITEM_BASE}/ceiling-fan/model.glb`,
    tags: ['fan', 'ceiling', 'air'],
    thumbnail: `${SUPABASE_ITEM_BASE}/ceiling-fan/thumbnail.png`,
  },
}

function addItem(scene, levelId, node) {
  scene.nodes[node.id] = {
    children: [],
    collectionIds: node.collectionIds ?? [],
    metadata: {},
    object: 'node',
    parentId: levelId,
    scale: [1, 1, 1],
    visible: true,
    ...node,
    type: 'item',
  }

  const level = scene.nodes[levelId]
  if (level?.children && !level.children.includes(node.id)) {
    level.children.push(node.id)
  }
}

function createSimpleScene(defaultLevelId) {
  const buildingId = 'building_pascal_lovelace_demo'
  const slabId = 'slab_pascal_lovelace_main'
  const zoneId = 'zone_pascal_lovelace_main'
  const wallIds = [
    'wall_pascal_lovelace_north',
    'wall_pascal_lovelace_east',
    'wall_pascal_lovelace_south',
    'wall_pascal_lovelace_west',
  ]

  return {
    collections: {},
    nodes: {
      [buildingId]: {
        children: [defaultLevelId],
        id: buildingId,
        metadata: {},
        object: 'node',
        parentId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        type: 'building',
        visible: true,
      },
      [defaultLevelId]: {
        camera: {
          mode: 'perspective',
          position: [4, 8.4, 9.2],
          target: [4, 0, 3],
        },
        children: [slabId, zoneId, ...wallIds],
        id: defaultLevelId,
        level: 0,
        metadata: {},
        object: 'node',
        parentId: buildingId,
        type: 'level',
        visible: true,
      },
      [slabId]: {
        elevation: 0.05,
        id: slabId,
        metadata: {},
        name: 'Main Room Floor',
        object: 'node',
        parentId: defaultLevelId,
        polygon: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        type: 'slab',
        visible: true,
      },
      [zoneId]: {
        camera: {
          mode: 'perspective',
          position: [4, 8.4, 9.2],
          target: [4, 0, 3],
        },
        color: '#2563eb',
        id: zoneId,
        metadata: {},
        name: 'Living Room',
        object: 'node',
        parentId: defaultLevelId,
        polygon: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        type: 'zone',
        visible: true,
      },
      wall_pascal_lovelace_north: {
        children: [],
        end: [8, 0],
        id: 'wall_pascal_lovelace_north',
        metadata: {},
        object: 'node',
        parentId: defaultLevelId,
        start: [0, 0],
        type: 'wall',
        visible: true,
      },
      wall_pascal_lovelace_east: {
        children: [],
        end: [8, 6],
        id: 'wall_pascal_lovelace_east',
        metadata: {},
        object: 'node',
        parentId: defaultLevelId,
        start: [8, 0],
        type: 'wall',
        visible: true,
      },
      wall_pascal_lovelace_south: {
        children: [],
        end: [0, 6],
        id: 'wall_pascal_lovelace_south',
        metadata: {},
        object: 'node',
        parentId: defaultLevelId,
        start: [8, 6],
        type: 'wall',
        visible: true,
      },
      wall_pascal_lovelace_west: {
        children: [],
        end: [0, 0],
        id: 'wall_pascal_lovelace_west',
        metadata: {},
        object: 'node',
        parentId: defaultLevelId,
        start: [0, 6],
        type: 'wall',
        visible: true,
      },
    },
    rootNodeIds: [buildingId],
  }
}

function createCollection(scene, id, name, nodeIds, color) {
  scene.collections[id] = {
    color,
    controlNodeId: nodeIds[0],
    id,
    name,
    nodeIds,
  }
  for (const nodeId of nodeIds) {
    const node = scene.nodes[nodeId]
    if (node?.type === 'item') {
      node.collectionIds = Array.from(new Set([...(node.collectionIds ?? []), id]))
    }
  }
}

function createBindingNode(scene, id, collectionId, resource, options = {}) {
  const binding = {
    aggregation: options.aggregation ?? 'single',
    collectionId,
    presentation: {
      icon: options.icon,
      label: options.label ?? resource.label,
      rtsHidden: false,
    },
    primaryResourceId: resource.id,
    resources: [resource],
  }

  scene.nodes[id] = {
    ...binding,
    id,
    metadata: {},
    object: 'node',
    parentId: null,
    type: 'home-assistant-binding',
    visible: false,
  }

  return binding
}

function findResource(resources, id) {
  const resource = resources.find((candidate) => candidate.id === id)
  if (!resource) {
    throw new Error(`Missing Home Assistant resource ${id}`)
  }
  return resource
}

async function readImportedResources() {
  if (resourceFixturePath) {
    try {
      const imported = JSON.parse(await readFile(resourceFixturePath, 'utf8'))
      if (Array.isArray(imported.resources)) {
        return imported.resources
      }
    } catch (error) {
      throw new Error(
        `Unable to read Home Assistant resources from PASCAL_HOME_ASSISTANT_RESOURCES_PATH: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  try {
    const artifact = JSON.parse(await readFile(path.join(outDir, 'home.scene.json'), 'utf8'))
    const sceneArtifact = artifact.version === 1 ? artifact : artifact.scene
    const resources = sceneArtifact?.homeAssistant?.bindings?.flatMap(
      (binding) => binding.resources ?? [],
    )
    if (Array.isArray(resources) && resources.length > 0) {
      return resources
    }
  } catch {
    // Fall through to the explicit missing-resources error below.
  }

  throw new Error(
    'Missing Home Assistant resources. Set PASCAL_HOME_ASSISTANT_RESOURCES_PATH or keep docs/examples/lovelace/home.scene.json available.',
  )
}

async function main() {
  const resources = await readImportedResources()
  const defaultLevelId = 'level_pascal_lovelace_main'
  const scene = createSimpleScene(defaultLevelId)

  const bindings = []

  addItem(scene, defaultLevelId, {
    asset: assets.television,
    id: 'item_pascal_lovelace_family_room_tv',
    name: 'Family Room TV',
    position: [4, 0, 0.65],
    rotation: [0, Math.PI, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_family_room_tv',
    'Family Room TV',
    ['item_pascal_lovelace_family_room_tv'],
    '#2563eb',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_family_room_tv',
      'collection_pascal_lovelace_family_room_tv',
      findResource(resources, 'media_player.family_room_tv'),
      { icon: 'mdi:television', label: 'Family Room TV' },
    ),
  )

  addItem(scene, defaultLevelId, {
    asset: assets.floorLamp,
    id: 'item_pascal_lovelace_living_lamp_1',
    name: 'Left Lamp',
    position: [1.2, 0, 5.1],
    rotation: [0, 0, 0],
  })
  addItem(scene, defaultLevelId, {
    asset: assets.floorLamp,
    id: 'item_pascal_lovelace_living_lamp_2',
    name: 'Right Lamp',
    position: [6.8, 0, 5.1],
    rotation: [0, 0, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_living_lamps',
    'Living Lamps',
    ['item_pascal_lovelace_living_lamp_1', 'item_pascal_lovelace_living_lamp_2'],
    '#f59e0b',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_living_lamps',
      'collection_pascal_lovelace_living_lamps',
      findResource(resources, 'light.pascal_living_room_table_lamp_1'),
      { icon: 'mdi:floor-lamp', label: 'Living Lamps' },
    ),
  )

  addItem(scene, defaultLevelId, {
    asset: assets.ceilingFan,
    id: 'item_pascal_lovelace_master_fan',
    name: 'Ceiling Fan',
    position: [5.8, 2.75, 3.35],
    rotation: [0, 0, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_master_fan',
    'Ceiling Fan',
    ['item_pascal_lovelace_master_fan'],
    '#06b6d4',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_master_fan',
      'collection_pascal_lovelace_master_fan',
      findResource(resources, 'fan.pascal_master_bedroom_fan'),
      { icon: 'mdi:fan', label: 'Ceiling Fan' },
    ),
  )

  const artifact = {
    homeAssistant: { bindings },
    scene,
    version: 1,
    viewer: {
      defaultLevelId,
      defaultMode: 'overview',
      levelMode: 'solo',
      viewMode: '3d',
      wallMode: 'cutaway',
    },
  }

  const yaml = `type: custom:pascal-viewer-card
scene_url: /local/pascal/home.scene.json
mode: overview
show_header: true
tap_action:
  action: toggle
`

  await mkdir(outDir, { recursive: true })
  const artifactText = `${JSON.stringify(artifact, null, 2)}\n`
  await writeFile(path.join(outDir, 'home.scene.json'), artifactText)
  await writeFile(path.join(outDir, 'custom-card.yaml'), yaml)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
