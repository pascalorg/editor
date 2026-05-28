import type { PrimitiveShapeInput, Vec3 } from './primitive-compose'

export type ObjectComposeCategory =
  | 'vehicle'
  | 'chair'
  | 'outdoor-ac'
  | 'sofa'
  | 'keyboard'
  | 'monitor'
  | 'table'
  | 'shelf'
  | 'cabinet'
  | 'generic'
export type ObjectComposeDetail = 'low' | 'medium' | 'high'

export interface ObjectComposeInput {
  name?: string
  category?: ObjectComposeCategory | string
  model?: string
  style?: string
  position?: Vec3
  width?: number
  depth?: number
  length?: number
  height?: number
  primaryColor?: string
  secondaryColor?: string
  bodyColor?: string
  glassColor?: string
  wheelColor?: string
  detail?: ObjectComposeDetail | string
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
  )
}

function normalizeCategory(input: ObjectComposeInput): ObjectComposeCategory {
  const text =
    `${input.category ?? ''} ${input.model ?? ''} ${input.name ?? ''} ${input.style ?? ''}`.toLowerCase()
  if (/(tesla|model\s*y|model-y|car|vehicle|sedan|suv|crossover|truck|汽车|车辆|车)/.test(text))
    return 'vehicle'
  if (/(chair|stool|seat|椅|凳)/.test(text)) return 'chair'
  if (/(outdoor.?ac|air.?condition|ac unit|condenser|空调外机|空调|外机)/.test(text))
    return 'outdoor-ac'
  if (/(sofa|couch|loveseat|沙发)/.test(text)) return 'sofa'
  if (/(keyboard|keycap|键盘|按键)/.test(text)) return 'keyboard'
  if (/(monitor|display|screen|显示器|屏幕)/.test(text)) return 'monitor'
  if (/(table|desk|桌|台)/.test(text)) return 'table'
  if (/(shelf|bookshelf|rack|架|书架)/.test(text)) return 'shelf'
  if (/(cabinet|柜|橱)/.test(text)) return 'cabinet'
  return 'generic'
}

function isTeslaModelY(input: ObjectComposeInput): boolean {
  const text = `${input.name ?? ''} ${input.model ?? ''}`.toLowerCase()
  return text.includes('tesla') || text.includes('model y') || text.includes('model-y')
}

function roundSegments(detail: ObjectComposeInput['detail']): number {
  switch (detail) {
    case 'high':
      return 48
    case 'low':
      return 20
    default:
      return 32
  }
}

function material(
  color: string,
  roughness = 0.45,
  metalness = 0.05,
  opacity = 1,
): PrimitiveShapeInput['material'] {
  return {
    properties: {
      color,
      roughness,
      metalness,
      opacity,
      transparent: opacity < 1,
    },
  }
}

function composeVehicle(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const tesla = isTeslaModelY(input)
  const length = clamp(input.length ?? input.depth, tesla ? 4.76 : 4.4, 2.0, 8.0)
  const width = clamp(input.width, tesla ? 1.98 : 1.85, 1.0, 3.0)
  const height = clamp(input.height, tesla ? 1.62 : 1.45, 0.8, 3.0)
  const position = input.position ?? [0, 0, 0]
  const baseY = position[1]
  const name = input.name ?? (tesla ? 'Tesla Model Y low-poly' : 'Low-poly vehicle')
  const bodyMat = material(
    input.bodyColor ?? input.primaryColor ?? (tesla ? '#f4f6f8' : '#e7e7e7'),
    0.34,
    0.2,
  )
  const darkBodyMat = material('#1f2933', 0.45, 0.1)
  const glassMat = material(input.glassColor ?? input.secondaryColor ?? '#111827', 0.08, 0.05, 0.86)
  const wheelMat = material(input.wheelColor ?? '#111111', 0.7, 0.05)
  const rimMat = material('#c9ced6', 0.28, 0.55)
  const lightMat = material('#f8fafc', 0.18, 0.0)
  const tailMat = material('#b91c1c', 0.3, 0.0)
  const segments = roundSegments(input.detail)
  const wheelRadius = height * 0.22
  const wheelThickness = width * 0.13
  const wheelY = baseY + wheelRadius
  const axleX = width / 2 + wheelThickness * 0.28
  const frontZ = length * 0.31
  const rearZ = -length * 0.31

  return [
    {
      kind: 'box',
      name: `${name} lower body`,
      position: [position[0], baseY + height * 0.43, position[2]],
      length: width * 0.9,
      width: length * 0.78,
      height: height * 0.32,
      cornerRadius: height * 0.06,
      cornerSegments: 6,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${name} sloped hood`,
      position: [position[0], baseY + height * 0.56, position[2] + length * 0.24],
      rotation: [-0.08, 0, 0],
      length: width * 0.86,
      width: length * 0.34,
      height: height * 0.11,
      cornerRadius: height * 0.035,
      cornerSegments: 5,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${name} rear hatch`,
      position: [position[0], baseY + height * 0.67, position[2] - length * 0.24],
      rotation: [0.16, 0, 0],
      length: width * 0.9,
      width: length * 0.31,
      height: height * 0.16,
      cornerRadius: height * 0.04,
      cornerSegments: 5,
      material: bodyMat,
    },
    {
      kind: 'sphere',
      name: `${name} flattened cabin canopy`,
      position: [position[0], baseY + height * 0.84, position[2] - length * 0.03],
      radius: 1,
      scale: [width * 0.39, height * 0.22, length * 0.28],
      widthSegments: segments,
      heightSegments: Math.max(16, Math.round(segments * 0.55)),
      material: glassMat,
    },
    {
      kind: 'box',
      name: `${name} rocker shadow`,
      position: [position[0], baseY + height * 0.29, position[2]],
      length: width * 0.94,
      width: length * 0.72,
      height: height * 0.08,
      cornerRadius: height * 0.025,
      cornerSegments: 4,
      material: darkBodyMat,
    },
    ...[
      ['front left', -axleX, frontZ],
      ['front right', axleX, frontZ],
      ['rear left', -axleX, rearZ],
      ['rear right', axleX, rearZ],
    ].flatMap(([label, x, z]) => [
      {
        kind: 'cylinder' as const,
        name: `${name} ${label} tire`,
        position: [position[0] + (x as number), wheelY, position[2] + (z as number)] as Vec3,
        axis: 'x' as const,
        radius: wheelRadius,
        height: wheelThickness,
        radialSegments: segments,
        material: wheelMat,
      },
      {
        kind: 'cylinder' as const,
        name: `${name} ${label} rim`,
        position: [position[0] + (x as number), wheelY, position[2] + (z as number)] as Vec3,
        axis: 'x' as const,
        radius: wheelRadius * 0.58,
        height: wheelThickness * 1.04,
        radialSegments: Math.max(20, Math.round(segments * 0.75)),
        material: rimMat,
      },
    ]),
    {
      kind: 'box',
      name: `${name} front light bar`,
      position: [position[0], baseY + height * 0.53, position[2] + length * 0.405],
      length: width * 0.72,
      width: length * 0.018,
      height: height * 0.035,
      cornerRadius: height * 0.012,
      cornerSegments: 3,
      material: lightMat,
    },
    {
      kind: 'box',
      name: `${name} rear tail light bar`,
      position: [position[0], baseY + height * 0.56, position[2] - length * 0.405],
      length: width * 0.7,
      width: length * 0.018,
      height: height * 0.035,
      cornerRadius: height * 0.012,
      cornerSegments: 3,
      material: tailMat,
    },
  ]
}

function composeChair(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 0.55, 0.3, 1.2)
  const depth = clamp(input.depth ?? input.length, 0.55, 0.3, 1.2)
  const height = clamp(input.height, 0.95, 0.45, 1.8)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Low-poly chair'
  const wood = material(input.primaryColor ?? '#9a6a3a', 0.62, 0.02)
  const cushion = material(input.secondaryColor ?? '#374151', 0.7, 0.0)
  const seatY = position[1] + height * 0.46
  const legHeight = height * 0.42
  const legRadius = Math.min(width, depth) * 0.045
  const halfX = width * 0.4
  const halfZ = depth * 0.36

  return [
    {
      kind: 'box',
      name: `${name} seat cushion`,
      position: [position[0], seatY, position[2] + depth * 0.04],
      length: width,
      width: depth,
      height: height * 0.1,
      material: cushion,
    },
    {
      kind: 'box',
      name: `${name} back rest`,
      position: [position[0], position[1] + height * 0.72, position[2] - depth * 0.34],
      rotation: [0.16, 0, 0],
      length: width,
      width: depth * 0.08,
      height: height * 0.55,
      material: wood,
    },
    ...(
      [
        [-halfX, -halfZ],
        [halfX, -halfZ],
        [-halfX, halfZ],
        [halfX, halfZ],
      ] as [number, number][]
    ).map(([x, z], index) => ({
      kind: 'cylinder' as const,
      name: `${name} leg ${index + 1}`,
      position: [position[0] + x, position[1] + legHeight / 2, position[2] + z] as Vec3,
      axis: 'y' as const,
      radius: legRadius,
      height: legHeight,
      radialSegments: 16,
      material: wood,
    })),
    {
      kind: 'box',
      name: `${name} front stretcher`,
      position: [position[0], position[1] + legHeight * 0.48, position[2] + halfZ],
      length: width * 0.82,
      width: legRadius * 1.4,
      height: legRadius * 1.4,
      material: wood,
    },
  ]
}

function composeOutdoorAc(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 0.9, 0.35, 2.0)
  const depth = clamp(input.depth ?? input.length, 0.38, 0.18, 1.0)
  const height = clamp(input.height, 0.65, 0.3, 1.5)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Outdoor AC unit'
  const body = material(input.primaryColor ?? input.bodyColor ?? '#e5e7eb', 0.55, 0.05)
  const dark = material(input.secondaryColor ?? '#111827', 0.7, 0.02)
  const grille = material('#4b5563', 0.65, 0.05)
  const blade = material('#1f2937', 0.55, 0.05)
  const zFront = position[2] + depth / 2 + 0.01
  const centerY = position[1] + height / 2
  const segments = roundSegments(input.detail)
  const fanX = position[0] - width * 0.16
  const fanRadius = Math.min(width, height) * 0.24
  const fanZ = zFront + depth * 0.06

  return [
    {
      kind: 'box',
      name: `${name} metal case`,
      position: [position[0], centerY, position[2]],
      length: width,
      width: depth,
      height,
      cornerRadius: Math.min(width, depth, height) * 0.08,
      cornerSegments: 5,
      material: body,
    },
    {
      kind: 'box',
      name: `${name} dark front grille panel`,
      position: [position[0], centerY, zFront],
      length: width * 0.78,
      width: depth * 0.035,
      height: height * 0.72,
      cornerRadius: Math.min(width, height) * 0.035,
      cornerSegments: 4,
      material: dark,
    },
    {
      kind: 'cylinder',
      name: `${name} circular fan grille`,
      position: [fanX, centerY, zFront + depth * 0.025],
      axis: 'z',
      radius: fanRadius,
      height: depth * 0.05,
      radialSegments: segments,
      wallThickness: Math.min(width, height) * 0.035,
      material: grille,
    },
    ...[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((angle, index) => ({
      kind: 'box' as const,
      name: `${name} fan blade ${index + 1}`,
      position: [
        fanX + Math.cos(angle) * fanRadius * 0.24,
        centerY + Math.sin(angle) * fanRadius * 0.24,
        fanZ,
      ] as Vec3,
      rotation: [0, 0, angle + 0.34] as Vec3,
      length: fanRadius * 0.52,
      width: depth * 0.026,
      height: fanRadius * 0.11,
      cornerRadius: fanRadius * 0.03,
      cornerSegments: 3,
      material: blade,
    })),
    {
      kind: 'cylinder',
      name: `${name} fan hub`,
      position: [fanX, centerY, zFront + depth * 0.07],
      axis: 'z',
      radius: Math.min(width, height) * 0.06,
      height: depth * 0.06,
      radialSegments: Math.max(20, Math.round(segments * 0.75)),
      material: grille,
    },
    ...[-0.24, -0.12, 0, 0.12, 0.24].map((offset, index) => ({
      kind: 'box' as const,
      name: `${name} vent slat ${index + 1}`,
      position: [
        position[0] + width * 0.26,
        centerY + height * offset,
        zFront + depth * 0.05,
      ] as Vec3,
      length: width * 0.28,
      width: depth * 0.035,
      height: height * 0.035,
      cornerRadius: height * 0.01,
      cornerSegments: 3,
      material: grille,
    })),
    {
      kind: 'box',
      name: `${name} base feet`,
      position: [position[0], position[1] + height * 0.035, position[2]],
      length: width * 0.85,
      width: depth * 0.82,
      height: height * 0.07,
      cornerRadius: height * 0.015,
      cornerSegments: 3,
      material: grille,
    },
  ]
}

function composeSofa(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 2.2, 0.9, 4.0)
  const depth = clamp(input.depth ?? input.length, 0.92, 0.45, 1.8)
  const height = clamp(input.height, 0.82, 0.45, 1.5)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Rounded sofa'
  const fabric = material(input.primaryColor ?? '#7c3f2c', 0.82, 0.0)
  const shadow = material(input.secondaryColor ?? '#2f1f1a', 0.9, 0.0)
  const seam = material('#1f2933', 0.72, 0.0)
  const y = position[1]

  return [
    {
      kind: 'rounded-panel',
      name: `${name} seat cushion deck`,
      position: [position[0], y + height * 0.32, position[2] + depth * 0.05],
      length: width,
      width: depth * 0.72,
      thickness: height * 0.2,
      cornerRadius: Math.min(width, depth) * 0.055,
      cornerSegments: 6,
      material: fabric,
    },
    {
      kind: 'rounded-panel',
      name: `${name} back cushion slab`,
      position: [position[0], y + height * 0.58, position[2] - depth * 0.32],
      rotation: [-0.14, 0, 0],
      length: width,
      width: height * 0.62,
      thickness: depth * 0.13,
      cornerRadius: height * 0.055,
      cornerSegments: 6,
      material: fabric,
    },
    ...[-0.5, 0, 0.5].map((offset, index) => ({
      kind: 'rounded-panel' as const,
      name: `${name} seat pad ${index + 1}`,
      position: [
        position[0] + offset * width * 0.55,
        y + height * 0.45,
        position[2] + depth * 0.1,
      ] as Vec3,
      length: width * 0.29,
      width: depth * 0.58,
      thickness: height * 0.08,
      cornerRadius: height * 0.035,
      cornerSegments: 5,
      material: fabric,
    })),
    {
      kind: 'capsule',
      name: `${name} left rounded arm`,
      position: [position[0] - width * 0.53, y + height * 0.48, position[2] + depth * 0.04],
      axis: 'z',
      radius: height * 0.18,
      height: depth * 0.84,
      capSegments: 6,
      radialSegments: roundSegments(input.detail),
      material: fabric,
    },
    {
      kind: 'capsule',
      name: `${name} right rounded arm`,
      position: [position[0] + width * 0.53, y + height * 0.48, position[2] + depth * 0.04],
      axis: 'z',
      radius: height * 0.18,
      height: depth * 0.84,
      capSegments: 6,
      radialSegments: roundSegments(input.detail),
      material: fabric,
    },
    {
      kind: 'box',
      name: `${name} recessed shadow base`,
      position: [position[0], y + height * 0.12, position[2] + depth * 0.08],
      length: width * 0.88,
      width: depth * 0.62,
      height: height * 0.1,
      cornerRadius: height * 0.018,
      cornerSegments: 3,
      material: shadow,
    },
    ...[-0.18, 0.18].map((offset, index) => ({
      kind: 'box' as const,
      name: `${name} vertical cushion seam ${index + 1}`,
      position: [
        position[0] + offset * width,
        y + height * 0.48,
        position[2] + depth * 0.46,
      ] as Vec3,
      length: width * 0.012,
      width: depth * 0.018,
      height: height * 0.18,
      cornerRadius: height * 0.004,
      cornerSegments: 2,
      material: seam,
    })),
  ]
}

function composeKeyboard(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 0.72, 0.25, 1.4)
  const depth = clamp(input.depth ?? input.length, 0.26, 0.12, 0.7)
  const height = clamp(input.height, 0.055, 0.02, 0.2)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Compact keyboard'
  const base = material(input.primaryColor ?? '#111827', 0.45, 0.05)
  const key = material(input.secondaryColor ?? '#e5e7eb', 0.62, 0.0)
  const accent = material('#9ca3af', 0.5, 0.0)
  const y = position[1]
  const keyW = width * 0.085
  const keyD = depth * 0.18
  const keyH = height * 0.38
  const rows = [-0.26, 0, 0.26]
  const cols = [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36]

  return [
    {
      kind: 'rounded-panel',
      name: `${name} bevelled base tray`,
      position: [position[0], y + height * 0.34, position[2]],
      length: width,
      width: depth,
      thickness: height * 0.68,
      cornerRadius: Math.min(width, depth) * 0.08,
      cornerSegments: 6,
      material: base,
    },
    ...rows.flatMap((row, rowIndex) =>
      cols.map((col, colIndex) => ({
        kind: 'rounded-panel' as const,
        name: `${name} key ${rowIndex + 1}-${colIndex + 1}`,
        position: [position[0] + col * width, y + height * 0.88, position[2] + row * depth] as Vec3,
        length: keyW,
        width: keyD,
        thickness: keyH,
        cornerRadius: Math.min(keyW, keyD) * 0.18,
        cornerSegments: 4,
        material: key,
      })),
    ),
    {
      kind: 'rounded-panel',
      name: `${name} long spacebar`,
      position: [position[0], y + height * 0.9, position[2] + depth * 0.36],
      length: width * 0.38,
      width: keyD,
      thickness: keyH,
      cornerRadius: Math.min(keyW, keyD) * 0.18,
      cornerSegments: 4,
      material: accent,
    },
    {
      kind: 'sweep',
      name: `${name} cable`,
      position: [position[0], y + height * 0.72, position[2] - depth * 0.62],
      path: [
        [0, 0, depth * 0.12],
        [0, height * 0.03, -depth * 0.1],
        [width * 0.12, height * 0.02, -depth * 0.36],
      ],
      radius: height * 0.06,
      tubularSegments: 18,
      radialSegments: 8,
      material: base,
    },
  ]
}

function composeMonitor(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 0.9, 0.35, 2.0)
  const height = clamp(input.height, 0.62, 0.25, 1.4)
  const depth = clamp(input.depth ?? input.length, 0.12, 0.04, 0.45)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Modern monitor'
  const dark = material(input.primaryColor ?? '#111827', 0.42, 0.15)
  const screen = material(input.secondaryColor ?? '#0f172a', 0.18, 0.0)
  const metal = material('#6b7280', 0.38, 0.45)
  const y = position[1]
  const screenY = y + height * 0.72

  return [
    {
      kind: 'rounded-panel',
      name: `${name} thin outer bezel`,
      position: [position[0], screenY, position[2]],
      length: width,
      width: height * 0.62,
      thickness: depth,
      cornerRadius: Math.min(width, height) * 0.035,
      cornerSegments: 6,
      material: dark,
    },
    {
      kind: 'rounded-panel',
      name: `${name} recessed dark screen`,
      position: [position[0], screenY, position[2] + depth * 0.53],
      length: width * 0.9,
      width: height * 0.52,
      thickness: depth * 0.08,
      cornerRadius: Math.min(width, height) * 0.025,
      cornerSegments: 5,
      material: screen,
    },
    {
      kind: 'capsule',
      name: `${name} curved neck stand`,
      position: [position[0], y + height * 0.34, position[2] - depth * 0.18],
      axis: 'y',
      radius: width * 0.035,
      height: height * 0.34,
      capSegments: 5,
      radialSegments: 24,
      material: metal,
    },
    {
      kind: 'rounded-panel',
      name: `${name} weighted foot base`,
      position: [position[0], y + height * 0.08, position[2] - depth * 0.12],
      length: width * 0.46,
      width: depth * 2.4,
      thickness: height * 0.08,
      cornerRadius: width * 0.025,
      cornerSegments: 5,
      material: metal,
    },
    {
      kind: 'sweep',
      name: `${name} rear cable`,
      position: [position[0] + width * 0.16, y + height * 0.24, position[2] - depth * 0.42],
      path: [
        [0, height * 0.16, 0],
        [width * 0.05, 0, -depth * 0.42],
        [width * 0.12, -height * 0.16, -depth * 0.64],
      ],
      radius: width * 0.01,
      tubularSegments: 20,
      radialSegments: 8,
      material: dark,
    },
  ]
}

function composeTable(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 1.2, 0.5, 4.0)
  const depth = clamp(input.depth ?? input.length, 0.75, 0.4, 3.0)
  const height = clamp(input.height, 0.75, 0.35, 1.4)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? 'Low-poly table'
  const topMat = material(input.primaryColor ?? '#8b5a2b', 0.6, 0.02)
  const legMat = material(input.secondaryColor ?? input.primaryColor ?? '#6b3f1d', 0.65, 0.02)
  const topThickness = height * 0.08
  const legHeight = height - topThickness
  const legRadius = Math.min(width, depth) * 0.035
  const halfX = width * 0.42
  const halfZ = depth * 0.42

  return [
    {
      kind: 'box',
      name: `${name} top`,
      position: [position[0], position[1] + legHeight + topThickness / 2, position[2]],
      length: width,
      width: depth,
      height: topThickness,
      material: topMat,
    },
    ...(
      [
        [-halfX, -halfZ],
        [halfX, -halfZ],
        [-halfX, halfZ],
        [halfX, halfZ],
      ] as [number, number][]
    ).map(([x, z], index) => ({
      kind: 'cylinder' as const,
      name: `${name} leg ${index + 1}`,
      position: [position[0] + x, position[1] + legHeight / 2, position[2] + z] as Vec3,
      axis: 'y' as const,
      radius: legRadius,
      height: legHeight,
      radialSegments: 16,
      material: legMat,
    })),
  ]
}

function composeShelf(input: ObjectComposeInput, cabinet = false): PrimitiveShapeInput[] {
  const width = clamp(input.width, cabinet ? 0.9 : 1.0, 0.4, 3.0)
  const depth = clamp(input.depth ?? input.length, cabinet ? 0.42 : 0.3, 0.15, 1.2)
  const height = clamp(input.height, cabinet ? 1.2 : 1.6, 0.5, 3.0)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? (cabinet ? 'Low-poly cabinet' : 'Low-poly shelf')
  const frame = material(input.primaryColor ?? '#8b5a2b', 0.62, 0.02)
  const dark = material(input.secondaryColor ?? '#374151', 0.68, 0.0)
  const t = Math.min(width, height) * 0.045
  const shelves = cabinet ? [0.36, 0.68] : [0.25, 0.5, 0.75]
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${name} left side`,
      position: [position[0] - width / 2 + t / 2, position[1] + height / 2, position[2]],
      length: t,
      width: depth,
      height,
      material: frame,
    },
    {
      kind: 'box',
      name: `${name} right side`,
      position: [position[0] + width / 2 - t / 2, position[1] + height / 2, position[2]],
      length: t,
      width: depth,
      height,
      material: frame,
    },
    {
      kind: 'box',
      name: `${name} top`,
      position: [position[0], position[1] + height - t / 2, position[2]],
      length: width,
      width: depth,
      height: t,
      material: frame,
    },
    {
      kind: 'box',
      name: `${name} bottom`,
      position: [position[0], position[1] + t / 2, position[2]],
      length: width,
      width: depth,
      height: t,
      material: frame,
    },
    ...shelves.map((ratio, index) => ({
      kind: 'box' as const,
      name: `${name} shelf ${index + 1}`,
      position: [position[0], position[1] + height * ratio, position[2]] as Vec3,
      length: width - t * 2,
      width: depth * 0.96,
      height: t,
      material: frame,
    })),
  ]

  if (cabinet) {
    shapes.push({
      kind: 'box',
      name: `${name} front door hint`,
      position: [position[0], position[1] + height * 0.48, position[2] + depth / 2 + t * 0.2],
      length: width * 0.82,
      width: t * 0.5,
      height: height * 0.45,
      material: dark,
    })
  }

  return shapes
}

function composeGeneric(input: ObjectComposeInput): PrimitiveShapeInput[] {
  const width = clamp(input.width, 1.0, 0.1, 5.0)
  const depth = clamp(input.depth ?? input.length, 1.0, 0.1, 5.0)
  const height = clamp(input.height, 1.0, 0.1, 5.0)
  const position = input.position ?? [0, 0, 0]
  const name = input.name ?? input.model ?? 'Low-poly object'
  return [
    {
      kind: 'box',
      name: `${name} main volume`,
      position: [position[0], position[1] + height / 2, position[2]],
      length: width,
      width: depth,
      height,
      material: material(input.primaryColor ?? input.bodyColor ?? '#d1d5db', 0.6, 0.02),
    },
  ]
}

export function composeObjectPrimitives(input: ObjectComposeInput = {}): PrimitiveShapeInput[] {
  switch (normalizeCategory(input)) {
    case 'vehicle':
      return composeVehicle(input)
    case 'chair':
      return composeChair(input)
    case 'outdoor-ac':
      return composeOutdoorAc(input)
    case 'sofa':
      return composeSofa(input)
    case 'keyboard':
      return composeKeyboard(input)
    case 'monitor':
      return composeMonitor(input)
    case 'table':
      return composeTable(input)
    case 'shelf':
      return composeShelf(input)
    case 'cabinet':
      return composeShelf(input, true)
    default:
      return composeGeneric(input)
  }
}
