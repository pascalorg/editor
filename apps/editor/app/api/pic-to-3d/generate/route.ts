import { NextResponse } from 'next/server'
import {
  applyPicTo3DParams,
  loadPic2ThreeWorkflow,
  parsePicTo3DParams,
  patchWorkflowImage,
  queueWorkflow,
  uploadImageToComfy,
} from '@/lib/pic-to-3d/comfyui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('image')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: '画像ファイルをアップロードしてください。' }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: '画像は 20 MB 以下にしてください。' }, { status: 400 })
    }

    const mime = file.type || 'image/jpeg'
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: '画像形式のみ対応しています。' }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const safeName = file.name.replace(/[^\w.\-]+/g, '_') || 'upload.jpg'

    const paramsRaw = form.get('params')
    let workflowParams = parsePicTo3DParams(undefined)
    if (typeof paramsRaw === 'string' && paramsRaw.trim()) {
      try {
        workflowParams = parsePicTo3DParams(JSON.parse(paramsRaw))
      } catch {
        return NextResponse.json({ error: 'params が有効な JSON ではありません。' }, { status: 400 })
      }
    }

    const imageName = await uploadImageToComfy(safeName, bytes, mime)
    let workflow = await loadPic2ThreeWorkflow()
    workflow = patchWorkflowImage(workflow, imageName)
    workflow = applyPicTo3DParams(workflow, workflowParams)
    const promptId = await queueWorkflow(workflow)

    return NextResponse.json({
      ok: true,
      promptId,
      imageName,
      appliedParams: workflowParams,
      message: 'ComfyUI（混元 3D 2.1）に送信しました。生成完了までお待ちください。',
    })
  } catch (error) {
    console.error('[pic-to-3d] generate failed:', error)
    const message =
      error instanceof Error ? error.message : '生成タスクの送信に失敗しました。ComfyUI が起動し、ネットワークに到達できるか確認してください。'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
