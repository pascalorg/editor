import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const runtime = 'nodejs'

type PascalLovelacePublishBody = {
  artifact?: {
    homeAssistant?: {
      bindings?: unknown[]
    }
    scene?: {
      collections?: Record<string, unknown>
      nodes?: Record<string, any>
      rootNodeIds?: string[]
    }
    version?: number
    viewer?: Record<string, unknown>
  }
}

function findRepoRoot(startDir: string) {
  let currentDir = startDir

  for (;;) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        if (packageJson.workspaces) {
          return currentDir
        }
      } catch {
        // Keep walking upward.
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return startDir
    }
    currentDir = parentDir
  }
}

function resolveHomeAssistantConfigDir() {
  return path.resolve(
    process.env.PASCAL_HA_CONFIG_DIR ||
      process.env.HA_CONFIG_DIR ||
      path.join(os.homedir(), 'homeassistant', 'config'),
  )
}

async function readStorageJson(filePath: string, fallback: unknown) {
  if (!existsSync(filePath)) {
    return fallback
  }
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeStorageJson(filePath: string, payload: unknown) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function upsertBy<T>(items: T[], predicate: (item: T) => boolean, item: T) {
  const index = items.findIndex(predicate)
  if (index >= 0) {
    items[index] = { ...items[index], ...item }
    return items
  }
  return [...items, item]
}

function removeAuthoringReferenceNodes(scene: NonNullable<PascalLovelacePublishBody['artifact']>['scene']) {
  const removedNodeIds = new Set<string>()
  for (const [nodeId, node] of Object.entries(scene?.nodes ?? {})) {
    if (node?.type === 'guide' || node?.type === 'scan') {
      delete scene?.nodes?.[nodeId]
      removedNodeIds.add(nodeId)
    }
  }

  if (removedNodeIds.size === 0 || !scene) {
    return
  }

  scene.rootNodeIds = (scene.rootNodeIds ?? []).filter((nodeId) => !removedNodeIds.has(nodeId))
  for (const node of Object.values(scene.nodes ?? {})) {
    if (Array.isArray(node?.children)) {
      node.children = node.children.filter((childId: string) => !removedNodeIds.has(childId))
    }
  }

  for (const collection of Object.values(scene.collections ?? {}) as any[]) {
    if (Array.isArray(collection?.nodeIds)) {
      collection.nodeIds = collection.nodeIds.filter((nodeId: string) => !removedNodeIds.has(nodeId))
    }
    if (collection?.controlNodeId && removedNodeIds.has(collection.controlNodeId)) {
      collection.controlNodeId = collection.nodeIds?.[0] ?? null
    }
  }
}

function rewriteLocalAssetUrls(scene: NonNullable<PascalLovelacePublishBody['artifact']>['scene']) {
  for (const node of Object.values(scene?.nodes ?? {})) {
    if (node?.type !== 'item' || !node.asset) {
      continue
    }

    for (const key of ['floorPlanUrl', 'src', 'thumbnail']) {
      const value = node.asset[key]
      if (typeof value === 'string' && value.startsWith('/items/')) {
        node.asset[key] = `/local/pascal${value}`
      }
    }
  }
}

function validateAndPrepareArtifact(body: PascalLovelacePublishBody) {
  const artifact = structuredClone(body.artifact)
  if (artifact?.version !== 1) {
    throw new Error('Publish payload must contain a version 1 Lovelace artifact.')
  }
  if (!artifact.scene?.nodes || !artifact.scene.rootNodeIds) {
    throw new Error('Publish payload is missing scene nodes or root nodes.')
  }

  artifact.scene.collections = artifact.scene.collections ?? {}
  removeAuthoringReferenceNodes(artifact.scene)
  rewriteLocalAssetUrls(artifact.scene)

  return artifact
}

async function installLovelaceStorage(configDir: string, sceneUrl: string, cardResourceUrl: string) {
  const storageDir = path.join(configDir, '.storage')
  await mkdir(storageDir, { recursive: true })

  const resourcesPath = path.join(storageDir, 'lovelace_resources')
  const resourcesStorage = (await readStorageJson(resourcesPath, {
    data: { items: [] },
    key: 'lovelace_resources',
    minor_version: 1,
    version: 1,
  })) as { data?: { items?: Array<{ id?: string; type?: string; url?: string }> } }

  resourcesStorage.data = resourcesStorage.data ?? { items: [] }
  resourcesStorage.data.items = upsertBy(
    resourcesStorage.data.items ?? [],
    (item) => item.url?.startsWith('/local/pascal/pascal-viewer-card.js') === true,
    { id: 'pascal_viewer_card', type: 'module', url: cardResourceUrl },
  )
  await writeStorageJson(resourcesPath, resourcesStorage)

  const dashboardsPath = path.join(storageDir, 'lovelace_dashboards')
  const dashboardsStorage = (await readStorageJson(dashboardsPath, {
    data: { items: [] },
    key: 'lovelace_dashboards',
    minor_version: 1,
    version: 1,
  })) as { data?: { items?: Array<Record<string, unknown> & { id?: string; url_path?: string }> } }

  dashboardsStorage.data = dashboardsStorage.data ?? { items: [] }
  dashboardsStorage.data.items = upsertBy(
    dashboardsStorage.data.items ?? [],
    (item) => item.id === 'pascal' || item.url_path === 'pascal',
    {
      icon: 'mdi:cube-outline',
      id: 'pascal',
      mode: 'storage',
      require_admin: false,
      show_in_sidebar: true,
      title: 'Pascal',
      url_path: 'pascal',
    },
  )
  await writeStorageJson(dashboardsPath, dashboardsStorage)

  await writeStorageJson(path.join(storageDir, 'lovelace.pascal'), {
    data: {
      config: {
        title: 'Pascal',
        views: [
          {
            cards: [
              {
                mode: 'overview',
                scene_url: sceneUrl,
                show_header: true,
                tap_action: { action: 'toggle' },
                type: 'custom:pascal-viewer-card',
              },
            ],
            path: 'home',
            title: 'Pascal',
            type: 'panel',
          },
        ],
      },
    },
    key: 'lovelace.pascal',
    minor_version: 1,
    version: 1,
  })
}

export async function POST(request: Request) {
  try {
    const artifact = validateAndPrepareArtifact((await request.json()) as PascalLovelacePublishBody)
    const repoRoot = findRepoRoot(process.cwd())
    const configDir = resolveHomeAssistantConfigDir()
    const targetDir = path.join(configDir, 'www', 'pascal')
    const cardSourcePath = path.join(repoRoot, 'packages', 'lovelace-card', 'dist', 'pascal-viewer-card.js')
    const itemAssetsPath = path.join(repoRoot, 'apps', 'editor', 'public', 'items')

    if (!existsSync(cardSourcePath)) {
      throw new Error('Pascal Lovelace card is not built yet. Run packages/lovelace-card build first.')
    }
    if (!existsSync(configDir)) {
      throw new Error('Home Assistant config directory was not found. Set PASCAL_HA_CONFIG_DIR or HA_CONFIG_DIR.')
    }

    await mkdir(targetDir, { recursive: true })
    await cp(cardSourcePath, path.join(targetDir, 'pascal-viewer-card.js'))
    if (existsSync(itemAssetsPath)) {
      await cp(itemAssetsPath, path.join(targetDir, 'items'), { recursive: true })
    }
    await writeFile(path.join(targetDir, 'home.scene.json'), `${JSON.stringify(artifact, null, 2)}\n`)

    const cardStats = await stat(cardSourcePath)
    const sceneStats = await stat(path.join(targetDir, 'home.scene.json'))
    const cardResourceUrl = `/local/pascal/pascal-viewer-card.js?v=${Math.floor(cardStats.mtimeMs)}`
    const sceneUrl = `/local/pascal/home.scene.json?v=${Math.floor(sceneStats.mtimeMs)}`
    await installLovelaceStorage(configDir, sceneUrl, cardResourceUrl)

    return Response.json({
      bindingCount: artifact.homeAssistant?.bindings?.length ?? 0,
      dashboardPath: '/pascal/home',
      message: 'Published Pascal scene to Home Assistant Lovelace.',
      sceneUrl,
      success: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish Lovelace scene.'
    return Response.json({ error: message, success: false }, { status: 500 })
  }
}
