import type { AssetInput } from '@pascal-app/core'

type GeneratedModelEquipmentFamily = 'pump' | 'tank' | 'conveyor' | 'fan' | 'robot' | 'cabinet'

type GeneratedModelEquipmentPort = {
  id: string
  medium?: string
  side?: string
}

type GeneratedModelEquipmentContract = {
  profileId: string
  equipmentFamily: GeneratedModelEquipmentFamily
  primarySemanticRole: string
  confidence: number
  source: 'generated-model-recognition'
  envelope?: {
    length: number
    width: number
    height: number
  }
  ports?: GeneratedModelEquipmentPort[]
  editableParams?: Array<{
    key: string
    label: string
    kind: 'number' | 'enum' | 'boolean'
  }>
}

type GeneratedModelEquipmentMetadata = {
  semanticType: GeneratedModelEquipmentFamily
  equipmentContract: GeneratedModelEquipmentContract
}

type FamilyPattern = {
  family: GeneratedModelEquipmentFamily
  terms: RegExp
  profileId: string
  primarySemanticRole: string
  ports?: GeneratedModelEquipmentPort[]
  editableParams?: GeneratedModelEquipmentContract['editableParams']
}

const FAMILY_PATTERNS: FamilyPattern[] = [
  {
    family: 'pump',
    terms: /\b(pump|centrifugal|泵|离心泵|水泵)\b/i,
    profileId: 'generated-model.pump',
    primarySemanticRole: 'pump_body',
    ports: [
      { id: 'inlet', medium: 'fluid', side: 'west' },
      { id: 'outlet', medium: 'fluid', side: 'east' },
    ],
  },
  {
    family: 'tank',
    terms: /\b(tank|vessel|storage|罐|储罐|容器)\b/i,
    profileId: 'generated-model.tank',
    primarySemanticRole: 'vessel_shell',
    ports: [
      { id: 'inlet', medium: 'fluid', side: 'top' },
      { id: 'outlet', medium: 'fluid', side: 'bottom' },
    ],
    editableParams: [{ key: 'liquidLevel', label: 'Liquid level', kind: 'number' }],
  },
  {
    family: 'conveyor',
    terms: /\b(conveyor|belt|输送机|传送带|皮带机)\b/i,
    profileId: 'generated-model.conveyor',
    primarySemanticRole: 'belt_surface',
    ports: [
      { id: 'infeed', medium: 'material', side: 'west' },
      { id: 'outfeed', medium: 'material', side: 'east' },
    ],
  },
  {
    family: 'fan',
    terms: /\b(fan|blower|风机|风扇|鼓风机)\b/i,
    profileId: 'generated-model.fan',
    primarySemanticRole: 'fan_body',
    ports: [
      { id: 'air-inlet', medium: 'air', side: 'west' },
      { id: 'air-outlet', medium: 'air', side: 'east' },
    ],
  },
  {
    family: 'robot',
    terms: /\b(robot|robotic|机械臂|机器人)\b/i,
    profileId: 'generated-model.robot',
    primarySemanticRole: 'robot_base',
  },
  {
    family: 'cabinet',
    terms: /\b(cabinet|panel|electrical|control|配电柜|控制柜|电柜)\b/i,
    profileId: 'generated-model.cabinet',
    primarySemanticRole: 'electrical_cabinet',
    ports: [{ id: 'power', medium: 'power', side: 'bottom' }],
  },
]

function textOf(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function recognitionText(input: { asset: AssetInput; prompt: string }) {
  return [
    textOf(input.asset.name),
    textOf(input.asset.category),
    ...(Array.isArray(input.asset.tags) ? input.asset.tags.map(textOf) : []),
    input.prompt,
  ]
    .filter(Boolean)
    .join(' ')
}

function envelopeFromAsset(asset: AssetInput): GeneratedModelEquipmentContract['envelope'] {
  const dimensions = Array.isArray(asset.dimensions) ? asset.dimensions : []
  const length = Number(dimensions[0])
  const height = Number(dimensions[1])
  const width = Number(dimensions[2])
  if (![length, width, height].every(Number.isFinite)) return undefined
  return {
    length,
    width,
    height,
  }
}

export function recognizeGeneratedModelEquipment(input: {
  asset: AssetInput
  prompt: string
}): GeneratedModelEquipmentMetadata | null {
  const text = recognitionText(input)
  const pattern = FAMILY_PATTERNS.find((item) => item.terms.test(text))
  if (!pattern) return null

  const envelope = envelopeFromAsset(input.asset)
  const contract: GeneratedModelEquipmentContract = {
    profileId: pattern.profileId,
    equipmentFamily: pattern.family,
    primarySemanticRole: pattern.primarySemanticRole,
    confidence: 0.72,
    source: 'generated-model-recognition',
    ...(envelope ? { envelope } : {}),
    ...(pattern.ports ? { ports: pattern.ports } : {}),
    ...(pattern.editableParams ? { editableParams: pattern.editableParams } : {}),
  }

  return {
    semanticType: pattern.family,
    equipmentContract: contract,
  }
}
