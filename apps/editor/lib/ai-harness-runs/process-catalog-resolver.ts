import { findCatalogItem } from '@pascal-app/core/lib/asset-catalog'
import type { AssetInput } from '@pascal-app/core/schema'
import type {
  ProcessEquipmentContract,
  ProcessEquipmentPort,
  ProcessLinePlan,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'

export type ProcessCatalogEquipmentMatch = {
  asset: AssetInput
  assetId: string
  reason: string
  confidence: number
}

type CatalogEquipmentProfile = {
  assetId: string
  aliases: RegExp[]
  rolePatterns?: RegExp[]
  families?: string[]
  allowedPortMedia?: ProcessEquipmentPort['medium'][]
  rejectWhenContractHasPorts?: boolean
}

const CATALOG_EQUIPMENT_PROFILES: CatalogEquipmentProfile[] = [
  {
    assetId: 'factory-electric-box',
    families: ['electrical.rectifier', 'electrical.control_safety'],
    rolePatterns: [/dc[_\s-]?power|rectifier|control|safety|monitoring/i],
    aliases: [
      /electric|electrical|power|cabinet|control|monitoring|safety/i,
      /\u7535\u6e90|\u7535\u67dc|\u63a7\u5236|\u5b89\u5168|\u76d1\u63a7/i,
    ],
    allowedPortMedia: ['power'],
  },
  {
    assetId: 'factory-extractor',
    rolePatterns: [/ventilation|exhaust|extractor/i],
    aliases: [/ventilation|exhaust|extractor|\u901a\u98ce|\u6392\u98ce/i],
    rejectWhenContractHasPorts: true,
  },
  {
    assetId: 'factory-barrel',
    families: ['tank', 'storage_tank'],
    rolePatterns: [/barrel|drum|storage/i],
    aliases: [/barrel|drum|storage|\u6876|\u50a8\u7f50|\u5b58\u50a8/i],
    rejectWhenContractHasPorts: true,
  },
]

function sceneCatalogAsset(asset: AssetInput): AssetInput {
  return {
    ...asset,
    src: asset.src,
    thumbnail: asset.thumbnail,
    ...(asset.floorPlanUrl ? { floorPlanUrl: asset.floorPlanUrl } : {}),
  }
}

function stationText(station: ProcessStationPlan) {
  return [
    station.id,
    station.role,
    station.label,
    station.displayLabel,
    station.equipmentHint,
    ...(station.safetyTags ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

function profileCanSatisfyContract(
  profile: CatalogEquipmentProfile,
  contract: ProcessEquipmentContract | undefined,
) {
  if (!contract) return true
  if (contract.preferredResolver === 'catalog-item') return true
  if (profile.families?.includes(contract.equipmentFamily)) return true
  if (profile.rejectWhenContractHasPorts && contract.ports.length > 0) return false
  if (!profile.allowedPortMedia) return contract.ports.length === 0
  return contract.ports.every((port) => profile.allowedPortMedia?.includes(port.medium))
}

function scoreProfile(input: {
  profile: CatalogEquipmentProfile
  station: ProcessStationPlan
  contract?: ProcessEquipmentContract
}) {
  if (!profileCanSatisfyContract(input.profile, input.contract)) return 0
  const text = stationText(input.station)
  let score = 0
  if (input.contract && input.profile.families?.includes(input.contract.equipmentFamily)) {
    score += 8
  }
  if (input.profile.rolePatterns?.some((pattern) => pattern.test(input.station.role))) {
    score += 5
  }
  if (input.profile.aliases.some((pattern) => pattern.test(text))) {
    score += 3
  }
  return score
}

export function resolveProcessCatalogEquipment(input: {
  plan: ProcessLinePlan
  station: ProcessStationPlan
  stationPlacement: StationPlacement
  equipmentContract?: ProcessEquipmentContract
}): ProcessCatalogEquipmentMatch | undefined {
  const candidates = CATALOG_EQUIPMENT_PROFILES.map((profile) => ({
    profile,
    score: scoreProfile({
      profile,
      station: input.station,
      contract: input.equipmentContract,
    }),
  }))
    .filter((candidate) => candidate.score >= 5)
    .sort((left, right) => right.score - left.score)

  const winner = candidates[0]
  if (!winner) return undefined

  const asset = findCatalogItem(winner.profile.assetId)
  if (!asset) return undefined

  return {
    asset: sceneCatalogAsset(asset),
    assetId: winner.profile.assetId,
    confidence: winner.score,
    reason: input.equipmentContract
      ? `catalog asset matched process equipment family ${input.equipmentContract.equipmentFamily}`
      : 'catalog asset matched station role and equipment wording',
  }
}
