import type { ColumnNode } from '@pascal-app/core'
export function getSegments(node: ColumnNode) {
  if (node.crossSection === 'octagonal') return 8
  if (node.crossSection === 'sixteen-sided') return 16
  return 32
}

function getShaftProfile(node: ColumnNode) {
  return node.shaftProfile ?? (node.shaftTaper > 0 ? 'tapered' : 'straight')
}

export function getShaftSegmentCount(node: ColumnNode) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = node.shaftTaper ?? 0
  const hasTwist = Math.abs(node.shaftTwistStep ?? 0) > 0.001
  return Math.max(
    hasTwist ? 4 : 1,
    shaftProfile === 'straight' && shaftTaper <= 0 && !hasTwist
      ? 1
      : (node.shaftSegmentCount ?? (hasTwist ? 12 : 24)),
  )
}

export function getShaftTwistRadians(node: ColumnNode, index: number) {
  return ((node.shaftTwistStep ?? 0) * Math.PI * index) / 180
}

export function getShaftScaleAt(node: ColumnNode, t: number) {
  const shaftProfile = getShaftProfile(node)
  const shaftTaper = Math.min(node.shaftTaper ?? 0, 0.85)
  const startScale = node.shaftStartScale ?? 0.72
  const endScale = node.shaftEndScale ?? startScale
  const shaftBulge =
    node.shaftBulge ??
    (shaftProfile === 'bulged'
      ? 0.16
      : shaftProfile === 'baluster'
        ? 0.2
        : shaftProfile === 'hourglass'
          ? 0.18
          : 0)
  const taperedScale = 1 - shaftTaper * t
  const linearScale = (startScale + (endScale - startScale) * t) * taperedScale
  const bulgeCurve = Math.sin(Math.PI * t)
  const hourglassCurve = Math.abs(t - 0.5) * 2
  const profileScale =
    shaftProfile === 'bulged' || shaftProfile === 'baluster'
      ? linearScale + shaftBulge * bulgeCurve
      : shaftProfile === 'hourglass'
        ? linearScale - shaftBulge * (1 - hourglassCurve)
        : linearScale

  return Math.max(0.1, profileScale)
}

export function columnShaftLayout(node: ColumnNode) {
  const baseHeight = node.baseStyle === 'none' ? 0 : Math.min(node.baseHeight, node.height * 0.4)
  const capitalHeight =
    node.capitalStyle === 'none' ? 0 : Math.min(node.capitalHeight, node.height * 0.4)
  const shaftHeight = Math.max(0.1, node.height - baseHeight - capitalHeight)
  return { baseHeight, capitalHeight, shaftY: baseHeight, shaftHeight }
}
export type CapitalBlock = {
  kind: 'box' | 'round' | 'oval' | 'column'
  y: number
  height: number
  width?: number
  depth?: number
  radius?: number
  scale?: number
}
export function columnCapitalBlocks(node: ColumnNode, y: number, height: number): CapitalBlock[] {
  const style = node.capitalStyle ?? 'simple'
  if (height <= 0 || style === 'none') return []
  if (style === 'south-indian-bracket' || style === 'wood-bracket') {
    const count = Math.max(1, node.bracketTierCount ?? 3)
    return Array.from({ length: count }, (_, index) => {
      const t = index / Math.max(1, count - 1),
        scale = (node.capitalWidthScale ?? 1.6) + t * 0.32
      return {
        kind: 'box',
        y: y + (index * height) / count,
        height: height / count,
        width: node.width * scale + (node.bracketDepth ?? 0.35) * t,
        depth: node.depth * scale + (node.bracketDepth ?? 0.35) * t,
      }
    })
  }
  if (style === 'rounded' || style === 'doric') {
    const width = node.width * (node.capitalWidthScale ?? 1.34),
      depth = node.depth * (node.capitalDepthScale ?? node.capitalWidthScale ?? 1.34)
    return [
      { kind: 'oval', y, height: height * 0.24, width: width * 0.72, depth: depth * 0.72 },
      {
        kind: 'oval',
        y: y + height * 0.24,
        height: height * 0.32,
        width: width * 0.92,
        depth: depth * 0.92,
      },
      { kind: 'box', y: y + height * 0.56, height: height * 0.44, width, depth },
    ]
  }
  if (style === 'stepped') {
    const widthScale = node.capitalWidthScale ?? 1.46,
      depthScale = node.capitalDepthScale ?? widthScale,
      count = Math.max(3, node.capitalTierCount ?? 3)
    return Array.from({ length: count }, (_, index) => {
      const t = index / Math.max(1, count - 1),
        spread = (1 - t) * (node.capitalStepSpread ?? 0.42)
      return {
        kind: 'box',
        y: y + (index * height) / count,
        height: (height / count) * 1.01,
        width: node.width * Math.max(0.5, widthScale - spread),
        depth: node.depth * Math.max(0.5, depthScale - spread),
      }
    })
  }
  if (['volute', 'ionic-volute', 'leaf-carved', 'corinthian-leaf'].includes(style)) {
    return [
      { kind: 'column', y, height: height * 0.24, scale: 0.9 },
      { kind: 'column', y: y + height * 0.24, height: height * 0.2, scale: 1.08 },
      {
        kind: 'box',
        y: y + height * 0.44,
        height: height * 0.28,
        width: node.width * (node.capitalWidthScale ?? 1.46),
        depth: node.depth * (node.capitalDepthScale ?? node.capitalWidthScale ?? 1.46),
      },
    ]
  }
  const widthScale = node.capitalWidthScale ?? (style === 'simple-slab' ? 1.28 : 1.18),
    depthScale = node.capitalDepthScale ?? widthScale
  return node.crossSection === 'square' || node.crossSection === 'rectangular'
    ? [{ kind: 'box', y, height, width: node.width * widthScale, depth: node.depth * depthScale }]
    : [
        {
          kind: 'round',
          y,
          height,
          radius: Math.max(node.radius * widthScale, node.width * widthScale * 0.5),
        },
      ]
}
