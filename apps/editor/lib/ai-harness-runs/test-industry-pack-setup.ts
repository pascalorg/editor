import {
  installCloudProfilePack,
  listInstalledProfilePacks,
  removeProfilePack,
  setProfilePackEnabled,
  type InstalledProfilePack,
} from '../profile-packs'
import { resetIndustryProcessTemplateCacheForTests } from './industry-factory-knowledge'
import { resetProcessEquipmentContractCacheForTests } from './process-equipment-contracts'

type RequestedPack = {
  id: string
  version: string
}

type PackSnapshot = Pick<InstalledProfilePack, 'id' | 'version' | 'path' | 'enabled'>

function packKey(pack: Pick<InstalledProfilePack, 'id' | 'version'>) {
  return `${pack.id}@${pack.version}`
}

function resetIndustryCaches() {
  resetIndustryProcessTemplateCacheForTests()
  resetProcessEquipmentContractCacheForTests()
}

export async function installIndustryPacksForTests(requested: RequestedPack[]) {
  const initial = await listInstalledProfilePacks()
  const initialByKey = new Map(initial.map((pack) => [packKey(pack), pack]))
  const installedByTest = new Map<string, PackSnapshot>()
  const enabledByTest = new Map<string, PackSnapshot>()

  for (const request of requested) {
    const key = `${request.id}@${request.version}`
    const existing = initialByKey.get(key)
    if (existing) {
      if (!existing.enabled) {
        await setProfilePackEnabled(existing.path, true)
        enabledByTest.set(key, existing)
      }
      continue
    }

    const result = await installCloudProfilePack(request.id, request.version)
    for (const pack of [...result.installedDependencies, result.pack]) {
      const dependencyKey = packKey(pack)
      if (!initialByKey.has(dependencyKey)) {
        installedByTest.set(dependencyKey, pack)
      }
    }
  }

  resetIndustryCaches()

  return async () => {
    for (const pack of [...installedByTest.values()].reverse()) {
      await removeProfilePack(pack.path).catch(() => {})
    }
    for (const pack of enabledByTest.values()) {
      await setProfilePackEnabled(pack.path, false).catch(() => {})
    }
    resetIndustryCaches()
  }
}

export async function withIndustryPackDisabledForTests(request: RequestedPack) {
  const existing = (await listInstalledProfilePacks()).find(
    (pack) => pack.id === request.id && pack.version === request.version,
  )
  let installedByTest: PackSnapshot | undefined
  let reenable = false

  if (!existing) {
    const result = await installCloudProfilePack(request.id, request.version)
    installedByTest = result.pack
  } else if (existing.enabled) {
    reenable = true
  }

  const current = (await listInstalledProfilePacks()).find(
    (pack) => pack.id === request.id && pack.version === request.version,
  )
  if (current?.enabled) {
    await setProfilePackEnabled(current.path, false)
  }
  resetIndustryCaches()

  return async () => {
    if (installedByTest) {
      await removeProfilePack(installedByTest.path).catch(() => {})
    } else if (reenable && current) {
      await setProfilePackEnabled(current.path, true).catch(() => {})
    }
    resetIndustryCaches()
  }
}
