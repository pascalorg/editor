import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

function getArgValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function readStorageJson(filePath, fallback) {
  if (!(await exists(filePath))) {
    return fallback
  }
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeStorageJson(filePath, payload) {
  if (await exists(filePath)) {
    const backupPath = `${filePath}.backup-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`
    await cp(filePath, backupPath)
  }
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function upsertBy(items, predicate, item) {
  const index = items.findIndex(predicate)
  if (index >= 0) {
    items[index] = { ...items[index], ...item }
    return items
  }
  return [...items, item]
}

async function installAssets(configDir) {
  const targetDir = path.join(configDir, 'www/pascal')
  await mkdir(targetDir, { recursive: true })

  const cardSourcePath = path.join(repoRoot, 'packages/lovelace-card/dist/pascal-viewer-card.js')
  const sceneSourcePath = path.join(repoRoot, 'docs/examples/lovelace/home.scene.json')
  await cp(
    cardSourcePath,
    path.join(targetDir, 'pascal-viewer-card.js'),
  )
  await cp(
    sceneSourcePath,
    path.join(targetDir, 'home.scene.json'),
  )
  await cp(path.join(repoRoot, 'apps/editor/public/items'), path.join(targetDir, 'items'), {
    recursive: true,
  })

  const cardStats = await stat(cardSourcePath)
  const sceneStats = await stat(sceneSourcePath)
  return {
    cardResourceUrl: `/local/pascal/pascal-viewer-card.js?v=${Math.floor(cardStats.mtimeMs)}`,
    sceneUrl: `/local/pascal/home.scene.json?v=${Math.floor(sceneStats.mtimeMs)}`,
  }
}

async function installStorage(configDir, installUrls) {
  const storageDir = path.join(configDir, '.storage')
  await mkdir(storageDir, { recursive: true })

  const resourcesPath = path.join(storageDir, 'lovelace_resources')
  const resourcesStorage = await readStorageJson(resourcesPath, {
    data: { items: [] },
    key: 'lovelace_resources',
    minor_version: 1,
    version: 1,
  })
  resourcesStorage.data = resourcesStorage.data ?? { items: [] }
  resourcesStorage.data.items = upsertBy(
    resourcesStorage.data.items ?? [],
    (item) => item.url?.startsWith('/local/pascal/pascal-viewer-card.js'),
    {
      id: 'pascal_viewer_card',
      type: 'module',
      url: installUrls.cardResourceUrl,
    },
  )
  await writeStorageJson(resourcesPath, resourcesStorage)

  const dashboardsPath = path.join(storageDir, 'lovelace_dashboards')
  const dashboardsStorage = await readStorageJson(dashboardsPath, {
    data: { items: [] },
    key: 'lovelace_dashboards',
    minor_version: 1,
    version: 1,
  })
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

  const pascalDashboardPath = path.join(storageDir, 'lovelace.pascal')
  await writeStorageJson(pascalDashboardPath, {
    data: {
      config: {
        title: 'Pascal',
        views: [
          {
            cards: [
              {
                mode: 'overview',
                scene_url: installUrls.sceneUrl,
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

async function main() {
  const configDir = getArgValue('--config-dir') ?? process.env.HA_CONFIG_DIR
  if (!configDir) {
    throw new Error('Pass --config-dir <path> or set HA_CONFIG_DIR.')
  }

  const resolvedConfigDir = path.resolve(configDir)
  const installUrls = await installAssets(resolvedConfigDir)
  await installStorage(resolvedConfigDir, installUrls)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
