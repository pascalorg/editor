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

export type PrimitiveVisualQualityFamily = 'vehicle' | 'robot_arm' | 'unknown'

export interface PrimitiveVisualQualityOptions {
  geometryBrief?: PrimitiveGeometryBrief
  prompt?: string
}

export interface PrimitiveVisualQualityResult {
  family: PrimitiveVisualQualityFamily
  score: number
  issues: string[]
  warnings: string[]
  recommendations: string[]
  metrics: Record<string, number>
}

function hasRole(fact: PrimitiveShapeFact, roles: string[]): boolean {
  return fact.semanticRole != null && roles.includes(fact.semanticRole)
}

function nameOf(fact: PrimitiveShapeFact): string {
  return fact.name?.toLowerCase() ?? ''
}

function factsBy(
  facts: PrimitiveGeometryFacts,
  predicate: (fact: PrimitiveShapeFact) => boolean,
): PrimitiveShapeFact[] {
  return facts.shapes.filter(predicate)
}

function detectFamily(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveVisualQualityOptions,
): PrimitiveVisualQualityFamily {
  const text = [
    options.geometryBrief?.category,
    options.prompt,
    Object.keys(facts.roles).join(' '),
    Object.keys(facts.sourcePartKinds).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (/robot|cobot|manipulator|robot_arm|\u673a\u5668\u81c2|\u673a\u68b0\u81c2/.test(text)) {
    return 'robot_arm'
  }
  if (
    /tricycle|cargo[_\s-]?trike|cargo[_\s-]?bike|rickshaw|pushcart|handcart|\u4e09\u8f6e\u8f66|\u8d27\u8fd0\u81ea\u884c\u8f66/.test(
      text,
    )
  ) {
    return 'unknown'
  }
  if (
    /vehicle|sedan|suv|automobile|(?:^|[\s_-])(?:car|auto)(?:$|[\s_-])|\u6c7d\u8f66|\u8f7f\u8f66/.test(
      text,
    )
  ) {
    return 'vehicle'
  }
  return 'unknown'
}

function vehicleBody(facts: PrimitiveGeometryFacts): PrimitiveShapeFact | undefined {
  return facts.shapes.find(
    (fact) =>
      hasRole(fact, ['vehicle_body']) ||
      (fact.sourcePartKind === 'vehicle_body' && nameOf(fact).includes('body shell')),
  )
}

function vehicleTires(facts: PrimitiveGeometryFacts): PrimitiveShapeFact[] {
  return factsBy(
    facts,
    (fact) =>
      hasRole(fact, ['vehicle_tire']) ||
      (fact.sourcePartKind === 'vehicle_wheels' && nameOf(fact).includes('tire')),
  )
}

function vehicleCabins(facts: PrimitiveGeometryFacts): PrimitiveShapeFact[] {
  return factsBy(
    facts,
    (fact) =>
      hasRole(fact, ['vehicle_cabin']) ||
      (hasRole(fact, ['vehicle_glass', 'vehicle_window']) && nameOf(fact).includes('cabin')) ||
      (fact.sourcePartKind === 'vehicle_body' && nameOf(fact).includes('cabin')),
  )
}

function vehicleWindows(facts: PrimitiveGeometryFacts): PrimitiveShapeFact[] {
  return factsBy(
    facts,
    (fact) =>
      hasRole(fact, ['vehicle_window', 'vehicle_glass', 'glass']) ||
      fact.sourcePartKind === 'vehicle_windows' ||
      /windshield|window|glass/.test(nameOf(fact)),
  )
}

function vehicleDecks(facts: PrimitiveGeometryFacts): PrimitiveShapeFact[] {
  return factsBy(
    facts,
    (fact) =>
      hasRole(fact, ['vehicle_deck']) ||
      (fact.sourcePartKind === 'vehicle_body' && /deck|hood|trunk/.test(nameOf(fact))),
  )
}

function hasVehicleDetail(facts: PrimitiveGeometryFacts, pattern: RegExp): boolean {
  return facts.shapes.some((fact) => pattern.test(nameOf(fact)))
}

function ratio(value: number, divisor: number): number {
  return divisor > 0 && Number.isFinite(value) && Number.isFinite(divisor) ? value / divisor : 0
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function assessVehicleQuality(facts: PrimitiveGeometryFacts): PrimitiveVisualQualityResult {
  const issues: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  const metrics: Record<string, number> = {}

  const body = vehicleBody(facts)
  const tires = vehicleTires(facts)
  const cabins = vehicleCabins(facts)
  const windows = vehicleWindows(facts)
  const decks = vehicleDecks(facts)
  const hasRocker = hasVehicleDetail(facts, /rocker|sill/)
  const hasWheelArch = hasVehicleDetail(facts, /wheel arch|fender/)
  const hasTaperedCabin = cabins.some((cabin) => cabin.kind === 'trapezoid-prism')

  if (!body) {
    issues.push('vehicle visual quality requires a distinct main body shell.')
    recommendations.push('Use compose_parts vehicle_body so the car has a shaped body shell.')
  }

  const bodyLength = body ? body.max[0] - body.min[0] : facts.dimensions[0]
  const bodyWidth = body ? body.max[2] - body.min[2] : facts.dimensions[2]
  const bodyHeight = body ? body.max[1] - body.min[1] : facts.dimensions[1]
  const overallHeight = facts.dimensions[1]
  const wheelRadius = average(
    tires.map((tire) => Math.max(tire.halfExtents[0], tire.halfExtents[1])),
  )
  const wheelRadiusToLength = ratio(wheelRadius, bodyLength)
  const wheelRadiusToHeight = ratio(wheelRadius, overallHeight)
  const overallHeightToLength = ratio(overallHeight, bodyLength)
  const bodyHeightToLength = ratio(bodyHeight, bodyLength)
  const cabinHeightToOverall = ratio(
    average(cabins.map((cabin) => cabin.max[1] - cabin.min[1])),
    overallHeight,
  )

  metrics.bodyLength = Number(bodyLength.toFixed(4))
  metrics.bodyWidth = Number(bodyWidth.toFixed(4))
  metrics.bodyHeight = Number(bodyHeight.toFixed(4))
  metrics.overallHeight = Number(overallHeight.toFixed(4))
  metrics.wheelRadius = Number(wheelRadius.toFixed(4))
  metrics.wheelRadiusToLength = Number(wheelRadiusToLength.toFixed(4))
  metrics.wheelRadiusToHeight = Number(wheelRadiusToHeight.toFixed(4))
  metrics.overallHeightToLength = Number(overallHeightToLength.toFixed(4))
  metrics.bodyHeightToLength = Number(bodyHeightToLength.toFixed(4))
  metrics.cabinHeightToOverall = Number(cabinHeightToOverall.toFixed(4))

  if (tires.length === 4) {
    if (wheelRadiusToLength < 0.045) {
      issues.push('vehicle wheels are too small relative to the body length.')
      recommendations.push('Increase vehicle_wheels.radius or choose a sportier vehicle style.')
    }
    if (wheelRadiusToHeight < 0.14) {
      warnings.push('vehicle wheels are visually small relative to the overall height.')
      recommendations.push('Increase wheelRadius or lower the body/overallHeight.')
    }
  }

  if (overallHeightToLength > 0.46) {
    issues.push('vehicle body is too tall for its length; it reads as a box instead of a car.')
    recommendations.push('Lower vehicle_body.overallHeight or use a sedan/sports vehicleStyle.')
  }
  if (overallHeightToLength < 0.18) {
    warnings.push('vehicle body is extremely low; check that the roof and windows remain readable.')
  }

  if (cabins.length === 0) {
    issues.push('vehicle needs a separate cabin/roof mass, not one plain body block.')
    recommendations.push('Use vehicle_body from compose_parts so a cabin frame is generated.')
  } else if (!hasTaperedCabin) {
    warnings.push('vehicle cabin is boxy; a tapered cabin reads more like a real car.')
    recommendations.push(
      'Set vehicle_body.cabinTopScale around 0.75-0.9 or roofCornerAngle below 90.',
    )
  }

  if (windows.length < 3 && cabins.length > 0) {
    warnings.push(
      `vehicle has only ${windows.length} window/glass panel; separated windows improve readability.`,
    )
    recommendations.push(
      'Use vehicle_windows or split the cabin glass into windshield, rear, and side panels.',
    )
  } else if (windows.length < 3) {
    issues.push(`vehicle needs separated windshield/rear/side windows, got ${windows.length}.`)
    recommendations.push('Use vehicle_windows or add multiple window panels around the cabin.')
  }

  if (decks.length < 2) {
    warnings.push('vehicle lacks distinct front/rear deck layering.')
    recommendations.push('Use compose_parts vehicle_body defaults with front and rear deck shapes.')
  }

  if (!hasRocker) {
    warnings.push('vehicle lacks a lower rocker/sill shadow, making the body read flat.')
    recommendations.push('Add a dark rocker shadow or side sill detail below the doors.')
  }

  if (!hasWheelArch) {
    warnings.push('vehicle lacks wheel-arch/fender hints around the tires.')
    recommendations.push(
      'Add subtle rounded fender or wheel-arch hints above each tire without blocky black side panels.',
    )
  }

  const score = Math.max(
    0,
    Number(
      (1 - issues.length * 0.16 - warnings.length * 0.045 - (hasTaperedCabin ? 0 : 0.03)).toFixed(
        4,
      ),
    ),
  )

  return {
    family: 'vehicle',
    score,
    issues,
    warnings,
    recommendations,
    metrics,
  }
}

function assessRobotArmQuality(facts: PrimitiveGeometryFacts): PrimitiveVisualQualityResult {
  const issues: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  const metrics: Record<string, number> = {}

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
    if ((facts.roles[role] ?? 0) === 0) {
      issues.push(`robot arm visual quality requires ${role}.`)
      recommendations.push(`Add a readable ${role} component via compose_robot_arm.`)
    }
  }

  const base = facts.shapes.find((fact) => hasRole(fact, ['robot_base']))
  const upperArm = facts.shapes.find((fact) => hasRole(fact, ['upper_arm']))
  const forearm = facts.shapes.find((fact) => hasRole(fact, ['forearm']))
  const shoulder = facts.shapes.find((fact) => hasRole(fact, ['shoulder_joint']))
  const elbow = facts.shapes.find((fact) => hasRole(fact, ['elbow_joint']))
  const endEffector = facts.shapes.find((fact) => hasRole(fact, ['end_effector']))
  const joints = factsBy(facts, (fact) =>
    hasRole(fact, ['base_joint', 'shoulder_joint', 'elbow_joint', 'wrist_joint']),
  )

  const upperLength = upperArm ? Math.max(...upperArm.halfExtents) * 2 : 0
  const forearmLength = forearm ? Math.max(...forearm.halfExtents) * 2 : 0
  const baseRadius = base ? Math.max(base.halfExtents[0], base.halfExtents[2]) : 0
  const reachEstimate = upperLength + forearmLength
  const baseToReach = ratio(baseRadius, reachEstimate)
  const linkBalance =
    upperLength && forearmLength
      ? Math.min(upperLength, forearmLength) / Math.max(upperLength, forearmLength)
      : 0

  metrics.upperArmLength = Number(upperLength.toFixed(4))
  metrics.forearmLength = Number(forearmLength.toFixed(4))
  metrics.baseRadius = Number(baseRadius.toFixed(4))
  metrics.baseToReach = Number(baseToReach.toFixed(4))
  metrics.linkBalance = Number(linkBalance.toFixed(4))
  metrics.jointCount = joints.length

  if (joints.length < 3) {
    issues.push(`robot arm needs at least 3 visually distinct joints, got ${joints.length}.`)
    recommendations.push('Use base, shoulder, and elbow joint housings at minimum.')
  }
  if (base && baseToReach < 0.06) {
    warnings.push('robot arm base is visually small compared with reach.')
    recommendations.push('Increase base radius or reduce reach.')
  }
  if (upperLength && forearmLength && linkBalance < 0.45) {
    warnings.push('robot arm links are strongly imbalanced; the arm may read as a pole.')
    recommendations.push('Keep upper_arm and forearm lengths within a roughly 2:1 ratio.')
  }
  if (
    shoulder &&
    elbow &&
    Math.abs(shoulder.center[1] - elbow.center[1]) < Math.max(0.08, upperLength * 0.12)
  ) {
    warnings.push(
      'robot arm shoulder and elbow are nearly level; use a posed chain for a clearer silhouette.',
    )
    recommendations.push(
      'Use pose="work-ready" or reach-forward instead of a straight vertical stack.',
    )
  }
  if (endEffector && forearm && endEffector.center[2] < forearm.center[2]) {
    warnings.push(
      'robot arm end effector does not appear beyond the forearm along the working direction.',
    )
  }

  const score = Math.max(0, Number((1 - issues.length * 0.16 - warnings.length * 0.045).toFixed(4)))
  return {
    family: 'robot_arm',
    score,
    issues,
    warnings,
    recommendations,
    metrics,
  }
}

export function assessPrimitiveVisualQuality(
  shapes: readonly PrimitiveShapeInput[],
  transforms: readonly ResolvedPrimitiveTransform[] = [],
  options: PrimitiveVisualQualityOptions = {},
): PrimitiveVisualQualityResult {
  const facts = buildPrimitiveGeometryFacts(shapes, transforms)
  const family = detectFamily(facts, options)
  if (family === 'vehicle') return assessVehicleQuality(facts)
  if (family === 'robot_arm') return assessRobotArmQuality(facts)
  return {
    family,
    score: 1,
    issues: [],
    warnings: [],
    recommendations: [],
    metrics: {},
  }
}
