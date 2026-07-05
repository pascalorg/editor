type AnyRecord = Record<string, unknown>

export type FactoryRunExperienceAlert = {
  label: string
  detail?: string
  tone: 'info' | 'warning' | 'danger'
}

export type FactoryRunExperienceSummary = {
  applied: boolean
  applyState: 'applied' | 'prepared' | 'empty'
  patchCounts: {
    create: number
    update: number
    delete: number
    total: number
  }
  nodeIds: string[]
  createdNames: string[]
  missingAssets: Array<{
    name: string
    reason: string
    required: boolean
  }>
  fallbackWarnings: string[]
  quality?: {
    score?: number
    passed?: boolean
    issueCount: number
    issueLines: string[]
  }
  layout?: {
    fits?: boolean
    diagnosticCount: number
    style?: string
  }
  installGuidance?: {
    id: string
    version?: string
    label?: string
    reason?: string
  }
  alerts: FactoryRunExperienceAlert[]
  details: string
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function countPatches(patches: unknown[]) {
  return {
    create: patches.filter((patch) => isRecord(patch) && patch.op === 'create').length,
    update: patches.filter((patch) => isRecord(patch) && patch.op === 'update').length,
    delete: patches.filter((patch) => isRecord(patch) && patch.op === 'delete').length,
    total: patches.length,
  }
}

function readRequiredPack(result: AnyRecord): FactoryRunExperienceSummary['installGuidance'] {
  const candidates = [
    result.requiredPack,
    result.requiredSourcePack,
    isRecord(result.intentRoute) ? result.intentRoute.requiredPack : undefined,
    isRecord(result.route) ? result.route.requiredPack : undefined,
  ]

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const installed = booleanValue(candidate.installed)
    if (installed === true) return undefined
    const id = stringValue(candidate.id)
    if (!id) continue
    return {
      id,
      version: stringValue(candidate.version),
      label: stringValue(candidate.label),
      reason: stringValue(candidate.reason),
    }
  }
  return undefined
}

function readMissingAssets(result: AnyRecord): FactoryRunExperienceSummary['missingAssets'] {
  const missingAssets = Array.isArray(result.missingAssets) ? result.missingAssets : []
  return missingAssets
    .map((item) => {
      if (!isRecord(item)) return null
      return {
        name: stringValue(item.name) ?? 'unknown',
        reason: stringValue(item.reason) ?? 'not resolved',
        required: item.required === true,
      }
    })
    .filter((item): item is FactoryRunExperienceSummary['missingAssets'][number] => Boolean(item))
}

function isFallbackReason(reason: string) {
  return /fallback|generic|no registered|not resolved|missing|unknown/i.test(reason)
}

function readQuality(result: AnyRecord): FactoryRunExperienceSummary['quality'] {
  const qualityReport = isRecord(result.qualityReport) ? result.qualityReport : undefined
  if (!qualityReport) return undefined
  const issues = Array.isArray(qualityReport.issues) ? qualityReport.issues : []
  const issueLines = issues
    .slice(0, 4)
    .map((item) => {
      if (!isRecord(item)) return null
      const severity = stringValue(item.severity) ?? 'issue'
      const message = stringValue(item.message)
      return message ? `${severity}: ${message}` : null
    })
    .filter((item): item is string => Boolean(item))

  return {
    score: typeof qualityReport.score === 'number' ? Math.round(qualityReport.score) : undefined,
    passed: booleanValue(qualityReport.passed),
    issueCount: issues.length,
    issueLines,
  }
}

function readLayout(result: AnyRecord): FactoryRunExperienceSummary['layout'] {
  const layoutDiagnostics = isRecord(result.layoutDiagnostics)
    ? result.layoutDiagnostics
    : undefined
  if (!layoutDiagnostics) return undefined
  const layoutStrategy = isRecord(result.layoutStrategy) ? result.layoutStrategy : undefined
  const diagnostics = Array.isArray(layoutDiagnostics.diagnostics)
    ? layoutDiagnostics.diagnostics
    : []
  return {
    fits: booleanValue(layoutDiagnostics.fits),
    diagnosticCount: diagnostics.length,
    style: stringValue(layoutStrategy?.style),
  }
}

function detailsFor(summary: Omit<FactoryRunExperienceSummary, 'details'>, result: AnyRecord) {
  const artifact = isRecord(result.artifact) ? result.artifact : undefined
  const artifactTitle = stringValue(artifact?.title) ?? stringValue(artifact?.id)
  const geometryRunId = stringValue(result.geometryRunId)
  const editSummary = Array.isArray(result.editSummary)
    ? result.editSummary.map(String).filter(Boolean).slice(0, 6)
    : []

  const qualityLine =
    summary.quality?.score == null
      ? undefined
      : `- Quality: ${summary.quality.passed ? 'passed' : 'needs review'} (${summary.quality.score}/100, ${summary.quality.issueCount} issues)`
  const layoutLine = summary.layout
    ? `- Layout: ${summary.layout.fits === true ? 'fits' : 'needs review'}${summary.layout.style ? ` via ${summary.layout.style}` : ''} (${summary.layout.diagnosticCount} diagnostics)`
    : undefined
  const installLine = summary.installGuidance
    ? `- Required pack: ${summary.installGuidance.id}${summary.installGuidance.version ? `@${summary.installGuidance.version}` : ''} is not installed`
    : undefined

  return [
    '**Factory draft:**',
    artifactTitle ? `- Geometry artifact: ${artifactTitle}` : '- Geometry artifact: none',
    summary.patchCounts.update > 0 || summary.patchCounts.delete > 0
      ? `- Scene patches: ${summary.patchCounts.total} (${summary.patchCounts.create} create, ${summary.patchCounts.update} update, ${summary.patchCounts.delete} delete)`
      : `- Create patches: ${summary.patchCounts.create}`,
    layoutLine,
    qualityLine,
    installLine,
    summary.nodeIds.length ? `- Node ids: ${summary.nodeIds.join(', ')}` : '- Node ids: none',
    geometryRunId ? `- Geometry run: ${geometryRunId}` : undefined,
    `- Applied to canvas: ${summary.applied ? 'yes' : 'no'}`,
    editSummary.length ? `\n**Edits:**\n${editSummary.map((line) => `- ${line}`).join('\n')}` : undefined,
    summary.missingAssets.length
      ? `\n**Missing assets / fallbacks:**\n${summary.missingAssets.map((item) => `- ${item.name}: ${item.reason}`).join('\n')}`
      : undefined,
    summary.quality?.issueLines.length
      ? `\n**Quality issues:**\n${summary.quality.issueLines.map((line) => `- ${line}`).join('\n')}`
      : undefined,
    summary.installGuidance?.reason
      ? `\n**Install guidance:**\n- ${summary.installGuidance.reason}`
      : undefined,
    summary.applied
      ? '\nPatches were applied to the current canvas.'
      : '\nPatches are prepared for review only. Nothing was applied to the canvas.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function summarizeFactoryRunExperience(data: unknown): FactoryRunExperienceSummary {
  const result = isRecord(data) ? data : {}
  const patches = Array.isArray(result.patches) ? result.patches : []
  const patchCounts = countPatches(patches)
  const applied = result.applied === true
  const nodeIds = Array.isArray(result.nodeIds)
    ? result.nodeIds.map((id) => String(id)).filter(Boolean)
    : []
  const createdNames = Array.isArray(result.created)
    ? result.created.map((item) => String(item)).filter(Boolean)
    : []
  const missingAssets = readMissingAssets(result)
  const fallbackWarnings = missingAssets
    .filter((item) => isFallbackReason(item.reason))
    .map((item) => `${item.name}: ${item.reason}`)
  const quality = readQuality(result)
  const layout = readLayout(result)
  const installGuidance = readRequiredPack(result)

  const alerts: FactoryRunExperienceAlert[] = []
  if (installGuidance) {
    alerts.push({
      label: `Install ${installGuidance.id}${installGuidance.version ? `@${installGuidance.version}` : ''}`,
      detail: installGuidance.reason ?? 'This factory type requires an industry pack before generation.',
      tone: 'warning',
    })
  }
  if (fallbackWarnings.length > 0) {
    alerts.push({
      label: `${fallbackWarnings.length} fallback${fallbackWarnings.length === 1 ? '' : 's'} used`,
      detail: fallbackWarnings.slice(0, 2).join('\n'),
      tone: 'warning',
    })
  }
  if (quality?.passed === false) {
    alerts.push({
      label: `Quality gate needs review${quality.score == null ? '' : ` (${quality.score}/100)`}`,
      detail: quality.issueLines[0],
      tone: 'danger',
    })
  }
  if (layout?.fits === false) {
    alerts.push({
      label: 'Layout needs review',
      detail: `${layout.diagnosticCount} layout diagnostics were reported.`,
      tone: 'warning',
    })
  }
  if (!applied && patchCounts.total > 0) {
    alerts.push({
      label: 'Prepared for review',
      detail: 'The run produced scene patches, but they have not been applied to the canvas.',
      tone: 'info',
    })
  }

  const summaryWithoutDetails = {
    applied,
    applyState: applied ? 'applied' : patchCounts.total > 0 ? 'prepared' : 'empty',
    patchCounts,
    nodeIds,
    createdNames,
    missingAssets,
    fallbackWarnings,
    quality,
    layout,
    installGuidance,
    alerts,
  } satisfies Omit<FactoryRunExperienceSummary, 'details'>

  return {
    ...summaryWithoutDetails,
    details: detailsFor(summaryWithoutDetails, result),
  }
}
