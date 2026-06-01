import { generateFalSam3DObjects } from './fal'
import { generateHunyuan3D } from './hunyuan3d'
import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ImageTo3DProvider } from './types'

export const IMAGE_TO_3D_PROVIDERS: ImageTo3DProvider[] = ['fal', 'hunyuan3d']

export function resolveImageTo3DProvider(value: string | null | undefined): ImageTo3DProvider {
  if (value === 'hunyuan3d') return 'hunyuan3d'
  return 'fal'
}

export async function generateImageTo3D(
  provider: ImageTo3DProvider,
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  if (provider === 'hunyuan3d') return generateHunyuan3D(input)
  return generateFalSam3DObjects(input)
}
