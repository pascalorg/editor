import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, draco, prune, simplify, weld } from '@gltf-transform/functions'
import draco3d from 'draco3d'
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'

export const DEFAULT_TARGET_TRIANGLES = 150_000

export type GlbOptimizationResult = {
  buffer: Buffer
  status: 'optimized' | 'skipped' | 'failed'
  originalBytes: number
  finalBytes: number
  targetTriangles: number
  simplifyRatio: number | null
  options: Record<string, unknown>
  warnings: string[]
}

type OptimizeGlbOptions = {
  triangles: number
  targetTriangles?: number
}

async function createOptimizationIO() {
  const [dracoDecoder, dracoEncoder] = await Promise.all([
    draco3d.createDecoderModule(),
    draco3d.createEncoderModule(),
  ])

  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': dracoDecoder,
    'draco3d.encoder': dracoEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
}

function getSimplifyRatio(triangles: number, targetTriangles: number) {
  if (triangles <= targetTriangles) return null
  return Math.max(0.2, Math.min(0.85, targetTriangles / triangles))
}

export async function optimizeImportedGlb(
  input: Buffer,
  { triangles, targetTriangles = DEFAULT_TARGET_TRIANGLES }: OptimizeGlbOptions,
): Promise<GlbOptimizationResult> {
  const originalBytes = input.byteLength
  const simplifyRatio = getSimplifyRatio(triangles, targetTriangles)
  const options = {
    targetTriangles,
    simplifyRatio,
    transforms: ['prune', 'dedup', 'weld', ...(simplifyRatio ? ['simplify'] : []), 'draco'],
  }

  try {
    await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready])

    const io = await createOptimizationIO()
    const document = await io.readBinary(new Uint8Array(input))
    const transforms = [prune(), dedup(), weld()]

    if (simplifyRatio) {
      transforms.push(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: simplifyRatio,
          error: 0.003,
          lockBorder: true,
        }),
      )
    }

    transforms.push(draco({ method: 'edgebreaker', encodeSpeed: 5, decodeSpeed: 5 }))

    await document.transform(...transforms)
    const output = Buffer.from(await io.writeBinary(document))

    if (output.byteLength >= originalBytes && !simplifyRatio) {
      return {
        buffer: input,
        status: 'skipped',
        originalBytes,
        finalBytes: originalBytes,
        targetTriangles,
        simplifyRatio,
        options,
        warnings: ['Optimization was skipped because the compressed GLB was not smaller.'],
      }
    }

    return {
      buffer: output,
      status: 'optimized',
      originalBytes,
      finalBytes: output.byteLength,
      targetTriangles,
      simplifyRatio,
      options,
      warnings: [],
    }
  } catch (error) {
    return {
      buffer: input,
      status: 'failed',
      originalBytes,
      finalBytes: originalBytes,
      targetTriangles,
      simplifyRatio,
      options,
      warnings: [error instanceof Error ? error.message : String(error)],
    }
  }
}
