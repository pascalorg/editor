import fs from 'node:fs/promises'
import path from 'node:path'
import type { AssetInput } from '@pascal-app/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createGeneratedAssetId,
  findRepoRoot,
  generatedManifestPath,
  isSafeGeneratedAssetId,
  itemRoot,
  readGeneratedAssets,
  removeGeneratedAsset,
  removeGeneratedAssetDirectory,
  upsertGeneratedAsset,
} from '@/lib/generated-assets/manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_GLB_BYTES = 50 * 1024 * 1024
const MAX_TRIANGLES = 500_000
const MAX_MESHES = 120
const MAX_MATERIALS = 80
const MAX_TEXTURE_SIZE = 4096
const CATALOG_CATEGORIES = new Set(['electronics', 'equipment', 'structural', 'outdoor'])
const CATALOG_CATEGORY_ALIASES = new Map([
  ['safety', 'electronics'],
  ['lighting', 'electronics'],
  ['electrical', 'electronics'],
  ['hvac', 'electronics'],
  ['opening', 'structural'],
  ['infrastructure', 'outdoor'],
  ['nature', 'outdoor'],
  ['vehicle', 'outdoor'],
])

function readText(value: FormDataEntryValue | null, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeCatalogCategory(value: string) {
  const normalized = CATALOG_CATEGORY_ALIASES.get(value) ?? value
  return CATALOG_CATEGORIES.has(normalized) ? normalized : 'equipment'
}

function assetNameFromFile(file: File) {
  return file.name.replace(/\.glb$/i, '').trim() || 'Imported GLB'
}

type GlbInspection = {
  triangles: number
  meshes: number
  primitives: number
  materials: number
  images: number
  maxTextureSize: number
  dimensions: [number, number, number]
}

function inspectPngDimensions(buffer: Buffer): [number, number] | null {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x8950_4e47 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

function inspectJpegDimensions(buffer: Buffer): [number, number] | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    offset += 2
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)]
    }
    offset += length
  }
  return null
}

function inspectImageDimensions(buffer: Buffer, mimeType?: string): [number, number] | null {
  if (mimeType === 'image/png') return inspectPngDimensions(buffer)
  if (mimeType === 'image/jpeg') return inspectJpegDimensions(buffer)
  return inspectPngDimensions(buffer) ?? inspectJpegDimensions(buffer)
}

function inspectGlb(buffer: Buffer): GlbInspection {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x4654_6c67) {
    throw new Error('Invalid GLB header')
  }
  const declaredLength = buffer.readUInt32LE(8)
  if (declaredLength > buffer.length) throw new Error('Incomplete GLB file')

  let jsonText: string | null = null
  let binaryChunk: Buffer | null = null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > buffer.length) throw new Error('Invalid GLB chunk length')
    const chunk = buffer.subarray(chunkStart, chunkEnd)
    if (chunkType === 0x4e4f_534a) jsonText = chunk.toString('utf8').trim()
    if (chunkType === 0x004e_4942) binaryChunk = chunk
    offset = chunkEnd
  }
  if (!jsonText) throw new Error('GLB JSON chunk is missing')

  const gltf = JSON.parse(jsonText) as {
    accessors?: Array<{ count?: number; min?: number[]; max?: number[] }>
    meshes?: Array<{
      primitives?: Array<{
        mode?: number
        indices?: number
        attributes?: { POSITION?: number }
        material?: number
      }>
    }>
    materials?: unknown[]
    images?: Array<{ bufferView?: number; mimeType?: string }>
    bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number }>
  }

  const accessors = gltf.accessors ?? []
  let triangles = 0
  let primitives = 0
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1
      const positionAccessor =
        primitive.attributes?.POSITION !== undefined
          ? accessors[primitive.attributes.POSITION]
          : undefined
      if (positionAccessor?.min && positionAccessor.max) {
        for (let i = 0; i < 3; i += 1) {
          const minValue = positionAccessor.min[i]
          const maxValue = positionAccessor.max[i]
          if (typeof minValue === 'number' && Number.isFinite(minValue)) {
            min[i] = Math.min(min[i]!, minValue)
          }
          if (typeof maxValue === 'number' && Number.isFinite(maxValue)) {
            max[i] = Math.max(max[i]!, maxValue)
          }
        }
      }
      const mode = primitive.mode ?? 4
      const count =
        primitive.indices !== undefined
          ? (accessors[primitive.indices]?.count ?? 0)
          : (positionAccessor?.count ?? 0)
      if (mode === 4) triangles += Math.floor(count / 3)
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2)
    }
  }

  let maxTextureSize = 0
  if (binaryChunk) {
    for (const image of gltf.images ?? []) {
      const view = image.bufferView !== undefined ? gltf.bufferViews?.[image.bufferView] : undefined
      if (!view?.byteLength) continue
      const imageBuffer = binaryChunk.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      )
      const dimensions = inspectImageDimensions(imageBuffer, image.mimeType)
      if (dimensions) maxTextureSize = Math.max(maxTextureSize, dimensions[0], dimensions[1])
    }
  }

  return {
    triangles,
    meshes: gltf.meshes?.length ?? 0,
    primitives,
    materials: gltf.materials?.length ?? 0,
    images: gltf.images?.length ?? 0,
    maxTextureSize,
    dimensions: [
      Number.isFinite(min[0]!) && Number.isFinite(max[0]!) ? Math.max(0.05, max[0]! - min[0]!) : 1,
      Number.isFinite(min[1]!) && Number.isFinite(max[1]!) ? Math.max(0.05, max[1]! - min[1]!) : 1,
      Number.isFinite(min[2]!) && Number.isFinite(max[2]!) ? Math.max(0.05, max[2]! - min[2]!) : 1,
    ],
  }
}

function validateGlbInspection(inspection: GlbInspection) {
  const reasons: string[] = []
  if (inspection.triangles > MAX_TRIANGLES) {
    reasons.push(
      `三角面过多：${inspection.triangles.toLocaleString()} > ${MAX_TRIANGLES.toLocaleString()}`,
    )
  }
  if (inspection.meshes > MAX_MESHES) {
    reasons.push(`mesh 过多：${inspection.meshes} > ${MAX_MESHES}`)
  }
  if (inspection.materials > MAX_MATERIALS) {
    reasons.push(`材质过多：${inspection.materials} > ${MAX_MATERIALS}`)
  }
  if (inspection.maxTextureSize > MAX_TEXTURE_SIZE) {
    reasons.push(`贴图过大：${inspection.maxTextureSize}px > ${MAX_TEXTURE_SIZE}px`)
  }
  return reasons
}

export async function GET() {
  const repoRoot = await findRepoRoot()
  const assets = await readGeneratedAssets(generatedManifestPath(repoRoot))
  return NextResponse.json({ assets })
}

export async function DELETE(req: NextRequest) {
  const assetId = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!assetId || !isSafeGeneratedAssetId(assetId)) {
    return NextResponse.json({ error: 'Valid asset id is required' }, { status: 400 })
  }

  const repoRoot = await findRepoRoot()
  const manifestPath = generatedManifestPath(repoRoot)
  const removed = await removeGeneratedAsset(manifestPath, assetId)
  if (!removed) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  await removeGeneratedAssetDirectory(repoRoot, assetId)
  return NextResponse.json({ ok: true, id: assetId })
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const model = form.get('model')
  if (!(model instanceof File)) {
    return NextResponse.json({ error: 'model file is required' }, { status: 400 })
  }
  if (!model.name.toLowerCase().endsWith('.glb')) {
    return NextResponse.json({ error: 'Only .glb files are supported' }, { status: 400 })
  }
  if (model.size <= 0) {
    return NextResponse.json({ error: 'GLB file is empty' }, { status: 400 })
  }
  if (model.size > MAX_GLB_BYTES) {
    return NextResponse.json({ error: 'GLB 文件不能超过 50MB' }, { status: 413 })
  }

  const modelBuffer = Buffer.from(await model.arrayBuffer())
  let inspection: GlbInspection
  try {
    inspection = inspectGlb(modelBuffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `GLB 文件无法解析：${message}` }, { status: 400 })
  }
  const complexityErrors = validateGlbInspection(inspection)
  if (complexityErrors.length > 0) {
    return NextResponse.json(
      {
        error: `GLB 模型过于复杂，请先压缩/减面后再导入。${complexityErrors.join('；')}`,
        inspection,
      },
      { status: 413 },
    )
  }

  const displayName = readText(form.get('name'), assetNameFromFile(model))
  const category = normalizeCatalogCategory(readText(form.get('category'), 'equipment'))
  const repoRoot = await findRepoRoot()
  const assetId = createGeneratedAssetId('imported-glb', displayName)
  const assetDir = path.join(itemRoot(repoRoot), assetId)
  await fs.mkdir(assetDir, { recursive: true })
  await fs.writeFile(path.join(assetDir, 'model.glb'), modelBuffer)
  await fs.writeFile(
    path.join(assetDir, 'imported-glb.json'),
    `${JSON.stringify(
      {
        sourceFileName: model.name,
        sourceFileType: model.type || 'model/gltf-binary',
        sourceFileSize: model.size,
        inspection,
        importedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const asset: AssetInput & { id: string; source: 'mine' } = {
    id: assetId,
    category,
    name: displayName,
    thumbnail: '/icons/cube.png',
    floorPlanUrl: '/icons/cube.png',
    source: 'mine',
    src: `/items/${assetId}/model.glb`,
    dimensions: inspection.dimensions,
    tags: ['floor', 'imported', 'glb', `${inspection.triangles}-triangles`],
  }

  await upsertGeneratedAsset(generatedManifestPath(repoRoot), asset)

  return NextResponse.json({ asset, inspection, savedAt: new Date().toISOString() })
}
