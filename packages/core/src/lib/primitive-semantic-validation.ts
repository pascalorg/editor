import type {
  PrimitiveGeometryBrief,
  PrimitiveShapeInput,
  ResolvedPrimitiveTransform,
} from './primitive-compose'
import {
  buildPrimitiveGeometryFacts,
  type PrimitiveGeometryFacts,
  type PrimitiveShapeFact,
} from './primitive-facts'

type SemanticFamily = 'vehicle' | 'bicycle' | 'valve' | 'robot_arm' | 'unknown'

export interface PrimitiveSemanticValidationOptions {
  toolName?: string
  prompt?: string
  sourceArgs?: Record<string, unknown>
  geometryBrief?: PrimitiveGeometryBrief
}

export interface PrimitiveSemanticValidationResult {
  ok: boolean
  family: SemanticFamily
  score: number
  issues: string[]
  warnings: string[]
  recommendations: string[]
  facts: PrimitiveGeometryFacts
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sourceText(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  const parts = [args.name, args.partName, args.category, args.model].map(textOf)
  if (Array.isArray(args.parts)) {
    for (const part of args.parts) {
      if (typeof part !== 'object' || part === null) continue
      const record = part as Record<string, unknown>
      parts.push(
        textOf(record.kind),
        textOf(record.partType),
        textOf(record.type),
        textOf(record.name),
      )
    }
  }
  return parts.filter(Boolean).join(' ')
}

function detectFamily(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
): SemanticFamily {
  const text = [
    options.geometryBrief?.category,
    options.prompt,
    sourceText(options.sourceArgs),
    Object.keys(facts.roles).join(' '),
    Object.keys(facts.sourcePartKinds).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (
    /tricycle|cargo[_\s-]?trike|cargo[_\s-]?bike|rickshaw|pushcart|handcart|\u4e09\u8f6e\u8f66|\u8d27\u8fd0\u81ea\u884c\u8f66/.test(
      text,
    )
  ) {
    return 'unknown'
  }
  if (/bicycle|bike|自行车|單車|单车/.test(text)) return 'bicycle'
  if (
    /vehicle|sedan|suv|automobile|(?:^|[\s_-])(?:car|auto)(?:$|[\s_-])|汽车|小轿车|轿车/.test(text)
  ) {
    return 'vehicle'
  }
  if (/valve|gate_valve|gate valve|\u9600\u95e8|\u95f8\u9600/.test(text)) return 'valve'
  if (/robot[_\s-]?arm|cobot|manipulator|\u673a\u5668\u81c2|\u673a\u68b0\u81c2/.test(text))
    return 'robot_arm'
  return 'unknown'
}

function factsBy(
  facts: PrimitiveGeometryFacts,
  predicate: (fact: PrimitiveShapeFact) => boolean,
): PrimitiveShapeFact[] {
  return facts.shapes.filter(predicate)
}

function hasRole(fact: PrimitiveShapeFact, roles: string[]): boolean {
  return fact.semanticRole != null && roles.includes(fact.semanticRole)
}

function factName(fact: PrimitiveShapeFact): string {
  return fact.name?.toLowerCase() ?? ''
}

function isVehicleBody(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['vehicle_body']) ||
    (fact.sourcePartKind === 'vehicle_body' && factName(fact).includes('body shell'))
  )
}

function isVehicleTire(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  if (name.includes('steering')) return false
  if (/hub|rim|spoke|axle|cap|bolt/.test(name)) return false
  const tireLikeKind =
    fact.kind === 'torus' || fact.kind === 'cylinder' || fact.kind === 'hollow-cylinder'
  return (
    hasRole(fact, ['vehicle_tire']) ||
    (fact.sourcePartKind === 'vehicle_wheels' && tireLikeKind && /tire|wheel/.test(name)) ||
    (tireLikeKind &&
      (/(vehicle|car).*tire/.test(name) || name.includes('tire') || name.includes('wheel')) &&
      !name.includes('bicycle'))
  )
}

function isVehicleWindow(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  return (
    hasRole(fact, ['vehicle_window', 'vehicle_glass', 'glass']) ||
    fact.sourcePartKind === 'vehicle_windows' ||
    name.includes('windshield') ||
    name.includes('window') ||
    name.includes('glass')
  )
}

function isHeadlight(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['headlight', 'vehicle_headlight']) ||
    fact.sourcePartKind === 'headlights' ||
    factName(fact).includes('headlight')
  )
}

function isBumper(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['front_bumper', 'rear_bumper', 'bumper', 'vehicle_bumper']) ||
    fact.sourcePartKind === 'bumper' ||
    factName(fact).includes('bumper')
  )
}

function isBicycleTire(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  return (
    hasRole(fact, ['bicycle_tire']) ||
    (fact.sourcePartKind === 'bicycle_wheels' && fact.kind === 'torus' && name.includes('tire')) ||
    (fact.kind === 'torus' && name.includes('bicycle') && name.includes('tire'))
  )
}

function countClusters(values: number[], tolerance: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  let clusters = 0
  let current: number | undefined
  for (const value of sorted) {
    if (current == null || Math.abs(value - current) > tolerance) {
      clusters += 1
      current = value
    } else {
      current = (current + value) / 2
    }
  }
  return clusters
}

function normalizeRequiredRole(role: string): string {
  const normalized = role
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  switch (normalized) {
    case 'bicycle_wheel':
    case 'bicycle_wheels':
    case 'bike_wheel':
    case 'bike_wheels':
      return 'bicycle_wheels'
    case 'bicycle_frame':
    case 'bike_frame':
      return 'bicycle_frame'
    case 'bicycle_fork':
    case 'bike_fork':
      return 'bicycle_fork'
    case 'front_tire':
      return 'front_wheel'
    case 'rear_tire':
    case 'rear_tires':
      return 'rear_wheels'
    case 'chain':
    case 'bicycle_chain':
    case 'chain_loop':
      return 'chain_loop'
    case 'seat':
    case 'bike_seat':
    case 'saddle':
      return 'saddle'
    case 'vehicle_wheel':
    case 'vehicle_wheels':
    case 'car_wheel':
    case 'car_wheels':
      return 'vehicle_wheels'
    case 'vehicle_windows':
    case 'vehicle_window':
    case 'vehicle_glass':
    case 'car_window':
    case 'car_glass':
    case 'glass':
    case 'car_windows':
    case 'windows':
      return 'vehicle_windows'
    case 'lights':
    case 'vehicle_headlight':
    case 'vehicle_headlights':
    case 'car_headlight':
    case 'car_headlights':
    case 'headlight':
    case 'headlights':
      return 'headlights'
    case 'vehicle_bumper':
    case 'vehicle_bumpers':
    case 'car_bumper':
    case 'car_bumpers':
    case 'bumper':
    case 'bumpers':
      return 'bumper'
    case 'inlet_flange':
    case 'suction_flange':
    case 'flange_inlet':
      return 'flange_inlet'
    case 'outlet_flange':
    case 'discharge_flange':
    case 'flange_outlet':
      return 'flange_outlet'
    case 'bonnet_bolt':
    case 'bonnet_bolts':
    case 'bonnet_bolt_pattern':
      return 'bonnet_bolts'
    case 'valve_stem':
      return 'stem'
    case 'valve_yoke':
      return 'yoke'
    case 'wedge':
    case 'gate':
    case 'gate_wedge':
      return 'gate_wedge'
    default:
      return normalized
  }
}

function requiredRoles(brief: PrimitiveGeometryBrief | undefined): string[] {
  return Array.from(
    new Set(
      [...(brief?.requiredRoles ?? []), ...(brief?.semanticRoles ?? [])].map(normalizeRequiredRole),
    ),
  )
}

function satisfiesRequiredRole(facts: PrimitiveGeometryFacts, role: string): boolean {
  if ((facts.roles[role] ?? 0) > 0) return true
  if ((facts.sourcePartKinds[role] ?? 0) > 0) return true

  switch (role) {
    case 'wheel':
    case 'wheels':
    case 'wheelset':
      return facts.shapes.some((fact) => {
        const text = `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`
          .toLowerCase()
          .trim()
        return /(wheel|tire|tyre)/.test(text) || fact.kind === 'torus'
      })
    case 'front_wheel':
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /front.*(wheel|tire|tyre)|(wheel|tire|tyre).*front/.test(text)
      })
    case 'rear_wheel':
    case 'rear_wheels':
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /rear.*(wheel|tire|tyre)|(wheel|tire|tyre).*rear/.test(text)
      })
    case 'frame':
      return (facts.roles.bicycle_frame ?? 0) > 0 || (facts.sourcePartKinds.bicycle_frame ?? 0) > 0
    case 'fork':
    case 'front_fork':
      return (facts.roles.bicycle_fork ?? 0) > 0 || (facts.sourcePartKinds.bicycle_fork ?? 0) > 0
    case 'bicycle_wheels':
      return (facts.sourcePartKinds.bicycle_wheels ?? 0) > 0 || (facts.roles.bicycle_tire ?? 0) >= 2
    case 'vehicle_wheels':
      return (facts.sourcePartKinds.vehicle_wheels ?? 0) > 0 || (facts.roles.vehicle_tire ?? 0) >= 4
    case 'vehicle_windows':
      return (
        (facts.sourcePartKinds.vehicle_windows ?? 0) > 0 ||
        (facts.roles.vehicle_window ?? 0) > 0 ||
        (facts.roles.vehicle_glass ?? 0) > 0 ||
        (facts.roles.glass ?? 0) > 0
      )
    case 'headlights':
      return (
        (facts.sourcePartKinds.headlights ?? 0) > 0 ||
        (facts.roles.headlight ?? 0) + (facts.roles.vehicle_headlight ?? 0) >= 2
      )
    case 'bumper':
      return (
        (facts.sourcePartKinds.bumper ?? 0) > 0 ||
        (facts.roles.vehicle_bumper ?? 0) >= 2 ||
        ((facts.roles.front_bumper ?? 0) > 0 && (facts.roles.rear_bumper ?? 0) > 0)
      )
    default:
      return false
  }
}

function requestedRed(options: PrimitiveSemanticValidationOptions): boolean {
  const text = [
    options.prompt,
    options.geometryBrief?.category,
    sourceText(options.sourceArgs),
    textOf(options.sourceArgs?.primaryColor),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /red|#cc0000|#ff0000|红色|紅色/.test(text)
}

function isRedColor(color: string | undefined): boolean {
  if (!color) return false
  const normalized = color.trim().toLowerCase()
  if (normalized === 'red') return true
  const hex = normalized.match(/^#?([0-9a-f]{6})$/)
  if (!hex) return false
  const value = hex[1]
  if (!value) return false
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return r >= 150 && g <= 90 && b <= 90
}

function validateRequiredRoles(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
  issues: string[],
) {
  for (const role of requiredRoles(options.geometryBrief)) {
    if (!satisfiesRequiredRole(facts, role)) {
      issues.push(`required semantic role "${role}" is missing.`)
    }
  }
}

function validateVehicle(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
  issues: string[],
  warnings: string[],
) {
  const bodies = factsBy(facts, isVehicleBody)
  const body = bodies[0]
  const tires = factsBy(facts, isVehicleTire)
  const windows = factsBy(facts, isVehicleWindow)
  const headlights = factsBy(facts, isHeadlight)
  const bumpers = factsBy(facts, isBumper)

  if (bodies.length !== 1) {
    issues.push(`vehicle requires exactly 1 main body shell, got ${bodies.length}.`)
  }
  if (tires.length !== 4) {
    issues.push(`vehicle requires exactly 4 tires arranged as two axles, got ${tires.length}.`)
  }
  if (windows.length === 0) issues.push('vehicle requires windows/glass above the body.')
  if (headlights.length < 2) {
    issues.push(`vehicle requires left/right headlights, got ${headlights.length}.`)
  }
  if (bumpers.length < 2) {
    issues.push(`vehicle requires front and rear bumper bars, got ${bumpers.length}.`)
  }

  if (body && tires.length === 4) {
    const averageTireRadius =
      tires.reduce((total, tire) => total + Math.max(tire.halfExtents[1], tire.halfExtents[2]), 0) /
      tires.length
    const tolerance = Math.max(0.04, averageTireRadius * 1.15)
    if (
      countClusters(
        tires.map((tire) => tire.center[0]),
        tolerance,
      ) < 2
    ) {
      issues.push(
        'vehicle tires must form two separated front/rear axle positions along the length axis.',
      )
    }
    if (
      countClusters(
        tires.map((tire) => tire.center[2]),
        tolerance,
      ) < 2
    ) {
      issues.push('vehicle tires must form left/right pairs across the body width.')
    }
    const bodyWidth = body.max[2] - body.min[2]
    const tireSpread =
      Math.max(...tires.map((tire) => tire.center[2])) -
      Math.min(...tires.map((tire) => tire.center[2]))
    if (tireSpread < bodyWidth * 0.55) {
      warnings.push(
        'vehicle tire width spread is narrow; wheels may read as hidden under the body.',
      )
    }
  }

  if (body && windows.length > 0 && windows.some((window) => window.center[1] <= body.center[1])) {
    issues.push('vehicle windows must sit above the main body centerline.')
  }

  if (body && headlights.length > 0) {
    const frontLimit = body.max[0] - (body.max[0] - body.min[0]) * 0.18
    const rearLimit = body.min[0] + (body.max[0] - body.min[0]) * 0.18
    if (
      !headlights.some((light) => light.center[0] >= frontLimit || light.center[0] <= rearLimit)
    ) {
      issues.push('vehicle headlights must be placed near one longitudinal end of the body.')
    }
  }

  if (body && bumpers.length >= 2) {
    const frontLimit = body.max[0] - (body.max[0] - body.min[0]) * 0.18
    const rearLimit = body.min[0] + (body.max[0] - body.min[0]) * 0.18
    const hasPositiveEndBumper = bumpers.some((bumper) => bumper.center[0] >= frontLimit)
    const hasNegativeEndBumper = bumpers.some((bumper) => bumper.center[0] <= rearLimit)
    const namedFrontRear =
      bumpers.some(
        (bumper) => hasRole(bumper, ['front_bumper']) || factName(bumper).includes('front'),
      ) &&
      bumpers.some(
        (bumper) => hasRole(bumper, ['rear_bumper']) || factName(bumper).includes('rear'),
      ) &&
      Math.max(...bumpers.map((bumper) => bumper.center[0])) -
        Math.min(...bumpers.map((bumper) => bumper.center[0])) >=
        (body.max[0] - body.min[0]) * 0.5
    if (!hasPositiveEndBumper && !namedFrontRear) {
      issues.push('vehicle needs a front bumper at the positive length end.')
    }
    if (!hasNegativeEndBumper && !namedFrontRear) {
      issues.push('vehicle needs a rear bumper at the negative length end.')
    }
  }

  if (body && requestedRed(options) && !isRedColor(body.materialColor)) {
    issues.push('requested red vehicle body, but the main body material is not red.')
  }
}

function validateBicycle(facts: PrimitiveGeometryFacts, issues: string[], warnings: string[]) {
  const tires = factsBy(facts, isBicycleTire)
  if (tires.length !== 2) {
    issues.push(
      `bicycle requires exactly 2 tires from one bicycle_wheels wheelset, got ${tires.length}.`,
    )
  }

  const requiredRoles = ['bicycle_frame', 'bicycle_fork', 'handlebar', 'saddle', 'chain_loop']
  for (const role of requiredRoles) {
    if ((facts.roles[role] ?? 0) === 0) issues.push(`bicycle requires ${role}.`)
  }

  if (tires.length === 2) {
    const groundYs = tires.map((tire) => tire.min[1])
    const delta = Math.abs((groundYs[0] ?? 0) - (groundYs[1] ?? 0))
    if (delta > 0.03) issues.push('bicycle tires must share the same ground/contact height.')
    const axleDistance = Math.abs((tires[0]?.center[0] ?? 0) - (tires[1]?.center[0] ?? 0))
    if (
      axleDistance <
      Math.max(tires[0]?.halfExtents[1] ?? 0.1, tires[1]?.halfExtents[1] ?? 0.1) * 1.8
    ) {
      warnings.push(
        'bicycle wheelbase is very short; the silhouette may read as a cart wheel pair.',
      )
    }
  }
}

function validateRobotArm(facts: PrimitiveGeometryFacts, issues: string[], warnings: string[]) {
  const requiredRoles = [
    'robot_base',
    'base_joint',
    'shoulder_joint',
    'upper_arm',
    'elbow_joint',
    'forearm',
    'end_effector',
  ]
  for (const role of requiredRoles) {
    if ((facts.roles[role] ?? 0) === 0) issues.push(`robot arm requires ${role}.`)
  }

  const base = facts.shapes.find((fact) => hasRole(fact, ['robot_base']))
  if (base && base.min[1] > 0.04) {
    warnings.push('robot arm base is floating above the ground plane.')
  }

  const joints = factsBy(facts, (fact) =>
    hasRole(fact, ['base_joint', 'shoulder_joint', 'elbow_joint', 'wrist_joint']),
  )
  if (joints.length < 3) {
    issues.push(`robot arm requires at least 3 readable joint housings, got ${joints.length}.`)
  }

  const links = factsBy(facts, (fact) => hasRole(fact, ['upper_arm', 'forearm']))
  if (links.length < 2) {
    issues.push('robot arm requires separate upper_arm and forearm links.')
  }
}

export function validatePrimitiveSemantics(
  shapes: readonly PrimitiveShapeInput[],
  transforms: readonly ResolvedPrimitiveTransform[] = [],
  options: PrimitiveSemanticValidationOptions = {},
): PrimitiveSemanticValidationResult {
  const facts = buildPrimitiveGeometryFacts(shapes, transforms)
  const family = detectFamily(facts, options)
  const issues: string[] = []
  const warnings: string[] = []

  validateRequiredRoles(facts, options, issues)

  if (facts.shapeCount === 0) issues.push('no primitive geometry facts were produced.')
  if (facts.dimensions.some((dimension) => dimension > 50)) {
    warnings.push(
      'generated object bounding box is unusually large for meter-based primitive output.',
    )
  }

  switch (family) {
    case 'vehicle':
      validateVehicle(facts, options, issues, warnings)
      break
    case 'bicycle':
      validateBicycle(facts, issues, warnings)
      break
    case 'robot_arm':
      validateRobotArm(facts, issues, warnings)
      break
  }

  const score = Math.max(0, Number((1 - issues.length * 0.18 - warnings.length * 0.05).toFixed(4)))
  return {
    ok: issues.length === 0,
    family,
    score,
    issues,
    warnings,
    recommendations: issues.map((issue) => `Repair geometry: ${issue}`),
    facts,
  }
}
