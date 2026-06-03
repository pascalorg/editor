import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** ComfyUI on LAN — default matches pic-to-3D/run_pic2three.py */
export const COMFYUI_BASE_URL = 'http://192.168.100.250:8188'

export const LOAD_IMAGE_NODE_ID = '56'

export type GlbOutputRef = {
  filename: string
  subfolder: string
  type: string
}

type ComfyWorkflow = Record<
  string,
  {
    inputs: Record<string, unknown>
    class_type: string
  }
>

async function comfyFetch(
  comfyPath: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${COMFYUI_BASE_URL}${comfyPath}`, {
      ...rest,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function loadPic2ThreeWorkflow(): Promise<ComfyWorkflow> {
  const workflowPath = path.join(process.cwd(), '../../pic-to-3D/pic2threeAPI.json')
  const raw = await readFile(workflowPath, 'utf8')
  return JSON.parse(raw) as ComfyWorkflow
}

export async function uploadImageToComfy(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const boundary = `----ComfyUIBoundary${randomUUID().replace(/-/g, '')}`
  const parts: Uint8Array[] = []

  const enc = new TextEncoder()
  parts.push(
    enc.encode(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    ),
  )
  parts.push(bytes)
  parts.push(
    enc.encode(
      `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="overwrite"\r\n\r\n' +
        'true\r\n',
    ),
  )
  parts.push(
    enc.encode(
      `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="type"\r\n\r\n' +
        'input\r\n' +
        `--${boundary}--\r\n`,
    ),
  )

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const body = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    body.set(part, offset)
    offset += part.length
  }

  const response = await comfyFetch('/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    timeoutMs: 60_000,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`ComfyUI upload failed (${response.status}): ${text}`)
  }

  const uploaded = (await response.json()) as { name: string; subfolder?: string }
  if (uploaded.subfolder) {
    return `${uploaded.subfolder}/${uploaded.name}`
  }
  return uploaded.name
}

export function patchWorkflowImage(workflow: ComfyWorkflow, imageName: string): ComfyWorkflow {
  const prompt = structuredClone(workflow)
  const node = prompt[LOAD_IMAGE_NODE_ID]
  if (!node) {
    throw new Error(`Workflow missing LoadImage node ${LOAD_IMAGE_NODE_ID}`)
  }
  node.inputs.image = imageName
  return prompt
}

export type { PicTo3DParams } from './workflow-params'
export {
  applyPicTo3DParams,
  parsePicTo3DParams,
  PIC_TO3D_DEFAULT_PARAMS,
  PIC_TO3D_PARAM_GROUPS,
  PIC_TO3D_PRESETS,
  PIC2THREE_NODES,
} from './workflow-params'

export async function queueWorkflow(prompt: ComfyWorkflow): Promise<string> {
  const clientId = randomUUID()
  const response = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
    timeoutMs: 30_000,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`ComfyUI queue failed (${response.status}): ${text}`)
  }

  const body = (await response.json()) as { prompt_id?: string }
  if (!body.prompt_id) {
    throw new Error('ComfyUI did not return prompt_id')
  }
  return body.prompt_id
}

export async function fetchPromptHistory(promptId: string): Promise<Record<string, unknown> | null> {
  const response = await comfyFetch(`/history/${promptId}`, { timeoutMs: 30_000 })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`ComfyUI history failed (${response.status}): ${text}`)
  }
  const history = (await response.json()) as Record<string, Record<string, unknown>>
  return history[promptId] ?? null
}

export function collectGlbOutputs(value: unknown): GlbOutputRef[] {
  const found: GlbOutputRef[] = []
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const filename = record.filename
    if (typeof filename === 'string' && filename.toLowerCase().endsWith('.glb')) {
      found.push({
        filename,
        subfolder: typeof record.subfolder === 'string' ? record.subfolder : '',
        type: typeof record.type === 'string' ? record.type : 'output',
      })
    }
    for (const child of Object.values(record)) {
      found.push(...collectGlbOutputs(child))
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      found.push(...collectGlbOutputs(child))
    }
  }
  return found
}

export function parseHistoryStatus(record: Record<string, unknown>): {
  state: 'pending' | 'complete' | 'error'
  glb?: GlbOutputRef
  error?: string
} {
  const status = record.status as { status_str?: string; messages?: unknown[] } | undefined
  if (status?.status_str === 'error') {
    return {
      state: 'error',
      error: JSON.stringify(status.messages ?? 'ComfyUI prompt failed'),
    }
  }

  const outputs = record.outputs as Record<string, unknown> | undefined
  const glbs = collectGlbOutputs(outputs)
  if (glbs.length > 0) {
    return { state: 'complete', glb: glbs[glbs.length - 1] }
  }

  if (outputs && Object.keys(outputs).length > 0) {
    return { state: 'error', error: 'タスクは完了しましたが .glb 出力が見つかりません' }
  }

  return { state: 'pending' }
}

export async function downloadGlbFromComfy(ref: GlbOutputRef): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder,
    type: ref.type,
  })
  const response = await comfyFetch(`/view?${params.toString()}`, { timeoutMs: 120_000 })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`ComfyUI download failed (${response.status}): ${text}`)
  }
  return response.arrayBuffer()
}
