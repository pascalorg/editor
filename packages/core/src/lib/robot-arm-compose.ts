import type { PrimitiveShapeInput, Vec3 } from './primitive-compose'

export type RobotArmStyle = 'industrial' | 'collaborative' | 'fanuc'
export type RobotArmPose = 'rest' | 'reach-forward' | 'work-ready'

export interface RobotArmComposeInput {
  name?: string
  style?: RobotArmStyle | string
  pose?: RobotArmPose | string
  position?: Vec3
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

  return [
    {
      kind: 'cylinder',
      name: `${name} base`,
      position: [position[0], position[1] + baseHeight / 2, position[2]],
      axis: 'y',
      radius: baseRadius,
      height: baseHeight,
      radialSegments: segments,
      materialPreset,
    },
    {
      kind: 'sphere',
      name: `${name} shoulder joint`,
      attachTo: 0,
      anchor: 'top',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: shoulderRadius,
      widthSegments: segments,
      heightSegments: Math.max(16, Math.round(segments * 0.6)),
      materialPreset,
    },
    {
      kind: 'cylinder',
      name: `${name} upper arm`,
      attachTo: 1,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [shoulderPitch, 0, 0],
      axis: 'z',
      radius: armRadius,
      height: upperArmLength,
      radialSegments: segments,
      materialPreset,
    },
    {
      kind: 'sphere',
      name: `${name} elbow joint`,
      attachTo: 2,
      anchor: 'front',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: elbowRadius,
      widthSegments: segments,
      heightSegments: Math.max(16, Math.round(segments * 0.6)),
      materialPreset,
    },
    {
      kind: 'cylinder',
      name: `${name} forearm`,
      attachTo: 3,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [elbowPitch, 0, 0],
      axis: 'z',
      radius: armRadius * 0.86,
      height: forearmLength,
      radialSegments: segments,
      materialPreset,
    },
    {
      kind: 'sphere',
      name: `${name} wrist joint`,
      attachTo: 4,
      anchor: 'front',
      childAnchor: 'center',
      position: [0, 0, 0],
      radius: wristRadius,
      widthSegments: segments,
      heightSegments: Math.max(12, Math.round(segments * 0.5)),
      materialPreset,
    },
    {
      kind: 'cylinder',
      name: `${name} wrist flange`,
      attachTo: 5,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      rotation: [wristPitch, 0, 0],
      axis: 'z',
      radius: wristRadius * 0.62,
      height: wristLength,
      radialSegments: segments,
      materialPreset,
    },
    {
      kind: 'box',
      name: `${name} simple gripper`,
      attachTo: 6,
      anchor: 'front',
      childAnchor: 'back',
      position: [0, 0, 0],
      length: armRadius * 2.8,
      width: toolLength,
      height: armRadius * 1.5,
      materialPreset,
    },
  ]
}
