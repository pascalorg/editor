import type { PrimitiveShapeInput, Vec3 } from './primitive-compose'

export type RobotArmStyle = 'industrial' | 'collaborative' | 'fanuc'
export type RobotArmPose = 'rest' | 'reach-forward' | 'work-ready'

export interface RobotArmComposeInput {
  name?: string
  style?: RobotArmStyle | string
  pose?: RobotArmPose | string
  position?: Vec3
  axisCount?: 3 | 4 | 6 | number
  baseShape?: 'round' | 'square' | 'pedestal' | string
  endEffector?: 'gripper' | 'suction' | 'tool-flange' | string
  reach?: number
  baseHeight?: number
  detail?: 'low' | 'medium' | 'high' | string
  materialPreset?: string
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
}

function roundSegments(detail: RobotArmComposeInput['detail']): number {
  switch (detail) {
    case 'high':
      return 48
    case 'low':
      return 20
    case 'medium':
    default:
      return 32
  }
}

function styleMaterial(style: RobotArmComposeInput['style'], materialPreset: string | undefined): string | undefined {
  if (materialPreset) return materialPreset
  if (style === 'fanuc') return 'safety-yellow'
  return undefined
}

export function composeRobotArmPrimitives(input: RobotArmComposeInput = {}): PrimitiveShapeInput[] {
  const reach = clamp(input.reach, 2.4, 0.8, 8)
  const baseHeight = clamp(input.baseHeight, reach * 0.16, 0.12, reach * 0.35)
  const turntableHeight = Math.max(0.05, baseHeight * 0.18)
  const baseRadius = reach * 0.12
  const shoulderRadius = reach * 0.095
  const elbowRadius = reach * 0.08
  const wristRadius = reach * 0.052
  const upperArmLength = reach * 0.38
  const forearmLength = reach * 0.34
  const wristLength = reach * 0.12
  const toolLength = reach * 0.09
  const armRadius = reach * 0.045
  const segments = roundSegments(input.detail)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? (input.style === 'fanuc' ? 'FANUC robot arm draft' : 'Robot arm draft')
  const materialPreset = styleMaterial(input.style, input.materialPreset)

  const shoulderPitch = input.pose === 'reach-forward' ? -0.28 : input.pose === 'work-ready' ? -0.52 : -0.16
  const elbowPitch = input.pose === 'reach-forward' ? 0.18 : input.pose === 'work-ready' ? 0.62 : 0.38
  const wristPitch = input.pose === 'work-ready' ? -0.42 : -0.18

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
      semanticRole: 'robot_base',
    },
    {
      kind: 'cylinder',
      name: `${name} base turntable joint`,
      attachTo: 0,
      anchor: 'top',
      childAnchor: 'bottom',
      position: [position[0], position[1] + baseHeight + turntableHeight / 2, position[2]],
      axis: 'y',
      radius: baseRadius * 0.72,
      height: turntableHeight,
      radialSegments: segments,
      materialPreset,
      semanticRole: 'base_joint',
    },
    {
      kind: 'sphere',
      name: `${name} shoulder joint`,
      attachTo: 1,
      anchor: 'top',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: shoulderRadius,
      widthSegments: segments,
      heightSegments: Math.max(16, Math.round(segments * 0.6)),
      materialPreset,
      semanticRole: 'shoulder_joint',
    },
    {
      kind: 'cylinder',
      name: `${name} upper arm`,
      attachTo: 2,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [shoulderPitch, 0, 0],
      axis: 'z',
      radius: armRadius,
      height: upperArmLength,
      radialSegments: segments,
      materialPreset,
      semanticRole: 'upper_arm',
    },
    {
      kind: 'sphere',
      name: `${name} elbow joint`,
      attachTo: 3,
      anchor: 'front',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: elbowRadius,
      widthSegments: segments,
      heightSegments: Math.max(16, Math.round(segments * 0.6)),
      materialPreset,
      semanticRole: 'elbow_joint',
    },
    {
      kind: 'cylinder',
      name: `${name} forearm`,
      attachTo: 4,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [elbowPitch, 0, 0],
      axis: 'z',
      radius: armRadius * 0.86,
      height: forearmLength,
      radialSegments: segments,
      materialPreset,
      semanticRole: 'forearm',
    },
    {
      kind: 'sphere',
      name: `${name} wrist joint`,
      attachTo: 5,
      anchor: 'front',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: wristRadius,
      widthSegments: segments,
      heightSegments: Math.max(12, Math.round(segments * 0.5)),
      materialPreset,
      semanticRole: 'wrist_joint',
    },
    {
      kind: 'cylinder',
      name: `${name} wrist flange`,
      attachTo: 6,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [wristPitch, 0, 0],
      axis: 'z',
      radius: wristRadius * 0.62,
      height: wristLength,
      radialSegments: segments,
      materialPreset,
      semanticRole: 'tool_flange',
    },
    {
      kind: 'box',
      name: `${name} gripper palm`,
      attachTo: 7,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      length: armRadius * 2.8,
      width: toolLength,
      height: armRadius * 1.5,
      materialPreset,
      semanticRole: 'end_effector',
    },
  ]

  if (input.endEffector !== 'tool-flange' && input.endEffector !== 'suction') {
    shapes.push(
      {
        kind: 'box',
        name: `${name} left gripper finger`,
        attachTo: 8,
        anchor: 'front',
        childAnchor: 'back',
        position: [armRadius * 0.72, 0, 0],
        length: armRadius * 0.45,
        width: toolLength * 0.9,
        height: armRadius * 1.15,
        materialPreset,
        semanticRole: 'gripper_finger',
      },
      {
        kind: 'box',
        name: `${name} right gripper finger`,
        attachTo: 8,
        anchor: 'front',
        childAnchor: 'back',
        position: [-armRadius * 0.72, 0, 0],
        length: armRadius * 0.45,
        width: toolLength * 0.9,
        height: armRadius * 1.15,
        materialPreset,
        semanticRole: 'gripper_finger',
      },
    )
  }

  return shapes
}
