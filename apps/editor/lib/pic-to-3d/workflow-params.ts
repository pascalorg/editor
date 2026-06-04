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
  /** Values below 0 use a random seed each time. */
  seed: number
  steps: number
  cfg: number
  denoise: number
  samplerName: string
  latentResolution: number
  numChunks: number
  octreeResolution: number
  modelShift: number
  /** VoxelToMesh output is used by SaveGLB. */
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
    label: 'Standard (low poly <1MB)',
    description: 'Matches the pic2threeAPI.json workflow. Good for the furniture catalog.',
    params: { ...PIC_TO3D_DEFAULT_PARAMS },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Slightly higher voxel and step settings with a moderate polygon count.',
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
    label: 'High Detail',
    description: 'Raises octree resolution and steps for more detail. Medium runtime.',
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
    label: 'Ultra Detail',
    description: 'Highest voxel and mesh settings. Slowest and largest output; use for final assets.',
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
    label: 'Quick',
    description: 'Lower step and voxel settings for drafts and composition checks.',
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
  if (!node) throw new Error(`Workflow is missing node ${id}`)
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
    title: 'Sampling (node 3 - KSampler)',
    fields: [
      { key: 'seed', label: 'Seed', hint: '-1 = random each time' },
      { key: 'steps', label: 'Steps', hint: 'More steps are slower and may add detail.' },
      { key: 'cfg', label: 'CFG', hint: 'Classifier-free guidance strength.' },
      { key: 'denoise', label: 'Denoise', hint: '0 to 1' },
      { key: 'samplerName', label: 'Sampler', hint: 'For example: euler' },
    ],
  },
  {
    id: 'latent',
    title: 'Voxel latent (nodes 66 / 61)',
    fields: [
      { key: 'latentResolution', label: 'Latent resolution', hint: 'EmptyLatentHunyuan3Dv2' },
      { key: 'numChunks', label: 'Num chunks', hint: 'VAEDecodeHunyuan3D' },
      { key: 'octreeResolution', label: 'Octree resolution', hint: 'Voxel octree precision.' },
    ],
  },
  {
    id: 'mesh',
    title: 'Mesh (node 81 - VoxelToMesh -> SaveGLB)',
    fields: [
      { key: 'meshAlgorithm', label: 'Algorithm', hint: 'For example: surface net' },
      { key: 'meshThreshold', label: 'Mesh threshold', hint: 'Lower values create a fuller mesh.' },
      { key: 'meshBasicThreshold', label: 'Mesh basic threshold', hint: 'Node 62, adjusted with node 81.' },
      { key: 'glbFilenamePrefix', label: 'GLB filename prefix', hint: 'SaveGLB node 82' },
    ],
  },
  {
    id: 'preprocess',
    title: 'Preprocessing and Other',
    fields: [
      { key: 'removeBackground', label: 'Remove background', hint: 'When disabled, the original image goes directly into CLIP.' },
      { key: 'remBgMode', label: 'Background removal mode', hint: 'easy imageRemBg' },
      { key: 'remBgBackground', label: 'Background fill', hint: 'For example: white' },
      { key: 'modelShift', label: 'Model shift', hint: 'Node 70 AuraFlow' },
      { key: 'checkpointName', label: 'Checkpoint', hint: 'Node 54 checkpoint file name' },
    ],
  },
] as const
