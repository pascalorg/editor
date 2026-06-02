import { generateFalImageTo3D } from './fal'
import { generateHunyuan3D } from './hunyuan3d'
import { generateTripo3D } from './tripo'
import type { GenerateImageTo3DInput, GenerateImageTo3DResult, ImageTo3DProvider } from './types'

export const IMAGE_TO_3D_PROVIDERS: ImageTo3DProvider[] = ['fal', 'hunyuan3d', 'tripo']

export function resolveImageTo3DProvider(value: string | null | undefined): ImageTo3DProvider {
  if (value === 'hunyuan3d') return 'hunyuan3d'
  if (value === 'tripo') return 'tripo'
  return 'fal'
}

export async function generateImageTo3D(
  provider: ImageTo3DProvider,
  input: GenerateImageTo3DInput,
): Promise<GenerateImageTo3DResult> {
  if (provider === 'hunyuan3d') return generateHunyuan3D(input)
  if (provider === 'tripo') return generateTripo3D(input)
  return generateFalImageTo3D(input)
}
