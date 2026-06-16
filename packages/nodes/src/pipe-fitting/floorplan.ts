import type { FloorplanGeometry, PipeFittingNode } from '@pascal-app/core'

function elbowPath(angleDegrees: number, radius: number) {
  const angle = (Math.min(180, Math.max(15, angleDegrees)) * Math.PI) / 180
  const endX = Math.cos(angle) * radius
  const endZ = Math.sin(angle) * radius
  return `M ${-radius} 0 L 0 0 L ${endX} ${endZ}`
}

export function buildPipeFittingFloorplan(node: PipeFittingNode): FloorplanGeometry {
  const [x, , z] = node.position
  const ry = node.rotation[1] ?? 0
  const strokeWidth = Math.max(node.diameter * 40, 3)
  const radius = Math.max(node.diameter, node.diameter * node.bendRadiusMultiplier)
  const len = Math.max(node.branchLength, node.diameter * 3)
  const children: FloorplanGeometry[] = []

  if (node.fittingKind === 'flange') {
    const outerRadius = Math.max(node.flangeOuterDiameter ?? node.diameter * 1.9, node.diameter * 1.25) / 2
    const boltRadius = Math.max(node.boltDiameter / 2, node.diameter * 0.035)
    const boltCircleRadius = Math.max((outerRadius + node.diameter / 2) / 2, node.diameter / 2 + boltRadius * 2)
    children.push(
      {
        kind: 'line',
        x1: -Math.max(node.length / 2, node.diameter),
        y1: 0,
        x2: Math.max(node.length / 2, node.diameter),
        y2: 0,
        stroke: node.color,
        strokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: outerRadius,
        fill: '#f8fafc',
        stroke: node.color,
        strokeWidth: 2,
      },
    )
    for (let index = 0; index < node.boltCount; index += 1) {
      const angle = (index / node.boltCount) * Math.PI * 2
      children.push({
        kind: 'circle',
        cx: Math.cos(angle) * boltCircleRadius,
        cy: Math.sin(angle) * boltCircleRadius,
        r: boltRadius,
        fill: '#374151',
        stroke: 'none',
      })
    }
  } else if (node.fittingKind === 'valve') {
    const half = Math.max(node.length / 2, node.diameter * 1.4)
    const body = Math.max(node.diameter * 0.9, 0.12)
    children.push(
      {
        kind: 'line',
        x1: -half,
        y1: 0,
        x2: half,
        y2: 0,
        stroke: node.color,
        strokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'polygon',
        points: [
          [-body, -body * 0.65],
          [body, -body * 0.65],
          [body, body * 0.65],
          [-body, body * 0.65],
        ],
        fill: '#f8fafc',
        stroke: node.color,
        strokeWidth: 2,
      },
    )
    if (node.valveStyle !== 'placeholder') {
      children.push({
        kind: 'circle',
        cx: 0,
        cy: -body * 1.25,
        r: body * 0.28,
        fill: 'none',
        stroke: node.color,
        strokeWidth: 2,
      })
    }
  } else if (node.fittingKind === 'elbow') {
    children.push({
      kind: 'path',
      d: elbowPath(node.angleDegrees, radius),
      stroke: node.color,
      strokeWidth,
      fill: 'none',
      vectorEffect: 'non-scaling-stroke',
    })
  } else {
    children.push(
      {
        kind: 'line',
        x1: -len,
        y1: 0,
        x2: len,
        y2: 0,
        stroke: node.color,
        strokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'line',
        x1: 0,
        y1: 0,
        x2: 0,
        y2: len,
        stroke: node.color,
        strokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      },
    )
    if (node.fittingKind === 'cross') {
      children.push({
        kind: 'line',
        x1: 0,
        y1: 0,
        x2: 0,
        y2: -len,
        stroke: node.color,
        strokeWidth,
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
      })
    }
  }

  children.push({
    kind: 'circle',
    cx: 0,
    cy: 0,
    r: 0.08,
    fill: '#ffffff',
    stroke: '#374151',
    strokeWidth: 1,
  })

  return { kind: 'group', transform: { translate: [x, z], rotate: ry }, children }
}
