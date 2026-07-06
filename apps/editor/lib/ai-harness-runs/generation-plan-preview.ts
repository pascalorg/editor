import type { AiIntentRoute } from './intent-router'

export type GenerationPlanApplyMode = 'direct' | 'confirm' | 'blocked'
export type GenerationPlanCanvasImpact = 'none' | 'low' | 'medium' | 'high'
export type GenerationPlanStepStatus = 'ready' | 'blocked' | 'info'

export type GenerationPlanStep = {
  id: string
  label: string
  status: GenerationPlanStepStatus
  detail: string
}

export type GenerationPlanPreview = {
  id: string
  routeKind: AiIntentRoute['kind']
  execution: AiIntentRoute['execution']
  applyMode: GenerationPlanApplyMode
  canvasImpact: GenerationPlanCanvasImpact
  summary: string
  blockers: readonly string[]
  steps: readonly GenerationPlanStep[]
  requiredPack?: AiIntentRoute['requiredPack']
  selectedNodeIds: readonly string[]
}

export function buildGenerationPlanPreview(input: {
  route: AiIntentRoute
  id?: string
}): GenerationPlanPreview {
  const route = input.route
  const blockers = route.blockers
  const applyMode: GenerationPlanApplyMode = blockers.length
    ? 'blocked'
    : route.requiresPreview
      ? 'confirm'
      : 'direct'

  return {
    id: input.id ?? stablePreviewId(route),
    routeKind: route.kind,
    execution: route.execution,
    applyMode,
    canvasImpact: canvasImpactForRoute(route),
    summary: summaryForRoute(route, applyMode),
    blockers,
    steps: stepsForRoute(route),
    requiredPack: route.requiredPack,
    selectedNodeIds: route.selectionScope?.nodeIds ?? [],
  }
}

function canvasImpactForRoute(route: AiIntentRoute): GenerationPlanCanvasImpact {
  switch (route.kind) {
    case 'create-factory':
      return 'high'
    case 'create-equipment':
    case 'create-asset-from-image':
    case 'create-joint-asset':
    case 'generic-geometry':
      return 'medium'
    case 'edit-selected-equipment':
    case 'edit-selected-part':
    case 'bind-live-data':
      return 'low'
    case 'ask-or-explain':
      return 'none'
  }
}

function summaryForRoute(route: AiIntentRoute, applyMode: GenerationPlanApplyMode) {
  if (applyMode === 'blocked') {
    if (route.requiredPack && !route.requiredPack.installed) {
      return `Install ${route.requiredPack.id}@${route.requiredPack.version} before generating ${route.requiredPack.label}.`
    }
    return 'This request has blockers that must be resolved before applying changes.'
  }

  switch (route.kind) {
    case 'create-factory':
      return route.requiredPack
        ? `Generate a factory from ${route.requiredPack.label} industry pack after preview confirmation.`
        : 'Generate a factory/process-line plan after preview confirmation.'
    case 'create-equipment':
      return 'Create semantic industrial equipment from a constrained recipe.'
    case 'edit-selected-equipment':
      return 'Edit selected equipment parameters without rebuilding the whole scene.'
    case 'edit-selected-part':
      return 'Edit selected semantic assembly part.'
    case 'bind-live-data':
      return 'Bind live data to selected scene objects.'
    case 'create-asset-from-image':
      return 'Create a 3D asset from the attached or referenced image.'
    case 'create-joint-asset':
      return 'Create an articulated asset with joint metadata.'
    case 'generic-geometry':
      return 'Create freeform primitive geometry as a generic asset.'
    case 'ask-or-explain':
      return 'Answer the request without changing the canvas.'
  }
}

function stepsForRoute(route: AiIntentRoute): readonly GenerationPlanStep[] {
  if (route.kind === 'create-factory') {
    return [
      {
        id: 'classify-intent',
        label: 'Classify factory intent',
        status: 'ready',
        detail: route.reason,
      },
      {
        id: 'check-pack',
        label: 'Check industry pack',
        status: route.requiredPack && !route.requiredPack.installed ? 'blocked' : 'ready',
        detail: route.requiredPack
          ? route.requiredPack.reason
          : 'No specific industry pack was required by the prompt.',
      },
      {
        id: 'resolve-template',
        label: 'Resolve process template',
        status: route.requiredPack && !route.requiredPack.installed ? 'blocked' : 'ready',
        detail:
          'Use the installed pack to resolve process templates, equipment recipes, ports, and quality rules.',
      },
      {
        id: 'preview-canvas-impact',
        label: 'Preview canvas impact',
        status: route.requiredPack && !route.requiredPack.installed ? 'blocked' : 'ready',
        detail:
          'Show stations, semantic assemblies, routes, and expected quality report before applying.',
      },
    ]
  }

  if (route.kind === 'edit-selected-equipment' || route.kind === 'edit-selected-part') {
    return [
      {
        id: 'read-selection',
        label: 'Read selection',
        status: route.selectionScope?.nodeIds.length ? 'ready' : 'blocked',
        detail: route.selectionScope?.nodeIds.length
          ? `Selected ${route.selectionScope.nodeIds.length} node(s).`
          : 'Select a target before editing.',
      },
      {
        id: 'apply-semantic-edit',
        label: 'Apply semantic edit',
        status: route.selectionScope?.nodeIds.length ? 'ready' : 'blocked',
        detail:
          route.kind === 'edit-selected-part'
            ? 'Patch exposed semantic part properties.'
            : 'Patch equipment parameters and regenerate dependent semantic parts if needed.',
      },
    ]
  }

  if (route.kind === 'bind-live-data') {
    return [
      {
        id: 'read-selection',
        label: 'Read target nodes',
        status: route.selectionScope?.nodeIds.length ? 'ready' : 'blocked',
        detail: route.selectionScope?.nodeIds.length
          ? `Selected ${route.selectionScope.nodeIds.length} node(s).`
          : 'Select target nodes before binding data.',
      },
      {
        id: 'configure-binding',
        label: 'Detect live data field',
        status: route.selectionScope?.nodeIds.length ? 'ready' : 'blocked',
        detail: 'Choose the best fixed/live telemetry path for the requested semantic effect.',
      },
      {
        id: 'apply-semantic-binding',
        label: 'Apply semantic binding',
        status: route.selectionScope?.nodeIds.length ? 'ready' : 'blocked',
        detail:
          'Write a dynamic binding to the selected equipment so data binding labels and preview runtime can read the same contract.',
      },
    ]
  }

  return [
    {
      id: 'classify-intent',
      label: 'Classify intent',
      status: 'ready',
      detail: route.reason,
    },
    {
      id: 'execute-route',
      label: 'Execute route',
      status: route.execution === 'none' ? 'info' : 'ready',
      detail:
        route.execution === 'none'
          ? 'No canvas mutation will be applied.'
          : `Use ${route.execution} execution path.`,
    },
  ]
}

function stablePreviewId(route: AiIntentRoute) {
  let hash = 0
  const key = `${route.kind}:${route.prompt}:${route.requiredPack?.id ?? ''}`
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return `preview_${route.kind}_${hash.toString(36)}`
}
