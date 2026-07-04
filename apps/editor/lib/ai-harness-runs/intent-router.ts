import {
  type IndustryPackRequirement,
  type InstalledIndustryPackLike,
  resolveIndustryPackRequirement,
} from './industry-pack-intent-resolver'
import type { AiConversationPurpose, AiHarnessRunMode } from './types'

export type AiIntentRouteKind =
  | 'create-factory'
  | 'create-equipment'
  | 'edit-selected-equipment'
  | 'edit-selected-part'
  | 'bind-live-data'
  | 'create-asset-from-image'
  | 'create-joint-asset'
  | 'generic-geometry'
  | 'ask-or-explain'

export type AiIntentExecutionMode =
  | 'factory'
  | 'primitive'
  | 'image-to-3d'
  | 'articraft'
  | 'data-binding'
  | 'none'

export type AiIntentSelectionScope = {
  nodeIds: readonly string[]
  nodeType?: string
  assemblyId?: string
  semanticRole?: string
  sourcePartKind?: string
}

export type AiIntentRequiredPack = Pick<
  IndustryPackRequirement,
  | 'id'
  | 'version'
  | 'industry'
  | 'label'
  | 'installed'
  | 'installState'
  | 'reason'
  | 'matchedKeyword'
>

export type AiIntentRoute = {
  kind: AiIntentRouteKind
  confidence: number
  prompt: string
  reason: string
  requiresPreview: boolean
  execution: AiIntentExecutionMode
  requiredPack?: AiIntentRequiredPack
  selectionScope?: AiIntentSelectionScope
  blockers: readonly string[]
}

export type AiIntentRouterInput = {
  prompt: string
  imageAttached?: boolean
  generationMode?: AiHarnessRunMode
  conversationPurpose?: AiConversationPurpose
  selection?: AiIntentSelectionScope
  installedPacks?: readonly InstalledIndustryPackLike[]
}

const createIntentPattern = /生成|创建|新建|放置|添加|\bgenerate\b|\bcreate\b|\badd\b|\bplace\b/iu
const editIntentPattern =
  /修改|调整|设置|改成|透明|颜色|液位|功率|流量|尺寸|高度|宽度|长度|\bedit\b|\bset\b|\bchange\b|\bopacity\b|\bcolor\b|\blevel\b|\bpower\b|\bflow\b|\bheight\b|\bwidth\b|\blength\b/iu
const factoryIntentPattern = /工厂|产线|装置区|车间|\bfactory\b|\bplant\b|\bprocess line\b/iu
const knownEquipmentPattern =
  /离心泵|泵|储罐|罐|塔器|蒸馏塔|换热器|压缩机|\bpump\b|\btank\b|\bcolumn\b|\bheat exchanger\b|\bcompressor\b/iu
const imageIntentPattern = /图生|图片|照片|参考图|\bimage\b|\bphoto\b|\bpicture\b/iu
const jointIntentPattern = /关节|骨骼|机械臂|可动资产|\barticulated\b|\bjoint\b|\brig\b/iu
const dataBindingIntentPattern =
  /websocket|数据绑定|绑定.*数据|实时数据|mqtt|opc|\blive data\b|\btelemetry\b/iu
const explainIntentPattern =
  /为什么|是什么|来自哪里|来自哪个|解释|说明|\bwhy\b|\bwhat\b|\bexplain\b/iu

export function routeAiIntent(input: AiIntentRouterInput): AiIntentRoute {
  const prompt = input.prompt.trim()
  const selection = input.selection

  if (!prompt) {
    return route({
      kind: 'ask-or-explain',
      confidence: 0.35,
      prompt,
      reason: 'Prompt is empty; no generation action can be inferred.',
      requiresPreview: false,
      execution: 'none',
    })
  }

  if (
    input.imageAttached ||
    input.generationMode === 'image-to-3d' ||
    imageIntentPattern.test(prompt)
  ) {
    return route({
      kind: 'create-asset-from-image',
      confidence: input.imageAttached ? 0.9 : 0.7,
      prompt,
      reason: 'Prompt or attachment indicates image-to-3D asset creation.',
      requiresPreview: false,
      execution: 'image-to-3d',
    })
  }

  if (input.generationMode === 'articraft' || jointIntentPattern.test(prompt)) {
    return route({
      kind: 'create-joint-asset',
      confidence: 0.82,
      prompt,
      reason: 'Prompt asks for an articulated or jointed asset.',
      requiresPreview: false,
      execution: 'articraft',
    })
  }

  if (dataBindingIntentPattern.test(prompt)) {
    return route({
      kind: 'bind-live-data',
      confidence: 0.86,
      prompt,
      reason: 'Prompt asks to bind live or websocket data to scene objects.',
      requiresPreview: true,
      execution: 'data-binding',
      selectionScope: selection,
      blockers: selection?.nodeIds.length ? [] : ['select-target-node'],
    })
  }

  if (selection?.nodeIds.length && editIntentPattern.test(prompt)) {
    const partScoped = Boolean(selection.semanticRole || selection.sourcePartKind)
    return route({
      kind: partScoped ? 'edit-selected-part' : 'edit-selected-equipment',
      confidence: partScoped ? 0.88 : 0.78,
      prompt,
      reason: partScoped
        ? 'Prompt edits a selected semantic assembly part.'
        : 'Prompt edits the selected equipment node or assembly.',
      requiresPreview: false,
      execution: 'factory',
      selectionScope: selection,
    })
  }

  const packRequirement = resolveIndustryPackRequirement({
    prompt,
    installedPacks: input.installedPacks,
  })
  if (packRequirement || (factoryIntentPattern.test(prompt) && createIntentPattern.test(prompt))) {
    return route({
      kind: 'create-factory',
      confidence: packRequirement ? 0.9 : 0.68,
      prompt,
      reason: packRequirement
        ? `Prompt matches the ${packRequirement.label} industry pack.`
        : 'Prompt asks for factory or process-line generation.',
      requiresPreview: true,
      execution: 'factory',
      requiredPack: packRequirement ?? undefined,
      blockers:
        packRequirement && !packRequirement.installed ? ['install-required-industry-pack'] : [],
    })
  }

  if (knownEquipmentPattern.test(prompt) && createIntentPattern.test(prompt)) {
    return route({
      kind: 'create-equipment',
      confidence: 0.8,
      prompt,
      reason: 'Prompt asks for known industrial equipment.',
      requiresPreview: false,
      execution: 'factory',
    })
  }

  if (explainIntentPattern.test(prompt) && !createIntentPattern.test(prompt)) {
    return route({
      kind: 'ask-or-explain',
      confidence: 0.72,
      prompt,
      reason: 'Prompt is informational rather than a canvas mutation request.',
      requiresPreview: false,
      execution: 'none',
    })
  }

  return route({
    kind: 'generic-geometry',
    confidence:
      input.conversationPurpose === 'asset' || input.generationMode === 'primitive' ? 0.72 : 0.55,
    prompt,
    reason:
      'Prompt does not match an industry pack, known equipment, selected edit, image, joint, or data-binding route.',
    requiresPreview: false,
    execution: 'primitive',
  })
}

function route(
  route: Omit<AiIntentRoute, 'blockers'> & { blockers?: readonly string[] },
): AiIntentRoute {
  return {
    ...route,
    blockers: route.blockers ?? [],
  }
}
