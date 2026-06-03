/** ComfyUI node ids in pic2threeAPI.json */
export const PIC2THREE_NODES = {
  ksampler: '3',
  clipVision: '51',
  checkpoint: '54',
  loadImage: '56',
  vaeDecode: '61',
  meshBasic: '62',
  latent: '66',
  modelSampling: '70',
  conditioning: '80',
  mesh: '81',
  saveGlb: '82',
  remBg: '99',
} as const

export type PicTo3DParams = {
  /** < 0 表示每次随机 */
  seed: number
  steps: number
  cfg: number
  denoise: number
  samplerName: string
  latentResolution: number
  numChunks: number
  octreeResolution: number
  modelShift: number
  /** VoxelToMesh（SaveGLB 使用此节点输出） */
  meshAlgorithm: string
  meshThreshold: number
  meshBasicThreshold: number
  removeBackground: boolean
  remBgMode: string
  remBgBackground: string
  checkpointName: string
  glbFilenamePrefix: string
}

export const PIC_TO3D_DEFAULT_PARAMS: PicTo3DParams = {
  seed: -1,
  steps: 20,
  cfg: 8,
  denoise: 1,
  samplerName: 'euler',
  latentResolution: 1536,
  numChunks: 4000,
  octreeResolution: 128,
  modelShift: 1,
  meshAlgorithm: 'surface net',
  meshThreshold: 0.6,
  meshBasicThreshold: 0.6,
  removeBackground: true,
  remBgMode: 'Inspyrenet',
  remBgBackground: 'white',
  checkpointName: 'hunyuan_3d_v2.1.safetensors',
  glbFilenamePrefix: 'mesh/ComfyUI_lowpoly_500-5k_under1MB',
}

export type PicTo3DPreset = {
  id: string
  label: string
  description: string
  params: PicTo3DParams
}

export const PIC_TO3D_PRESETS: PicTo3DPreset[] = [
  {
    id: 'default',
    label: '標準（低ポリ <1MB）',
    description: 'ワークフロー pic2threeAPI.json と同じ設定。家具カタログ向け。',
    params: { ...PIC_TO3D_DEFAULT_PARAMS },
  },
  {
    id: 'balanced',
    label: 'バランス',
    description: 'ボクセルとステップをやや上げ、ポリゴン数は中程度。',
    params: {
      ...PIC_TO3D_DEFAULT_PARAMS,
      steps: 24,
      octreeResolution: 160,
      numChunks: 5000,
      meshThreshold: 0.55,
      meshBasicThreshold: 0.55,
      glbFilenamePrefix: 'mesh/ComfyUI_balanced',
    },
  },
  {
    id: 'detail',
    label: '高精細',
    description: 'オクトリーとステップを上げ、標準より細部が出ます。所要時間は中程度。',
    params: {
      ...PIC_TO3D_DEFAULT_PARAMS,
      steps: 28,
      cfg: 7.5,
      latentResolution: 1536,
      octreeResolution: 192,
      numChunks: 6000,
      meshThreshold: 0.5,
      meshBasicThreshold: 0.5,
      glbFilenamePrefix: 'mesh/ComfyUI_detail',
    },
  },
  {
    id: 'ultra',
    label: '最高精細',
    description: 'ボクセル・メッシュを最大寄り。最も遅く、ポリゴン・ファイルも最大。最終出力向け。',
    params: {
      ...PIC_TO3D_DEFAULT_PARAMS,
      steps: 32,
      cfg: 7,
      latentResolution: 1536,
      octreeResolution: 224,
      numChunks: 8000,
      meshThreshold: 0.45,
      meshBasicThreshold: 0.45,
      glbFilenamePrefix: 'mesh/ComfyUI_ultra',
    },
  },
  {
    id: 'fast',
    label: 'クイック',
    description: 'ステップとボクセルを下げ、試作・構図確認用。',
    params: {
      ...PIC_TO3D_DEFAULT_PARAMS,
      steps: 12,
      octreeResolution: 96,
      numChunks: 2500,
      meshThreshold: 0.65,
      meshBasicThreshold: 0.65,
      glbFilenamePrefix: 'mesh/ComfyUI_fast',
    },
  },
]

type ComfyWorkflow = Record<
  string,
  {
    inputs: Record<string, unknown>
    class_type: string
  }
>

function requireNode(workflow: ComfyWorkflow, id: string): { inputs: Record<string, unknown> } {
  const node = workflow[id]
  if (!node) throw new Error(`工作流缺少节点 ${id}`)
  return node
}

export function parsePicTo3DParams(input: unknown): PicTo3DParams {
  if (!input || typeof input !== 'object') {
    return { ...PIC_TO3D_DEFAULT_PARAMS }
  }
  const raw = input as Record<string, unknown>
  const base = { ...PIC_TO3D_DEFAULT_PARAMS }

  const num = (key: keyof PicTo3DParams, fallback: number) => {
    const v = raw[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const str = (key: keyof PicTo3DParams, fallback: string) => {
    const v = raw[key]
    return typeof v === 'string' && v.trim() ? v.trim() : fallback
  }
  const bool = (key: keyof PicTo3DParams, fallback: boolean) => {
    const v = raw[key]
    return typeof v === 'boolean' ? v : fallback
  }

  return {
    seed: num('seed', base.seed),
    steps: Math.max(1, Math.min(60, Math.round(num('steps', base.steps)))),
    cfg: Math.max(1, Math.min(20, num('cfg', base.cfg))),
    denoise: Math.max(0, Math.min(1, num('denoise', base.denoise))),
    samplerName: str('samplerName', base.samplerName),
    latentResolution: Math.max(512, Math.min(2048, Math.round(num('latentResolution', base.latentResolution)))),
    numChunks: Math.max(500, Math.min(12000, Math.round(num('numChunks', base.numChunks)))),
    octreeResolution: Math.max(64, Math.min(256, Math.round(num('octreeResolution', base.octreeResolution)))),
    modelShift: num('modelShift', base.modelShift),
    meshAlgorithm: str('meshAlgorithm', base.meshAlgorithm),
    meshThreshold: Math.max(0.1, Math.min(0.95, num('meshThreshold', base.meshThreshold))),
    meshBasicThreshold: Math.max(0.1, Math.min(0.95, num('meshBasicThreshold', base.meshBasicThreshold))),
    removeBackground: bool('removeBackground', base.removeBackground),
    remBgMode: str('remBgMode', base.remBgMode),
    remBgBackground: str('remBgBackground', base.remBgBackground),
    checkpointName: str('checkpointName', base.checkpointName),
    glbFilenamePrefix: str('glbFilenamePrefix', base.glbFilenamePrefix),
  }
}

export function applyPicTo3DParams(workflow: ComfyWorkflow, params: PicTo3DParams): ComfyWorkflow {
  const prompt = structuredClone(workflow) as ComfyWorkflow

  const seed =
    params.seed < 0
      ? Math.floor(Math.random() * 9_000_000_000_000_000) + 1
      : Math.floor(params.seed)

  const ksampler = requireNode(prompt, PIC2THREE_NODES.ksampler)
  ksampler.inputs.seed = seed
  ksampler.inputs.steps = params.steps
  ksampler.inputs.cfg = params.cfg
  ksampler.inputs.denoise = params.denoise
  ksampler.inputs.sampler_name = params.samplerName

  const latent = requireNode(prompt, PIC2THREE_NODES.latent)
  latent.inputs.resolution = params.latentResolution

  const vaeDecode = requireNode(prompt, PIC2THREE_NODES.vaeDecode)
  vaeDecode.inputs.num_chunks = params.numChunks
  vaeDecode.inputs.octree_resolution = params.octreeResolution

  const modelSampling = requireNode(prompt, PIC2THREE_NODES.modelSampling)
  modelSampling.inputs.shift = params.modelShift

  const mesh = requireNode(prompt, PIC2THREE_NODES.mesh)
  mesh.inputs.algorithm = params.meshAlgorithm
  mesh.inputs.threshold = params.meshThreshold

  const meshBasic = requireNode(prompt, PIC2THREE_NODES.meshBasic)
  meshBasic.inputs.threshold = params.meshBasicThreshold

  const saveGlb = requireNode(prompt, PIC2THREE_NODES.saveGlb)
  saveGlb.inputs.filename_prefix = params.glbFilenamePrefix

  const checkpoint = requireNode(prompt, PIC2THREE_NODES.checkpoint)
  checkpoint.inputs.ckpt_name = params.checkpointName

  const clipVision = requireNode(prompt, PIC2THREE_NODES.clipVision)
  if (params.removeBackground) {
    const remBg = requireNode(prompt, PIC2THREE_NODES.remBg)
    remBg.inputs.rem_mode = params.remBgMode
    remBg.inputs.add_background = params.remBgBackground
    clipVision.inputs.image = [PIC2THREE_NODES.remBg, 0]
  } else {
    clipVision.inputs.image = [PIC2THREE_NODES.loadImage, 0]
  }

  return prompt
}

export const PIC_TO3D_PARAM_GROUPS = [
  {
    id: 'sampler',
    title: '采样（节点 3 · KSampler）',
    fields: [
      { key: 'seed', label: 'Seed', hint: '-1 = 每次随机' },
      { key: 'steps', label: 'Steps', hint: '步数，越大越慢、细节可能更多' },
      { key: 'cfg', label: 'CFG', hint: '分类器引导强度' },
      { key: 'denoise', label: 'Denoise', hint: '0–1' },
      { key: 'samplerName', label: 'Sampler', hint: '如 euler' },
    ],
  },
  {
    id: 'latent',
    title: '体素 latent（节点 66 / 61）',
    fields: [
      { key: 'latentResolution', label: 'Latent resolution', hint: 'EmptyLatentHunyuan3Dv2' },
      { key: 'numChunks', label: 'Num chunks', hint: 'VAEDecodeHunyuan3D' },
      { key: 'octreeResolution', label: 'Octree resolution', hint: '体素八叉树精度' },
    ],
  },
  {
    id: 'mesh',
    title: '网格（节点 81 · VoxelToMesh → SaveGLB）',
    fields: [
      { key: 'meshAlgorithm', label: 'Algorithm', hint: '如 surface net' },
      { key: 'meshThreshold', label: 'Mesh threshold', hint: '越小网格越“满”' },
      { key: 'meshBasicThreshold', label: 'Mesh basic threshold', hint: '节点 62，与 81 同步调' },
      { key: 'glbFilenamePrefix', label: 'GLB 文件名前缀', hint: 'SaveGLB 节点 82' },
    ],
  },
  {
    id: 'preprocess',
    title: '预处理与其它',
    fields: [
      { key: 'removeBackground', label: '抠图', hint: '关闭则直接用原图进 CLIP' },
      { key: 'remBgMode', label: '抠图模式', hint: 'easy imageRemBg' },
      { key: 'remBgBackground', label: '抠图背景', hint: '如 white' },
      { key: 'modelShift', label: 'Model shift', hint: '节点 70 AuraFlow' },
      { key: 'checkpointName', label: 'Checkpoint', hint: '节点 54 权重文件名' },
    ],
  },
] as const
