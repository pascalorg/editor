import type { CreateIntent } from './geometry-intent'

export type ComponentIntentBlueprintPart = {
  id?: string
  kind?: string
  semanticRole?: string
  count?: number
  dimensions?: Record<string, unknown>
}

export type ComponentIntentBlueprint = {
  route?: string
  category?: string
  constraints?: Record<string, unknown>
  parts?: ComponentIntentBlueprintPart[]
  requiredRoles?: string[]
}

function normalizedText(value: unknown) {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s-]+/g, '_')
        .toLowerCase()
    : ''
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function promptQuantity(prompt: string): number | undefined {
  const text = prompt.toLowerCase()
  if (
    /\b(a|an|one|single)\b/.test(text) ||
    /\u4e00\u4e2a|\u4e00\u53ea|\u5355\u4e2a|\u53ea\u8981\u4e00/.test(prompt)
  ) {
    return 1
  }
  if (
    /\b(pair|two)\b/.test(text) ||
    /\u4e00\u5bf9|\u4e24\u4e2a|\u4e24\u53ea|\u4e8c\u4e2a/.test(prompt)
  ) {
    return 2
  }
  if (/\b(four)\b/.test(text) || /\u56db\u4e2a|\u56db\u53ea/.test(prompt)) return 4
  return undefined
}

function promptArrangement(prompt: string): CreateIntent['arrangement'] {
  const quantity = promptQuantity(prompt)
  if (quantity === 1) return 'single'
  if (quantity === 2) return 'pair'
  if (quantity != null && quantity > 2) return 'array'
  return 'single'
}

function arrangementForQuantity(quantity: number, prompt: string): CreateIntent['arrangement'] {
  if (quantity === 1) return 'single'
  if (quantity === 2) return 'pair'
  if (quantity > 2) return 'array'
  return promptArrangement(prompt)
}

function inferComponentFamily(text: string, prompt: string): string {
  if (
    /aircraft|airplane|airliner|plane|jet|boeing|airbus/.test(text) ||
    /\u98de\u673a|\u5ba2\u673a|\u6ce2\u97f3|\u7a7a\u5ba2|\u55b7\u6c14/.test(prompt)
  ) {
    return 'aircraft'
  }
  if (
    /bicycle|bike|cycle/.test(text) ||
    /\u81ea\u884c\u8f66|\u5355\u8f66|\u811a\u8e0f\u8f66/.test(prompt)
  ) {
    return 'bicycle'
  }
  if (
    /vehicle|car|auto|automobile|sedan|suv|truck|van/.test(text) ||
    /\u6c7d\u8f66|\u8f66\u8f86|\u8f7f\u8f66|\u5361\u8f66/.test(prompt)
  ) {
    return 'vehicle'
  }
  return 'generic'
}

function blueprintIdentityText(blueprint: ComponentIntentBlueprint) {
  const partText = (blueprint.parts ?? [])
    .map((part) =>
      [normalizedText(part.id), normalizedText(part.kind), normalizedText(part.semanticRole)].join(
        ' ',
      ),
    )
    .join(' ')
  const requiredRoles = (blueprint.requiredRoles ?? []).map(normalizedText).join(' ')
  return [normalizedText(blueprint.category), partText, requiredRoles].filter(Boolean).join(' ')
}

function blueprintText(blueprint: ComponentIntentBlueprint, userPrompt: string) {
  return [blueprintIdentityText(blueprint), userPrompt.toLowerCase()].filter(Boolean).join(' ')
}

function inferComponentFromBlueprint(
  blueprint: ComponentIntentBlueprint | null | undefined,
  userPrompt: string,
) {
  if (!blueprint || !['compose_parts', 'compose_primitive'].includes(blueprint.route ?? '')) {
    return undefined
  }
  const partCount = blueprint.parts?.length ?? 0
  const requiredRoleCount = blueprint.requiredRoles?.length ?? 0
  const category = normalizedText(blueprint.category)
  const explicitlyComponent = /(^|_)component($|_)/.test(category)
  if (!explicitlyComponent && (partCount > 2 || requiredRoleCount > 2)) return undefined
  const text = blueprintIdentityText(blueprint)
  const has = (pattern: RegExp) => pattern.test(text)

  if (has(/wheel|tire|tyre|rim|\u8f6e\u5b50|\u8f66\u8f6e|\u8f6e\u80ce|\u8f6e\u6bc2/)) {
    return 'wheel'
  }
  if (has(/door|\u8f66\u95e8|\u95e8/)) return 'door'
  if (has(/mirror|rear[_\s-]?view|\u540e\u89c6\u955c|\u955c\u5b50/)) return 'mirror'
  if (has(/engine|motor|nacelle|\u53d1\u52a8\u673a|\u5f15\u64ce|\u7535\u673a|\u9a6c\u8fbe/)) {
    return 'engine'
  }
  if (has(/propeller|airscrew|\u87ba\u65cb\u6868/)) return 'propeller'
  if (has(/blade|airfoil|fan[_\s-]?blade|\u53f6\u7247|\u6868\u53f6|\u7ffc\u578b/)) {
    return 'blade'
  }
  if (has(/window|windshield|glass|\u7a97|\u8f66\u7a97|\u6321\u98ce\u73bb\u7483/)) {
    return 'window'
  }
  return undefined
}

export function inferCreateIntentFromBlueprint(
  toolName: string,
  args: Record<string, unknown>,
  blueprint: ComponentIntentBlueprint | null | undefined,
  userPrompt: string,
): CreateIntent | undefined {
  if (toolName !== 'compose_parts') return undefined
  if (args.geometryIntent != null) return undefined
  const component = inferComponentFromBlueprint(blueprint, userPrompt)
  if (!component) return undefined

  const part = blueprint?.parts?.[0]
  const text = blueprintText(blueprint!, userPrompt)
  const family = inferComponentFamily(text, userPrompt)
  const constraints = { ...(blueprint?.constraints ?? {}) }
  if (part?.dimensions) Object.assign(constraints, part.dimensions)
  const quantity = positiveInteger(part?.count) ?? promptQuantity(userPrompt) ?? 1

  return {
    action: 'create',
    scope: 'component',
    family,
    component,
    quantity,
    arrangement: arrangementForQuantity(quantity, userPrompt),
    constraints,
  }
}
