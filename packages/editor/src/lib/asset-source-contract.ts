export type AssetSourceKind =
  | 'image-to-3d'
  | 'articraft'
  | 'ai-geometry'
  | 'industry-pack'
  | 'catalog-item'
  | 'factory-equipment'
  | 'manual'

export type AssetSourceContract = {
  kind: AssetSourceKind
  label?: string
  provider?: string
  assetId?: string
  artifactId?: string
  runId?: string
  prompt?: string
  recordId?: string
  recordPath?: string
  sourcePack?: {
    id: string
    version?: string
    industry?: string
  }
}

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sourcePackValue(value: unknown): AssetSourceContract['sourcePack'] | undefined {
  if (!isRecord(value)) return undefined
  const id = stringValue(value.id)
  if (!id) return undefined
  return {
    id,
    ...(stringValue(value.version) ? { version: stringValue(value.version) } : {}),
    ...(stringValue(value.industry) ? { industry: stringValue(value.industry) } : {}),
  }
}

function normalizeKind(value: unknown): AssetSourceKind | undefined {
  switch (stringValue(value)) {
    case 'image-to-3d':
    case 'articraft':
    case 'ai-geometry':
    case 'industry-pack':
    case 'catalog-item':
    case 'factory-equipment':
    case 'manual':
      return stringValue(value) as AssetSourceKind
    default:
      return undefined
  }
}

export function readAssetSourceContract(metadata: unknown): AssetSourceContract | null {
  if (!isRecord(metadata)) return null
  const raw = isRecord(metadata.assetSource) ? metadata.assetSource : null
  const rawKind = raw ? normalizeKind(raw.kind) : undefined
  const legacyTool = stringValue(metadata.sourceTool)
  const legacyGeneratedBy = stringValue(metadata.generatedBy)
  const legacySourcePack = sourcePackValue(metadata.sourcePack)
  const kind =
    rawKind ??
    (legacyTool === 'image-to-3d'
      ? 'image-to-3d'
      : legacyTool === 'articraft' || isRecord(metadata.articraft)
        ? 'articraft'
        : legacyGeneratedBy === 'ai-geometry' || metadata.artifactId || metadata.generatedShape
          ? 'ai-geometry'
          : legacySourcePack || metadata.processId || metadata.stationId || metadata.processDomain
            ? 'industry-pack'
            : metadata.catalogItemId
              ? 'catalog-item'
              : undefined)

  if (!kind) return null
  const sourcePack = sourcePackValue(raw?.sourcePack) ?? legacySourcePack
  const artifactId = stringValue(raw?.artifactId) ?? stringValue(metadata.artifactId)
  const assetId = stringValue(raw?.assetId)
  const provider = stringValue(raw?.provider) ?? stringValue(metadata.provider)
  const runId = stringValue(raw?.runId) ?? stringValue(metadata.runId)
  const prompt = stringValue(raw?.prompt)
  const label = stringValue(raw?.label)
  const recordId =
    stringValue(raw?.recordId) ??
    (isRecord(metadata.articraft) ? stringValue(metadata.articraft.recordId) : undefined)
  const recordPath =
    stringValue(raw?.recordPath) ??
    (isRecord(metadata.articraft) ? stringValue(metadata.articraft.recordPath) : undefined)

  return {
    kind,
    ...(label ? { label } : {}),
    ...(provider ? { provider } : {}),
    ...(assetId ? { assetId } : {}),
    ...(artifactId ? { artifactId } : {}),
    ...(runId ? { runId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(recordId ? { recordId } : {}),
    ...(recordPath ? { recordPath } : {}),
    ...(sourcePack ? { sourcePack } : {}),
  }
}

export function assetSourceLabel(source: AssetSourceContract | null) {
  if (!source) return undefined
  if (source.kind === 'image-to-3d') {
    return [source.provider ?? 'image-to-3d', source.assetId].filter(Boolean).join(' · ')
  }
  if (source.kind === 'articraft') {
    return ['Articraft', source.recordId ?? source.assetId].filter(Boolean).join(' · ')
  }
  if (source.kind === 'industry-pack') {
    const pack = source.sourcePack
    return pack ? `${pack.id}${pack.version ? `@${pack.version}` : ''}` : 'industry pack'
  }
  if (source.kind === 'ai-geometry') {
    return ['AI geometry', source.artifactId].filter(Boolean).join(' · ')
  }
  if (source.kind === 'catalog-item') return ['Catalog', source.assetId].filter(Boolean).join(' · ')
  if (source.kind === 'factory-equipment') return 'Factory plugin'
  return source.label
}

export function imageTo3DAssetSource(input: {
  assetId: string
  provider: string
  prompt: string
  runId?: string
}): AssetSourceContract {
  return {
    kind: 'image-to-3d',
    assetId: input.assetId,
    provider: input.provider,
    prompt: input.prompt,
    ...(input.runId ? { runId: input.runId } : {}),
  }
}

export function articraftAssetSource(input: {
  assetId?: string
  recordId: string
  recordPath?: string
  prompt: string
  runId?: string
}): AssetSourceContract {
  return {
    kind: 'articraft',
    ...(input.assetId ? { assetId: input.assetId } : {}),
    recordId: input.recordId,
    ...(input.recordPath ? { recordPath: input.recordPath } : {}),
    prompt: input.prompt,
    ...(input.runId ? { runId: input.runId } : {}),
  }
}
