import { buildGenerationPlanPreview, type GenerationPlanPreview } from './generation-plan-preview'
import type { InstalledIndustryPackLike } from './industry-pack-intent-resolver'
import { type AiIntentRoute, type AiIntentSelectionScope, routeAiIntent } from './intent-router'
import type { AiConversationPurpose, AiHarnessRunMode } from './types'

export type AiIntentPreviewRequest = {
  prompt: string
  imageAttached?: boolean
  generationMode?: AiHarnessRunMode
  conversationPurpose?: AiConversationPurpose
  selection?: AiIntentSelectionScope
}

export type AiIntentPreviewResponse = {
  route: AiIntentRoute
  preview: GenerationPlanPreview
}

export function buildAiIntentPreview(input: {
  request: AiIntentPreviewRequest
  installedPacks: readonly InstalledIndustryPackLike[]
  previewId?: string
}): AiIntentPreviewResponse {
  const route = routeAiIntent({
    ...input.request,
    installedPacks: input.installedPacks,
  })
  return {
    route,
    preview: buildGenerationPlanPreview({ route, id: input.previewId }),
  }
}
