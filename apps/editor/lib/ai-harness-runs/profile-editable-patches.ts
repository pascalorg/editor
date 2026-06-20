import type { DeviceProfileDefinition } from '@pascal-app/core/lib/device-profile-registry'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'

export type ProfileEditablePatch = {
  values: Record<string, unknown>
  reason: string
}

type DimensionKey = 'length' | 'width' | 'height' | 'depth' | 'diameter' | 'reach'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function editableProperty(profile: DeviceProfileDefinition, property: string) {
  return profile.resolvedEditableSchema?.properties[property]
}

function schemaAllows(profile: DeviceProfileDefinition, property: string, value?: unknown) {
  const definition = profile.resolvedEditableSchema?.properties[property]
  if (!definition) return false
  if (definition.values && value != null) return definition.values.includes(value)
  return true
}

function colorFromPrompt(text: string): string | undefined {
  if (/orange|kuka|\u6a59\u8272|\u6a58\u8272/.test(text)) return '#f97316'
  if (/blue|\u84dd\u8272|\u85cd\u8272/.test(text)) return '#2563eb'
  if (/yellow|fanuc|\u9ec4\u8272|\u9ec3\u8272/.test(text)) return '#facc15'
  if (/red|\u7ea2\u8272|\u7d05\u8272/.test(text)) return '#dc2626'
  if (/white|\u767d\u8272/.test(text)) return '#f8fafc'
  if (/black|\u9ed1\u8272/.test(text)) return '#111827'
  return undefined
}

function axisCountFromPrompt(text: string): number | undefined {
  if (/(seven[_\s-]?axis|7[_\s-]?axis|\u4e03\u8f74)/.test(text)) return 7
  if (/(six[_\s-]?axis|6[_\s-]?axis|\u516d\u8f74)/.test(text)) return 6
  if (/(five[_\s-]?axis|5[_\s-]?axis|\u4e94\u8f74)/.test(text)) return 5
  if (/(four[_\s-]?axis|4[_\s-]?axis|\u56db\u8f74|scara)/.test(text)) return 4
  if (/(three[_\s-]?axis|3[_\s-]?axis|\u4e09\u8f74)/.test(text)) return 3
  return undefined
}

function endEffectorFromPrompt(text: string): string | undefined {
  if (/gripper|claw|jaw|\u5939\u722a|\u722a\u5b50|\u5939\u624b/.test(text)) return 'gripper'
  if (/suction|vacuum|cup|\u5438\u76d8|\u771f\u7a7a/.test(text)) return 'suction'
  if (/flange|tool[_\s-]?flange|\u6cd5\u5170/.test(text)) return 'tool-flange'
  return undefined
}

function dimensionScaleFromPrompt(text: string, key: DimensionKey): number | undefined {
  const increase = 1.18
  const decrease = 0.85
  const larger =
    /(\u5927\u4e00\u70b9|\u53d8\u5927|\u653e\u5927|larger|bigger|scale up|increase size)/.test(text)
  const smaller =
    /(\u5c0f\u4e00\u70b9|\u53d8\u5c0f|\u7f29\u5c0f|smaller|scale down|decrease size)/.test(text)
  const hasSpecificDimensionIntent =
    /(\u957f|\u77ed|\u9ad8|\u77ee|\u5bbd|\u7a84|\u76f4\u5f84|\u81c2\u5c55|length|height|width|diameter|reach)/.test(
      text,
    )
  if (key === 'length') {
    if (
      /(\u957f\u4e00\u70b9|\u52a0\u957f|\u53d8\u957f|\u66f4\u957f|longer|lengthen|increase length)/.test(
        text,
      )
    ) {
      return increase
    }
    if (
      /(\u77ed\u4e00\u70b9|\u7f29\u77ed|\u53d8\u77ed|\u66f4\u77ed|shorter|decrease length)/.test(
        text,
      )
    ) {
      return decrease
    }
  }
  if (key === 'height') {
    if (
      /(\u9ad8\u4e00\u70b9|\u52a0\u9ad8|\u53d8\u9ad8|\u66f4\u9ad8|taller|higher|increase height)/.test(
        text,
      )
    ) {
      return increase
    }
    if (
      /(\u77ee\u4e00\u70b9|\u964d\u4f4e|\u53d8\u77ee|\u66f4\u77ee|shorter|lower|decrease height)/.test(
        text,
      )
    ) {
      return decrease
    }
  }
  if (key === 'width' || key === 'depth') {
    if (
      /(\u5bbd\u4e00\u70b9|\u52a0\u5bbd|\u53d8\u5bbd|\u66f4\u5bbd|wider|increase width)/.test(text)
    ) {
      return increase
    }
    if (
      /(\u7a84\u4e00\u70b9|\u6536\u7a84|\u53d8\u7a84|\u66f4\u7a84|narrower|decrease width)/.test(
        text,
      )
    ) {
      return decrease
    }
  }
  if (key === 'diameter') {
    if (
      /(\u76f4\u5f84|\u7b52\u4f53|\u7f50\u4f53|diameter|drum|shell).*(\u5927|\u52a0\u5927|\u53d8\u5927|larger|bigger|increase)/.test(
        text,
      )
    ) {
      return increase
    }
    if (
      /(\u76f4\u5f84|\u7b52\u4f53|\u7f50\u4f53|diameter|drum|shell).*(\u5c0f|\u7f29\u5c0f|\u53d8\u5c0f|smaller|decrease)/.test(
        text,
      )
    ) {
      return decrease
    }
  }
  if (!hasSpecificDimensionIntent && larger && key !== 'diameter') return 1.15
  if (!hasSpecificDimensionIntent && smaller && key !== 'diameter') return 0.88
  return undefined
}

function reachScaleFromPrompt(text: string): number | undefined {
  if (
    /(\u81c2\u5c55|\u5de5\u4f5c\u534a\u5f84|reach|arm span).*(\u52a0\u957f|\u53d8\u957f|\u66f4\u957f|longer|increase)/.test(
      text,
    )
  ) {
    return 1.2
  }
  if (
    /(\u81c2\u5c55|\u5de5\u4f5c\u534a\u5f84|reach|arm span).*(\u7f29\u77ed|\u53d8\u77ed|\u66f4\u77ed|shorter|decrease)/.test(
      text,
    )
  ) {
    return 0.85
  }
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function currentEditableValue(
  artifact: GeneratedGeometryArtifact,
  profile: DeviceProfileDefinition,
  key: string,
): unknown {
  const args = isRecord(artifact.sourceArgs) ? artifact.sourceArgs : {}
  if (args[key] != null) return args[key]
  if (key === 'diameter' && args.radius != null && typeof args.radius === 'number') {
    return args.radius * 2
  }
  const layoutHints = isRecord(args.layoutHints) ? args.layoutHints : undefined
  const robotDefaults = isRecord(layoutHints?.robotArmDefaults)
    ? layoutHints.robotArmDefaults
    : undefined
  if (robotDefaults?.[key] != null) return robotDefaults[key]
  return profile.defaultDimensions?.[
    key as keyof NonNullable<DeviceProfileDefinition['defaultDimensions']>
  ]
}

function clampEditableNumber(profile: DeviceProfileDefinition, key: string, value: number) {
  const property = editableProperty(profile, key)
  return Math.max(
    typeof property?.min === 'number' ? property.min : Number.NEGATIVE_INFINITY,
    Math.min(typeof property?.max === 'number' ? property.max : Number.POSITIVE_INFINITY, value),
  )
}

function applyScaledDimensionPatch(
  profile: DeviceProfileDefinition,
  artifact: GeneratedGeometryArtifact,
  text: string,
  values: Record<string, unknown>,
  reasons: string[],
) {
  for (const key of ['length', 'width', 'height', 'depth', 'diameter', 'reach'] as const) {
    const scale = key === 'reach' ? reachScaleFromPrompt(text) : dimensionScaleFromPrompt(text, key)
    if (!scale || !schemaAllows(profile, key)) continue
    const current = numberValue(currentEditableValue(artifact, profile, key))
    if (!current || current <= 0) continue
    const next = Number(clampEditableNumber(profile, key, current * scale).toFixed(3))
    values[key] = next
    if (key === 'diameter') values.radius = Number((next / 2).toFixed(3))
    reasons.push(`${key}=${next}`)
  }
}

export function resolveProfileEditablePatch(
  prompt: string,
  artifact: GeneratedGeometryArtifact | null,
  profile: DeviceProfileDefinition | undefined,
): ProfileEditablePatch | undefined {
  if (!artifact || !profile?.resolvedEditableSchema) return undefined
  const text = prompt.toLowerCase()
  const values: Record<string, unknown> = {}
  const reasons: string[] = []

  const axisCount = axisCountFromPrompt(text)
  if (axisCount != null && schemaAllows(profile, 'axisCount', axisCount)) {
    values.axisCount = axisCount
    reasons.push(`axisCount=${axisCount}`)
  }

  const endEffector = endEffectorFromPrompt(text)
  if (endEffector && schemaAllows(profile, 'endEffector', endEffector)) {
    values.endEffector = endEffector
    reasons.push(`endEffector=${endEffector}`)
  }

  const color = colorFromPrompt(text)
  for (const key of ['primaryColor', 'secondaryColor', 'metalColor'] as const) {
    if (color && schemaAllows(profile, key, color)) {
      values[key] = color
      reasons.push(`${key}=${color}`)
      break
    }
  }

  applyScaledDimensionPatch(profile, artifact, text, values, reasons)

  if (
    /(\u4e0d\u8981|\u53bb\u6389|remove|without).*(\u7ebf\u7f06|\u7ebf\u675f|cable)/.test(text) &&
    schemaAllows(profile, 'includeCableHarness', false)
  ) {
    values.includeCableHarness = false
    reasons.push('includeCableHarness=false')
  } else if (
    /(\u52a0|\u52a0\u4e0a|add|with).*(\u7ebf\u7f06|\u7ebf\u675f|cable)/.test(text) &&
    schemaAllows(profile, 'includeCableHarness', true)
  ) {
    values.includeCableHarness = true
    reasons.push('includeCableHarness=true')
  }

  if (Object.keys(values).length === 0) return undefined
  return { values, reason: reasons.join(', ') }
}

function scaledNumber(value: unknown, scale: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number((value * scale).toFixed(3))
    : value
}

function scalePosition(value: unknown, scales: { x?: number; y?: number; z?: number }) {
  if (!Array.isArray(value) || value.length < 3) return value
  const [x, y, z] = value
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return value
  }
  return [
    Number((x * (scales.x ?? 1)).toFixed(3)),
    Number((y * (scales.y ?? 1)).toFixed(3)),
    Number((z * (scales.z ?? 1)).toFixed(3)),
  ]
}

function dimensionScales(sourceArgs: Record<string, unknown>, values: Record<string, unknown>) {
  const scale = (key: string, fromKey = key) => {
    const current = numberValue(sourceArgs[fromKey])
    const next = numberValue(values[key])
    return current && next ? next / current : undefined
  }
  return {
    length: scale('length'),
    width: scale('width'),
    height: scale('height'),
    depth: scale('depth', 'depth') ?? scale('depth', 'width'),
    diameter: scale('diameter') ?? scale('diameter', 'width') ?? scale('diameter', 'radius'),
  }
}

function scalePart(
  part: Record<string, unknown>,
  scales: ReturnType<typeof dimensionScales>,
  values: Record<string, unknown>,
) {
  const next = { ...part }
  if (scales.length) next.length = scaledNumber(next.length, scales.length)
  if (scales.width) next.width = scaledNumber(next.width, scales.width)
  if (scales.depth) next.depth = scaledNumber(next.depth, scales.depth)
  if (scales.height) next.height = scaledNumber(next.height, scales.height)
  if (scales.diameter) {
    next.diameter = scaledNumber(next.diameter, scales.diameter)
    next.radius = scaledNumber(next.radius, scales.diameter)
    next.radiusTop = scaledNumber(next.radiusTop, scales.diameter)
    next.radiusBottom = scaledNumber(next.radiusBottom, scales.diameter)
    next.tubeRadius = scaledNumber(next.tubeRadius, scales.diameter)
    next.rollerLength = scaledNumber(next.rollerLength, scales.diameter)
  }
  next.position = scalePosition(next.position, {
    x: scales.length,
    y: scales.height,
    z: scales.width ?? scales.depth ?? scales.diameter,
  })
  if (typeof values.primaryColor === 'string') {
    if (typeof next.primaryColor === 'string' || next.color == null)
      next.primaryColor = values.primaryColor
    if (typeof next.color === 'string') next.color = values.primaryColor
  }
  if (typeof values.secondaryColor === 'string' && typeof next.secondaryColor === 'string') {
    next.secondaryColor = values.secondaryColor
  }
  if (typeof values.metalColor === 'string' && typeof next.metalColor === 'string') {
    next.metalColor = values.metalColor
  }
  return next
}

export function applyProfileEditablePatchToArgs(
  sourceArgs: Record<string, unknown>,
  patch: ProfileEditablePatch,
) {
  const next: Record<string, unknown> = { ...sourceArgs, ...patch.values }
  if (patch.values.diameter != null && patch.values.radius == null) {
    const diameter = numberValue(patch.values.diameter)
    if (diameter) next.radius = Number((diameter / 2).toFixed(3))
    if (diameter && next.width == null) next.width = diameter
  }
  const scales = dimensionScales(sourceArgs, patch.values)
  if (Array.isArray(sourceArgs.parts)) {
    next.parts = sourceArgs.parts.map((part) =>
      isRecord(part) ? scalePart(part, scales, patch.values) : part,
    )
  }
  const layoutHints = isRecord(sourceArgs.layoutHints) ? { ...sourceArgs.layoutHints } : {}
  const robotDefaults = isRecord(layoutHints.robotArmDefaults)
    ? { ...layoutHints.robotArmDefaults }
    : {}
  for (const [key, value] of Object.entries(patch.values)) {
    robotDefaults[key] = value
  }
  next.layoutHints = {
    ...layoutHints,
    robotArmDefaults: robotDefaults,
  }
  next.geometryBrief =
    typeof sourceArgs.geometryBrief === 'string'
      ? `${sourceArgs.geometryBrief}\nEditable patch: ${patch.reason}.`
      : `Editable patch: ${patch.reason}.`
  return next
}
