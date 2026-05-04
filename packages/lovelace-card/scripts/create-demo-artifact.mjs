import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

const demoScenePath = path.join(repoRoot, 'apps/editor/public/demos/demo_1.json')
const resourceLogPath = path.join(repoRoot, '.codex/runtime-logs/ha-import-resources-latest.json')
const outDir = path.join(repoRoot, 'docs/examples/lovelace')
const editorPublicOutDir = path.join(repoRoot, 'apps/editor/public/lovelace')

const LOCAL_PASCAL_ASSET_PREFIX = '/local/pascal'

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
    floorPlanUrl: `${LOCAL_PASCAL_ASSET_PREFIX}/items/ceiling-fan/floor-plan.png`,
    id: 'ceiling-fan',
    interactive: interactivePower,
    name: 'Ceiling Fan',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    src: `${LOCAL_PASCAL_ASSET_PREFIX}/items/ceiling-fan/model.glb`,
    tags: ['fan', 'ceiling', 'air'],
    thumbnail: `${LOCAL_PASCAL_ASSET_PREFIX}/items/ceiling-fan/thumbnail.png`,
  },
}

function rewriteLocalAssetUrls(scene) {
  for (const node of Object.values(scene.nodes)) {
    if (node?.type !== 'item' || !node.asset) {
      continue
    }
    for (const key of ['floorPlanUrl', 'src', 'thumbnail']) {
      const value = node.asset[key]
      if (typeof value === 'string' && value.startsWith('/items/')) {
        node.asset[key] = `${LOCAL_PASCAL_ASSET_PREFIX}${value}`
      }
    }
  }
}

function pruneOrphanNodes(scene) {
  let removedAny = true

  while (removedAny) {
    removedAny = false

    for (const [nodeId, node] of Object.entries(scene.nodes)) {
      if (node?.parentId && !scene.nodes[node.parentId]) {
        delete scene.nodes[nodeId]
        removedAny = true
      }
    }
  }

  for (const node of Object.values(scene.nodes)) {
    if (Array.isArray(node?.children)) {
      node.children = node.children.filter((childId) => scene.nodes[childId])
    }
  }

  for (const collection of Object.values(scene.collections ?? {})) {
    if (Array.isArray(collection?.nodeIds)) {
      collection.nodeIds = collection.nodeIds.filter((nodeId) => scene.nodes[nodeId])
    }
    if (collection?.controlNodeId && !scene.nodes[collection.controlNodeId]) {
      collection.controlNodeId = collection.nodeIds?.[0] ?? null
    }
  }
}

function removeAuthoringReferenceNodes(scene) {
  const removedNodeIds = new Set()
  for (const [nodeId, node] of Object.entries(scene.nodes)) {
    if (node?.type === 'guide' || node?.type === 'scan') {
      delete scene.nodes[nodeId]
      removedNodeIds.add(nodeId)
    }
  }

  if (removedNodeIds.size === 0) {
    return
  }

  scene.rootNodeIds = (scene.rootNodeIds ?? []).filter((nodeId) => !removedNodeIds.has(nodeId))

  for (const node of Object.values(scene.nodes)) {
    if (Array.isArray(node?.children)) {
      node.children = node.children.filter((childId) => !removedNodeIds.has(childId))
    }
  }

  for (const collection of Object.values(scene.collections ?? {})) {
    if (Array.isArray(collection?.nodeIds)) {
      collection.nodeIds = collection.nodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))
    }
    if (collection?.controlNodeId && removedNodeIds.has(collection.controlNodeId)) {
      collection.controlNodeId = collection.nodeIds?.[0] ?? null
    }
  }
}

function ensureRootNode(scene, nodeId) {
  scene.rootNodeIds = Array.isArray(scene.rootNodeIds) ? scene.rootNodeIds : []
  if (scene.nodes[nodeId] && !scene.rootNodeIds.includes(nodeId)) {
    scene.rootNodeIds.push(nodeId)
  }
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
  try {
    const imported = JSON.parse(await readFile(resourceLogPath, 'utf8'))
    if (Array.isArray(imported.resources)) {
      return imported.resources
    }
  } catch {
    // The demo generator can still be used outside this workstation by placing
    // an import log at .codex/runtime-logs/ha-import-resources-latest.json.
  }

  throw new Error(
    'Missing Home Assistant import resource log. Run an HA import first or provide .codex/runtime-logs/ha-import-resources-latest.json.',
  )
}

async function main() {
  const scene = JSON.parse(await readFile(demoScenePath, 'utf8'))
  const resources = await readImportedResources()
  scene.collections = scene.collections ?? {}
  rewriteLocalAssetUrls(scene)
  pruneOrphanNodes(scene)
  removeAuthoringReferenceNodes(scene)

  const defaultLevelId = 'level_pojp0mw3qssu110w'
  ensureRootNode(scene, defaultLevelId)

  const bindings = []

  addItem(scene, defaultLevelId, {
    asset: assets.television,
    id: 'item_pascal_lovelace_family_room_tv',
    name: 'Family Room TV',
    position: [5.6, 0, 8.1],
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
    name: 'Living Room Lamp 1',
    position: [7.15, 0, 6.8],
    rotation: [0, 0, 0],
  })
  addItem(scene, defaultLevelId, {
    asset: assets.floorLamp,
    id: 'item_pascal_lovelace_living_lamp_2',
    name: 'Living Room Lamp 2',
    position: [2.75, 0, 6.8],
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
    asset: assets.recessedLight,
    id: 'item_pascal_lovelace_kitchen_lights',
    name: 'Kitchen Lights',
    position: [12.9, 2.6, 7.1],
    rotation: [0, 0, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_kitchen_lights',
    'Kitchen Lights',
    ['item_pascal_lovelace_kitchen_lights'],
    '#10b981',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_kitchen_lights',
      'collection_pascal_lovelace_kitchen_lights',
      findResource(resources, 'light.pascal_kitchen_lights_group'),
      { aggregation: 'any_on', icon: 'mdi:light-recessed', label: 'Kitchen Lights' },
    ),
  )

  addItem(scene, defaultLevelId, {
    asset: assets.recessedLight,
    id: 'item_pascal_lovelace_master_lights',
    name: 'Master Lights',
    position: [18.1, 2.6, 10.6],
    rotation: [0, 0, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_master_lights',
    'Master Lights',
    ['item_pascal_lovelace_master_lights'],
    '#8b5cf6',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_master_lights',
      'collection_pascal_lovelace_master_lights',
      findResource(resources, 'light.pascal_master_bedroom_lights_group'),
      { aggregation: 'any_on', icon: 'mdi:light-recessed', label: 'Master Lights' },
    ),
  )

  addItem(scene, defaultLevelId, {
    asset: assets.ceilingFan,
    id: 'item_pascal_lovelace_master_fan',
    name: 'Master Fan',
    position: [17.1, 2.7, 11.2],
    rotation: [0, 0, 0],
  })
  createCollection(
    scene,
    'collection_pascal_lovelace_master_fan',
    'Master Fan',
    ['item_pascal_lovelace_master_fan'],
    '#06b6d4',
  )
  bindings.push(
    createBindingNode(
      scene,
      'ha-binding_pascal_lovelace_master_fan',
      'collection_pascal_lovelace_master_fan',
      findResource(resources, 'fan.pascal_master_bedroom_fan'),
      { icon: 'mdi:fan', label: 'Master Fan' },
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
  await mkdir(editorPublicOutDir, { recursive: true })
  const artifactText = `${JSON.stringify(artifact, null, 2)}\n`
  await writeFile(path.join(outDir, 'home.scene.json'), artifactText)
  await writeFile(path.join(editorPublicOutDir, 'home.scene.json'), artifactText)
  await writeFile(path.join(outDir, 'custom-card.yaml'), yaml)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
