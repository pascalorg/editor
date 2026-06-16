import { type NextRequest, NextResponse } from 'next/server'
import {
  generateImageTo3DAsset,
  ImageTo3DGenerateError,
  maxImageTo3DImageBytes,
  replaceAssetDir,
} from '@/lib/image-to-3d/generate-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export { replaceAssetDir }

function readText(value: FormDataEntryValue | null, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readBool(value: FormDataEntryValue | null, fallback: boolean) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  return fallback
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const image = form.get('image')
  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'image file is required' }, { status: 400 })
  }
  if (image.size > maxImageTo3DImageBytes()) {
    return NextResponse.json({ error: 'Image is too large' }, { status: 413 })
  }

  try {
    const result = await generateImageTo3DAsset({
      image: {
        name: image.name,
        type: image.type,
        buffer: Buffer.from(await image.arrayBuffer()),
      },
      prompt: readText(form.get('prompt'), 'object'),
      displayName: readText(form.get('name'), 'Image to 3D asset'),
      category: readText(form.get('category'), 'equipment'),
      provider: readText(form.get('provider'), process.env.IMAGE_TO_3D_PROVIDER ?? 'fal'),
      save: readBool(form.get('save'), true),
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = error instanceof ImageTo3DGenerateError ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status })
  }
}
