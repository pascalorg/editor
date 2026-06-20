import type { PrimitiveMaterialInput, PrimitiveShapeInput, Vec3 } from './primitive-compose'

export type RobotArmStyle = 'industrial' | 'collaborative' | 'fanuc'
export type RobotArmPose = 'rest' | 'reach-forward' | 'work-ready'

export interface RobotArmComposeInput {
  name?: string
  style?: RobotArmStyle | string
  pose?: RobotArmPose | string
  position?: Vec3
  axisCount?: 3 | 4 | 5 | 6 | 7 | number
  baseShape?: 'round' | 'square' | 'pedestal' | string
  endEffector?: 'gripper' | 'suction' | 'tool-flange' | string
  reach?: number
  baseHeight?: number
  detail?: 'low' | 'medium' | 'high' | string
  materialPreset?: string
  primaryColor?: string
  secondaryColor?: string
  darkColor?: string
  metalColor?: string
  includeCableHarness?: boolean
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
  )
}

function roundSegments(detail: RobotArmComposeInput['detail']): number {
  switch (detail) {
    case 'high':
      return 48
    case 'low':
      return 20
    default:
      return 32
  }
}

function styleMaterial(
  style: RobotArmComposeInput['style'],
  materialPreset: string | undefined,
): string | undefined {
  if (materialPreset) return materialPreset
  if (style === 'fanuc') return 'safety-yellow'
  return undefined
}

function material(
  color: string | undefined,
  roughness = 0.82,
  metalness = 0.04,
): PrimitiveMaterialInput | undefined {
  return color ? { properties: { color, roughness, metalness } } : undefined
}

function jointDisc(input: {
  name: string
  attachTo?: number
  anchor?: string
  childAnchor?: string
  position?: Vec3
  rotation?: Vec3
  axis: 'x' | 'y' | 'z'
  radius: number
  height: number
  segments: number
  materialPreset?: string
  material?: PrimitiveMaterialInput
  semanticRole: string
}): PrimitiveShapeInput {
  return {
    kind: 'cylinder',
    name: input.name,
    attachTo: input.attachTo,
    anchor: input.anchor,
    childAnchor: input.childAnchor,
    position: input.position ?? [0, 0, 0],
    rotation: input.rotation,
    axis: input.axis,
    radius: input.radius,
    height: input.height,
    radialSegments: input.segments,
    materialPreset: input.materialPreset,
    material: input.material,
    semanticRole: input.semanticRole,
  }
}

function armLink(input: {
  name: string
  attachTo?: number
  position?: Vec3
  anchor?: string
  childAnchor?: string
  rotation: Vec3
  radius: number
  length: number
  segments: number
  materialPreset?: string
  material?: PrimitiveMaterialInput
  semanticRole: string
}): PrimitiveShapeInput {
  return {
    kind: 'capsule',
    name: input.name,
    attachTo: input.attachTo,
    anchor: input.anchor,
    childAnchor: input.childAnchor,
    position: input.position ?? [0, 0, 0],
    rotation: input.rotation,
    axis: 'y',
    radius: input.radius,
    height: input.length,
    radialSegments: input.segments,
    capSegments: 5,
    materialPreset: input.materialPreset,
    material: input.material,
    semanticRole: input.semanticRole,
  }
}

function linkBetween(input: {
  name: string
  start: Vec3
  end: Vec3
  radius: number
  segments: number
  materialPreset?: string
  material?: PrimitiveMaterialInput
  semanticRole: string
}): PrimitiveShapeInput {
  const dy = input.end[1] - input.start[1]
  const dz = input.end[2] - input.start[2]
  const length = Math.max(0.01, Math.hypot(dy, dz))
  return armLink({
    name: input.name,
    position: [
      (input.start[0] + input.end[0]) / 2,
      (input.start[1] + input.end[1]) / 2,
      (input.start[2] + input.end[2]) / 2,
    ],
    rotation: [Math.atan2(dz, dy), 0, 0],
    radius: input.radius,
    length,
    segments: input.segments,
    materialPreset: input.materialPreset,
    material: input.material,
    semanticRole: input.semanticRole,
  })
}

export function composeRobotArmPrimitives(input: RobotArmComposeInput = {}): PrimitiveShapeInput[] {
  const reach = clamp(input.reach, 2.4, 0.8, 8)
  const baseHeight = clamp(input.baseHeight, reach * 0.18, 0.12, reach * 0.35)
  const turntableHeight = Math.max(0.055, baseHeight * 0.2)
  const baseRadius = reach * 0.15
  const shoulderRadius = reach * 0.14
  const elbowRadius = reach * 0.112
  const wristRadius = reach * 0.056
  const upperArmLength = reach * 0.43
  const forearmLength = reach * 0.48
  const wristLength = reach * 0.12
  const toolLength = reach * 0.09
  const armRadius = reach * 0.072
  const segments = roundSegments(input.detail)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? (input.style === 'fanuc' ? 'FANUC robot arm draft' : 'Robot arm draft')
  const materialPreset = styleMaterial(input.style, input.materialPreset)
  const primaryColor = input.primaryColor ?? (input.style === 'fanuc' ? '#facc15' : '#facc15')
  const secondaryColor = input.secondaryColor ?? (input.style === 'fanuc' ? '#facc15' : '#111827')
  const darkColor = input.darkColor ?? '#111827'
  const metalColor = input.metalColor ?? '#cbd5e1'
  const primaryMaterial = material(primaryColor)
  const secondaryMaterial = material(secondaryColor)
  const darkMaterial = material(darkColor, 0.78, 0.12)
  const metalMaterial = material(metalColor, 0.42, 0.55)
  const axisCount = Math.max(
    3,
    Math.min(7, Math.round(typeof input.axisCount === 'number' ? input.axisCount : 6)),
  )

  const shoulderLean = input.pose === 'reach-forward' ? 0.42 : input.pose === 'rest' ? 0.18 : 0.28
  const elbowLift = input.pose === 'reach-forward' ? 0.05 : input.pose === 'rest' ? 0.3 : 0.18
  const wristLift = input.pose === 'rest' ? 0.05 : -0.02
  const baseTopY = position[1] + baseHeight + turntableHeight
  const shoulder: Vec3 = [position[0], baseTopY + shoulderRadius * 0.42, position[2]]
  const elbow: Vec3 = [
    position[0],
    shoulder[1] + upperArmLength * Math.cos(shoulderLean),
    shoulder[2] + upperArmLength * Math.sin(shoulderLean),
  ]
  const wristBase: Vec3 = [
    position[0],
    elbow[1] + forearmLength * elbowLift,
    elbow[2] + forearmLength * 0.92,
  ]
  const wristRoll: Vec3 = [position[0], wristBase[1] + wristLift, wristBase[2] + wristLength * 0.45]
  const wristPitchPoint: Vec3 = [position[0], wristRoll[1], wristRoll[2] + wristLength * 0.55]
  const wristYaw: Vec3 = [position[0], wristPitchPoint[1], wristPitchPoint[2] + wristLength * 0.5]
  const flange: Vec3 = [position[0], wristYaw[1], wristYaw[2] + toolLength * 0.45]
  const face: Vec3 = [position[0], flange[1], flange[2] + toolLength * 0.7]

  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${name} base`,
      position: [position[0], position[1] + baseHeight / 2, position[2]],
      axis: 'y',
      radius: baseRadius,
      height: baseHeight,
      radialSegments: segments,
      materialPreset,
      material: darkMaterial,
      semanticRole: 'robot_base',
    },
    {
      kind: 'cylinder',
      name: `${name} base turntable joint`,
      position: [position[0], position[1] + baseHeight + turntableHeight / 2, position[2]],
      axis: 'y',
      radius: baseRadius * 0.78,
      height: turntableHeight,
      radialSegments: segments,
      materialPreset,
      material: secondaryMaterial,
      semanticRole: 'base_joint',
    },
    jointDisc({
      name: `${name} shoulder rotary housing`,
      position: shoulder,
      axis: 'x',
      radius: shoulderRadius,
      height: shoulderRadius * 0.95,
      segments,
      materialPreset,
      material: primaryMaterial,
      semanticRole: 'shoulder_joint',
    }),
    armLink({
      name: `${name} tapered upper arm shell`,
      position: [
        (shoulder[0] + elbow[0]) / 2,
        (shoulder[1] + elbow[1]) / 2,
        (shoulder[2] + elbow[2]) / 2,
      ],
      rotation: [shoulderLean, 0, 0],
      radius: armRadius,
      length: upperArmLength,
      segments,
      materialPreset,
      material: primaryMaterial,
      semanticRole: 'upper_arm',
    }),
    jointDisc({
      name: `${name} elbow rotary housing`,
      position: elbow,
      axis: 'x',
      radius: elbowRadius,
      height: elbowRadius * 0.9,
      segments,
      materialPreset,
      material: primaryMaterial,
      semanticRole: 'elbow_joint',
    }),
  ]

  if (axisCount >= 7) {
    const redundantJoint: Vec3 = [
      position[0],
      elbow[1] + (wristBase[1] - elbow[1]) * 0.32,
      elbow[2] + (wristBase[2] - elbow[2]) * 0.32,
    ]
    shapes.push(
      jointDisc({
        name: `${name} J4 redundant forearm swivel`,
        position: redundantJoint,
        axis: 'z',
        radius: elbowRadius * 0.78,
        height: wristLength * 0.34,
        segments,
        materialPreset,
        material: secondaryMaterial,
        semanticRole: 'redundant_axis_joint',
      }),
    )
  }

  shapes.push(
    linkBetween({
      name: `${name} tapered forearm shell`,
      start: elbow,
      end: wristBase,
      radius: armRadius * 0.9,
      segments,
      materialPreset,
      material: primaryMaterial,
      semanticRole: 'forearm',
    }),
  )

  if (axisCount >= 4) {
    shapes.push(
      jointDisc({
        name: `${name} J${axisCount >= 7 ? '5' : '4'} wrist roll module`,
        position: wristRoll,
        axis: 'z',
        radius: wristRadius * 1.05,
        height: wristLength * 0.44,
        segments,
        materialPreset,
        material: secondaryMaterial,
        semanticRole: 'wrist_roll_joint',
      }),
    )
  }
  if (axisCount >= 5) {
    shapes.push(
      jointDisc({
        name: `${name} J${axisCount >= 7 ? '6' : '5'} wrist pitch module`,
        position: wristPitchPoint,
        axis: 'x',
        radius: wristRadius * 0.92,
        height: wristLength * 0.32,
        segments,
        materialPreset,
        material: primaryMaterial,
        semanticRole: 'wrist_pitch_joint',
      }),
    )
  }

  shapes.push(
    jointDisc({
      name: `${name} J${axisCount} wrist yaw joint`,
      position: wristYaw,
      axis: 'z',
      radius: wristRadius,
      height: wristLength * 0.38,
      segments,
      materialPreset,
      material: secondaryMaterial,
      semanticRole: 'wrist_joint',
    }),
  )
  shapes.push(
    jointDisc({
      name: `${name} ISO tool flange`,
      position: flange,
      axis: 'z',
      radius: wristRadius * 0.72,
      height: Math.max(0.035, wristLength * 0.26),
      segments,
      materialPreset,
      material: metalMaterial,
      semanticRole: 'tool_flange',
    }),
  )
  shapes.push(
    jointDisc({
      name: `${name} end effector mounting face`,
      position: face,
      axis: 'z',
      radius: wristRadius * 0.78,
      height: Math.max(0.018, wristLength * 0.11),
      segments,
      materialPreset,
      material: metalMaterial,
      semanticRole: 'end_effector',
    }),
  )

  if (input.includeCableHarness !== false) {
    shapes.push(
      linkBetween({
        name: `${name} upper arm cable harness`,
        start: [shoulder[0] + armRadius * 1.15, shoulder[1] + armRadius * 0.45, shoulder[2]],
        end: [elbow[0] + armRadius * 1.15, elbow[1] + armRadius * 0.35, elbow[2]],
        radius: armRadius * 0.16,
        segments: Math.max(12, Math.round(segments * 0.45)),
        material: darkMaterial,
        semanticRole: 'cable_harness',
      }),
      linkBetween({
        name: `${name} forearm cable harness`,
        start: [elbow[0] + armRadius * 1.05, elbow[1] + armRadius * 0.25, elbow[2]],
        end: [wristRoll[0] + armRadius * 0.85, wristRoll[1] + armRadius * 0.2, wristRoll[2]],
        radius: armRadius * 0.14,
        segments: Math.max(12, Math.round(segments * 0.45)),
        material: darkMaterial,
        semanticRole: 'cable_harness',
      }),
    )
  }

  if (input.endEffector !== 'tool-flange' && input.endEffector !== 'suction') {
    shapes.push(
      {
        kind: 'box',
        name: `${name} left gripper finger`,
        position: [face[0] + armRadius * 0.72, face[1], face[2] + toolLength * 0.45],
        length: armRadius * 0.45,
        width: toolLength * 0.9,
        height: armRadius * 1.15,
        materialPreset,
        material: metalMaterial,
        semanticRole: 'gripper_finger',
      },
      {
        kind: 'box',
        name: `${name} right gripper finger`,
        position: [face[0] - armRadius * 0.72, face[1], face[2] + toolLength * 0.45],
        length: armRadius * 0.45,
        width: toolLength * 0.9,
        height: armRadius * 1.15,
        materialPreset,
        material: metalMaterial,
        semanticRole: 'gripper_finger',
      },
    )
  }

  return shapes
}
