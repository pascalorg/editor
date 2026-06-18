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
import { hasComponentPartIntent } from './primitive-part-intent'

export type PrimitiveVisualQualityFamily =
  | 'vehicle'
  | 'robot_arm'
  | 'fan'
  | 'aircraft'
  | 'industrial_equipment'
  | 'unknown'

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
  const promptIntentText = [options.geometryBrief?.category, options.prompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (hasComponentPartIntent(promptIntentText)) return 'unknown'

  if (
    /reactor|reaction[_\s-]?vessel|stirred[_\s-]?tank|pressure[_\s-]?vessel|process[_\s-]?equipment|reactor_vessel_shell|vessel_shell|agitator_motor|agitator_shaft|inlet_port|outlet_port|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|\u6405\u62cc\u7f50|\u538b\u529b\u5bb9\u5668/.test(
      text,
    )
  ) {
    return 'industrial_equipment'
  }

  if (/robot|cobot|manipulator|robot_arm|\u673a\u5668\u81c2|\u673a\u68b0\u81c2/.test(text)) {
    return 'robot_arm'
  }
  if (
    /aircraft|airplane|airliner|boeing|airbus|fuselage|t-tail|turbofan|jet[_\s-]?engine|aircraft_fuselage|aircraft_wing|aircraft_engine|vertical_stabilizer|horizontal_stabilizer|\u98de\u673a|\u5ba2\u673a|\u6ce2\u97f3|\u7a7a\u5ba2|\u673a\u7ffc|\u673a\u8eab/.test(
      text,
    )
  ) {
    return 'aircraft'
  }
  if (
    /(?:^|[\s_-])fan(?:$|[\s_-])|standing fan|electric fan|protective_grill|radial_blades|\u98ce\u6247|\u7535\u98ce\u6247/.test(
      text,
    )
  ) {
    return 'fan'
  }
  if (
    /tricycle|cargo[_\s-]?trike|cargo[_\s-]?bike|rickshaw|pushcart|handcart|\u4e09\u8f6e\u8f66|\u8d27\u8fd0\u81ea\u884c\u8f66/.test(
      text,
    )
  ) {
    return 'unknown'
  }
  if (
    /\bagv\b|\bamr\b|\bvga[_\s-]?(cart|vehicle)?\b|automated[_\s-]?guided[_\s-]?vehicle|material[_\s-]?cart|navigation_sensor/.test(
      text,
    )
  ) {
    return 'industrial_equipment'
  }
  if (
    /vehicle|sedan|suv|automobile|(?:^|[\s_-])(?:car|auto)(?:$|[\s_-])|\u6c7d\u8f66|\u8f7f\u8f66/.test(
      text,
    )
  ) {
    return 'vehicle'
  }
  if (/chimney|smoke[_\s-]?stack|\u70df\u56f1/.test(text)) {
    return 'unknown'
  }
  if (
    /industrial|factory|machine|cnc|lathe|machining|pump|conveyor|heat[_\s-]?exchanger|hydraulic|injection|laser|rounded_machine_body|vent_grill|vent_slats|volute_casing|ribbed_motor_body|skid_base|\u673a\u5e8a|\u6570\u63a7|\u6cf5|\u8f93\u9001\u673a|\u6362\u70ed\u5668|\u6db2\u538b|\u6ce8\u5851|\u6fc0\u5149/.test(
      text,
    )
  ) {
    return 'industrial_equipment'
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

function assessFanQuality(facts: PrimitiveGeometryFacts): PrimitiveVisualQualityResult {
  const issues: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  const metrics: Record<string, number> = {}

  const blades = factsBy(
    facts,
    (fact) => hasRole(fact, ['fan_blade']) || fact.sourcePartKind === 'radial_blades',
  ).filter((fact) => !/root/.test(nameOf(fact)))
  const grill = factsBy(
    facts,
    (fact) => hasRole(fact, ['protective_grill']) || fact.sourcePartKind === 'protective_grill',
  )
  const spokes = grill.filter((fact) => /spoke/.test(nameOf(fact)))
  const rings = grill.filter((fact) => /ring/.test(nameOf(fact)))
  const sideRibs = grill.filter((fact) => /side rib|rear/.test(nameOf(fact)))
  const motor = factsBy(facts, (fact) => fact.sourcePartKind === 'motor_housing')
  const support = factsBy(
    facts,
    (fact) => fact.sourcePartKind === 'vertical_pole' || fact.sourcePartKind === 'support_bracket',
  )

  metrics.bladeCount = blades.length
  metrics.grillRingCount = rings.length
  metrics.grillSpokeCount = spokes.length
  metrics.grillSideRibCount = sideRibs.length
  metrics.motorCount = motor.length
  metrics.supportCount = support.length

  if (blades.length < 3) {
    issues.push(`fan needs at least 3 readable blades, got ${blades.length}.`)
    recommendations.push('Use radial_blades with count:3 for a recognizable fan silhouette.')
  }
  if (rings.length < 3) {
    issues.push(`fan protective grill needs multiple concentric rings, got ${rings.length}.`)
    recommendations.push('Use protective_grill with ringCount:4-5 instead of a single torus.')
  }
  if (spokes.length < 12) {
    warnings.push(`fan protective grill has few radial spokes, got ${spokes.length}.`)
    recommendations.push('Increase protective_grill.spokeCount to 18-24 for a clearer cage.')
  }
  if (sideRibs.length < 6) {
    warnings.push('fan grill lacks side/rear cage depth; it may read as a flat badge.')
    recommendations.push(
      'Use protective_grill depth and domeDepth so the guard forms a shallow cage.',
    )
  }
  if (motor.length === 0) {
    warnings.push('fan lacks a visible rear motor housing behind the blades.')
    recommendations.push('Add motor_housing behind radial_blades.')
  }
  if (support.length === 0) {
    warnings.push('fan lacks a pole/bracket support, so the assembly may float.')
    recommendations.push('Add vertical_pole and support_bracket for standing fans.')
  }

  const score = Math.max(0, Number((1 - issues.length * 0.18 - warnings.length * 0.04).toFixed(4)))
  return {
    family: 'fan',
    score,
    issues,
    warnings,
    recommendations,
    metrics,
  }
}

function assessIndustrialEquipmentQuality(
  facts: PrimitiveGeometryFacts,
): PrimitiveVisualQualityResult {
  const issues: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  const metrics: Record<string, number> = {}

  const bodyLike = factsBy(
    facts,
    (fact) =>
      /body|base|bed|frame|column|shell|casing|housing|press|machine|exchanger|conveyor/.test(
        fact.semanticRole ?? '',
      ) ||
      [
        'rounded_machine_body',
        'ribbed_motor_body',
        'volute_casing',
        'skid_base',
        'conveyor_frame',
        'heat_exchanger',
        'cylindrical_tank',
      ].includes(fact.sourcePartKind ?? ''),
  )
  const controls = factsBy(facts, (fact) =>
    /control|panel|button|knob/.test(`${fact.semanticRole ?? ''} ${nameOf(fact)}`),
  )
  const access = factsBy(facts, (fact) =>
    /door|guard|cover|hatch|window|transparent|access/.test(
      `${fact.semanticRole ?? ''} ${nameOf(fact)}`,
    ),
  )
  const vents = factsBy(
    facts,
    (fact) =>
      /vent|slat|grill|louver|ribbed/.test(`${fact.semanticRole ?? ''} ${nameOf(fact)}`) ||
      fact.sourcePartKind === 'vent_slats' ||
      fact.sourcePartKind === 'vent_grill',
  )
  const connectors = factsBy(facts, (fact) =>
    /port|flange|pipe|nozzle|inlet|outlet/.test(`${fact.semanticRole ?? ''} ${nameOf(fact)}`),
  )
  const labels = factsBy(facts, (fact) =>
    /nameplate|warning|label/.test(`${fact.semanticRole ?? ''} ${nameOf(fact)}`),
  )
  const roundedBodies = factsBy(
    facts,
    (fact) =>
      fact.sourcePartKind === 'rounded_machine_body' ||
      /rounded machine body|service hatch|shadow plinth|service seam/.test(nameOf(fact)),
  )

  metrics.bodyLikeCount = bodyLike.length
  metrics.controlCount = controls.length
  metrics.accessCount = access.length
  metrics.ventCount = vents.length
  metrics.connectorCount = connectors.length
  metrics.labelCount = labels.length
  metrics.roundedBodyDetailCount = roundedBodies.length
  metrics.shapeCount = facts.shapeCount

  if (bodyLike.length === 0) {
    issues.push('industrial equipment needs a readable main body/base/frame.')
    recommendations.push(
      'Use rounded_machine_body, skid_base, machine bed/frame, or recipe body parts.',
    )
  }
  if (facts.shapeCount < 5) {
    issues.push(
      `industrial equipment silhouette is under-specified with only ${facts.shapeCount} shapes.`,
    )
    recommendations.push(
      'Add 2-5 identifying modules such as control panel, guard, ports, rails, vents, or base.',
    )
  }
  if (facts.shapeCount < 3 && bodyLike.length <= 1) {
    issues.push('industrial equipment needs separate modules, not one monolithic block.')
    recommendations.push(
      'Split the object into base/body plus at least one functional module or panel.',
    )
  }
  if (controls.length === 0) {
    warnings.push('industrial equipment lacks a visible control panel or operator interface.')
    recommendations.push('Add control_box/control_panel or use recipe defaults for machine tools.')
  }
  if (access.length === 0 && connectors.length === 0) {
    warnings.push('industrial equipment lacks access/guard/door or connection details.')
    recommendations.push('Add access cover, transparent door, guard panel, pipe ports, or flanges.')
  }
  if (vents.length === 0 && connectors.length === 0) {
    warnings.push('industrial equipment lacks vents, grilles, ribs, or pipe connection cues.')
    recommendations.push(
      'Add vent_grill/vent_slats, ribbed_motor_body, inlet/outlet ports, or flanges.',
    )
  }
  if (roundedBodies.length === 1) {
    warnings.push(
      'rounded_machine_body is present but lacks service hatches, seams, or base shadow.',
    )
    recommendations.push(
      'Use the strengthened rounded_machine_body kernel or add visible service panels.',
    )
  }

  const score = Math.max(0, Number((1 - issues.length * 0.16 - warnings.length * 0.04).toFixed(4)))
  return {
    family: 'industrial_equipment',
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
  if (family === 'fan') return assessFanQuality(facts)
  if (family === 'industrial_equipment') return assessIndustrialEquipmentQuality(facts)
  return {
    family,
    score: 1,
    issues: [],
    warnings: [],
    recommendations: [],
    metrics: {},
  }
}
