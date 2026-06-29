import { ROOF_SHAPE_DEFAULTS, type RoofType } from './roof-segment'

export type RoofShapeFaceVertex = {
  x: number
  y: number
  z: number
}

export type RoofShapeInsets = {
  iF?: number
  iB?: number
  iL?: number
  iR?: number
  dutchI?: number
}

export type RoofShapeRatios = {
  gambrelLowerWidthRatio: number
  mansardSteepWidthRatio: number
  dutchHipWidthRatio: number
  dutchHipHeightRatio: number
  dutchWaistLengthRatio: number
  dutchGabletRake: number
}

export function getRoofShapeRatios(input: {
  gambrelLowerWidthRatio?: number
  mansardSteepWidthRatio?: number
  dutchHipWidthRatio?: number
  dutchHipHeightRatio?: number
  dutchWaistLengthRatio?: number
  dutchGabletRake?: number
}): RoofShapeRatios {
  return {
    gambrelLowerWidthRatio:
      input.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio,
    mansardSteepWidthRatio:
      input.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio,
    dutchHipWidthRatio: input.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio,
    dutchHipHeightRatio: input.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio,
    dutchWaistLengthRatio: input.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio,
    dutchGabletRake: input.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake,
  }
}

export type DutchRoofShapeMetrics = {
  axis: 'width' | 'depth'
  inset: number
  middleHeight: number
  peakHeight: number
  rakeReach: number
  innerWaistHalfX: number
  innerWaistHalfZ: number
  outerWaistHalfX: number
  outerWaistHalfZ: number
}

export function getDutchRoofShapeMetrics(input: {
  w: number
  d: number
  wh: number
  rh: number
  dutchI?: number
  baseW: number
  baseD: number
  shapeRatios: RoofShapeRatios
}): DutchRoofShapeMetrics | null {
  const fallbackInset = Math.min(input.baseW, input.baseD) * input.shapeRatios.dutchHipWidthRatio
  const maxI = Math.max(0, Math.min(input.w, input.d) / 2 - 0.005)
  const inset = Math.min(Math.max(0, input.dutchI ?? fallbackInset), maxI)
  const peakHeight = input.wh + Math.max(0.001, input.rh)
  const middleHeight = input.wh + input.rh * input.shapeRatios.dutchHipHeightRatio
  if (!(inset > 0.001) || !(peakHeight > middleHeight + 0.001)) return null

  if (input.w >= input.d) {
    const innerWaistHalfX = Math.max(
      0,
      (input.w / 2 - inset) * input.shapeRatios.dutchWaistLengthRatio,
    )
    const innerWaistHalfZ = Math.max(0, input.d / 2 - inset)
    if (!(innerWaistHalfX > 0.001 && innerWaistHalfZ > 0.001)) return null

    const rakeReach = Math.min(
      Math.max(0, input.shapeRatios.dutchGabletRake),
      Math.max(0, input.w / 2 - innerWaistHalfX) * 0.98,
    )

    return {
      axis: 'width',
      inset,
      middleHeight,
      peakHeight,
      rakeReach,
      innerWaistHalfX,
      innerWaistHalfZ,
      outerWaistHalfX: innerWaistHalfX + rakeReach,
      outerWaistHalfZ: innerWaistHalfZ,
    }
  }

  const innerWaistHalfX = Math.max(0, input.w / 2 - inset)
  const innerWaistHalfZ = Math.max(
    0,
    (input.d / 2 - inset) * input.shapeRatios.dutchWaistLengthRatio,
  )
  if (!(innerWaistHalfX > 0.001 && innerWaistHalfZ > 0.001)) return null

  const rakeReach = Math.min(
    Math.max(0, input.shapeRatios.dutchGabletRake),
    Math.max(0, input.d / 2 - innerWaistHalfZ) * 0.98,
  )

  return {
    axis: 'depth',
    inset,
    middleHeight,
    peakHeight,
    rakeReach,
    innerWaistHalfX,
    innerWaistHalfZ,
    outerWaistHalfX: innerWaistHalfX,
    outerWaistHalfZ: innerWaistHalfZ + rakeReach,
  }
}

export function getRoofShapeInsets(input: {
  roofType: RoofType
  width: number
  depth: number
  wh: number
  baseY: number
  isVoid: boolean
  brushW: number
  brushD: number
  tanTheta: number
  shingleThickness: number
  dutchHipWidthRatio: number
}): RoofShapeInsets {
  let inset = (input.wh - input.baseY) * input.tanTheta
  const maxSafeInset = Math.min(input.brushW, input.brushD) / 2 - 0.005
  if (inset > maxSafeInset) inset = maxSafeInset

  let iF = 0
  let iB = 0
  let iL = 0
  let iR = 0
  if (input.roofType === 'hip' || input.roofType === 'mansard' || input.roofType === 'dutch') {
    iF = inset
    iB = inset
    iL = inset
    iR = inset
  } else if (input.roofType === 'gable' || input.roofType === 'gambrel') {
    iF = inset
    iB = inset
  } else if (input.roofType === 'shed') {
    iF = inset
  }

  let dutchI = Math.min(input.width, input.depth) * input.dutchHipWidthRatio
  if (input.isVoid) dutchI += input.shingleThickness
  return { iF, iB, iL, iR, dutchI }
}

export function getDutchEndSlopeFaces(input: {
  w: number
  d: number
  wh: number
  rh: number
  insets: RoofShapeInsets
  baseW: number
  baseD: number
  shapeRatios: RoofShapeRatios
  dutchTopRakeThickness?: number
}): RoofShapeFaceVertex[][] {
  const dutch = getDutchRoofShapeMetrics({
    w: input.w,
    d: input.d,
    wh: input.wh,
    rh: input.rh,
    dutchI: input.insets.dutchI,
    baseW: input.baseW,
    baseD: input.baseD,
    shapeRatios: input.shapeRatios,
  })
  if (!dutch) return []

  const v = (x: number, y: number, z: number): RoofShapeFaceVertex => ({ x, y, z })
  const e1 = v(-input.w / 2, input.wh, input.d / 2)
  const e2 = v(input.w / 2, input.wh, input.d / 2)
  const e3 = v(input.w / 2, input.wh, -input.d / 2)
  const e4 = v(-input.w / 2, input.wh, -input.d / 2)

  // The hip end slope is constructed only up to the outer waist (rake) line.
  // Extend its top edge inward along the same hip rulings until it reaches the
  // gablet's inner triangle (the inner waist line), continuing each
  // eave→outer-waist ridge line so the face stays planar and the pitch is
  // unchanged — the edge climbs past middleHeight and meets the gablet face.
  const lerp = (a: RoofShapeFaceVertex, b: RoofShapeFaceVertex, t: number): RoofShapeFaceVertex =>
    v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
  const lowerAlongY = (point: RoofShapeFaceVertex): RoofShapeFaceVertex =>
    v(point.x, point.y - Math.max(0, input.dutchTopRakeThickness ?? 0), point.z)

  if (dutch.axis === 'width') {
    const o1 = v(-dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const o2 = v(dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const o3 = v(dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
    const o4 = v(-dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
    const m1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const m2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const m3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
    const m4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
    const r1 = v(-dutch.innerWaistHalfX, input.wh + input.rh, 0)
    const r2 = v(dutch.innerWaistHalfX, input.wh + input.rh, 0)
    const projectWidthAxisPointToEndSlope = (
      point: RoofShapeFaceVertex,
      side: 1 | -1,
    ): RoofShapeFaceVertex => {
      const denomY = dutch.middleHeight - input.wh
      const tPlane = Math.abs(denomY) > 1e-9 ? (point.y - input.wh) / denomY : 0
      const x = side * (input.w / 2 + (dutch.outerWaistHalfX - input.w / 2) * tPlane)
      return v(x, point.y, point.z)
    }
    const top2 = projectWidthAxisPointToEndSlope(lowerAlongY(lerp(m2, r2, 0.5)), 1)
    const top3 = projectWidthAxisPointToEndSlope(lowerAlongY(lerp(m3, r2, 0.5)), 1)
    const top1 = projectWidthAxisPointToEndSlope(lowerAlongY(lerp(m1, r1, 0.5)), -1)
    const top4 = projectWidthAxisPointToEndSlope(lowerAlongY(lerp(m4, r1, 0.5)), -1)
    return [
      [e2, e3, o3, top3, top2, o2],
      [e4, e1, o1, top1, top4, o4],
    ]
  }

  const o1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
  const o2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
  const o3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
  const o4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
  const m1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
  const m2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
  const m3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
  const m4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
  const r1 = v(0, input.wh + input.rh, dutch.innerWaistHalfZ)
  const r2 = v(0, input.wh + input.rh, -dutch.innerWaistHalfZ)
  const projectDepthAxisPointToEndSlope = (
    point: RoofShapeFaceVertex,
    side: 1 | -1,
  ): RoofShapeFaceVertex => {
    const denomY = dutch.middleHeight - input.wh
    const tPlane = Math.abs(denomY) > 1e-9 ? (point.y - input.wh) / denomY : 0
    const z = side * (input.d / 2 + (dutch.outerWaistHalfZ - input.d / 2) * tPlane)
    return v(point.x, point.y, z)
  }
  const top2 = projectDepthAxisPointToEndSlope(lowerAlongY(lerp(m2, r1, 0.5)), 1)
  const top1 = projectDepthAxisPointToEndSlope(lowerAlongY(lerp(m1, r1, 0.5)), 1)
  const top4 = projectDepthAxisPointToEndSlope(lowerAlongY(lerp(m4, r2, 0.5)), -1)
  const top3 = projectDepthAxisPointToEndSlope(lowerAlongY(lerp(m3, r2, 0.5)), -1)
  return [
    [e1, e2, o2, top2, top1, o1],
    [e3, e4, o4, top4, top3, o3],
  ]
}

export function getRoofModuleFaces(input: {
  type: RoofType
  w: number
  d: number
  wh: number
  rh: number
  baseY: number
  insets: RoofShapeInsets
  baseW: number
  baseD: number
  tanTheta: number
  shapeRatios: RoofShapeRatios
  excludeDutchEndSlopes?: boolean
  dutchTopRakeThickness?: number
}): RoofShapeFaceVertex[][] {
  const v = (x: number, y: number, z: number): RoofShapeFaceVertex => ({ x, y, z })
  const { iF = 0, iB = 0, iL = 0, iR = 0 } = input.insets

  const b1 = v(-input.w / 2 + iL, input.baseY, input.d / 2 - iF)
  const b2 = v(input.w / 2 - iR, input.baseY, input.d / 2 - iF)
  const b3 = v(input.w / 2 - iR, input.baseY, -input.d / 2 + iB)
  const b4 = v(-input.w / 2 + iL, input.baseY, -input.d / 2 + iB)
  const bottom = [b4, b3, b2, b1]

  const e1 = v(-input.w / 2, input.wh, input.d / 2)
  const e2 = v(input.w / 2, input.wh, input.d / 2)
  const e3 = v(input.w / 2, input.wh, -input.d / 2)
  const e4 = v(-input.w / 2, input.wh, -input.d / 2)

  const faces: RoofShapeFaceVertex[][] = []
  faces.push([b1, b2, e2, e1], [b2, b3, e3, e2], [b3, b4, e4, e3], [b4, b1, e1, e4], bottom)

  const h = input.wh + Math.max(0.001, input.rh)

  if (input.type === 'flat' || input.rh === 0) {
    faces.push([e1, e2, e3, e4])
  } else if (input.type === 'gable') {
    const r1 = v(-input.w / 2, h, 0)
    const r2 = v(input.w / 2, h, 0)
    faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
  } else if (input.type === 'hip') {
    if (Math.abs(input.w - input.d) < 0.01) {
      const r = v(0, h, 0)
      faces.push([e4, e1, r], [e1, e2, r], [e2, e3, r], [e3, e4, r])
    } else if (input.w >= input.d) {
      const r1 = v(-input.w / 2 + input.d / 2, h, 0)
      const r2 = v(input.w / 2 - input.d / 2, h, 0)
      faces.push([e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2])
    } else {
      const r1 = v(0, h, input.d / 2 - input.w / 2)
      const r2 = v(0, h, -input.d / 2 + input.w / 2)
      faces.push([e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2])
    }
  } else if (input.type === 'shed') {
    const t1 = v(-input.w / 2, h, -input.d / 2)
    const t2 = v(input.w / 2, h, -input.d / 2)
    faces.push([e1, e2, t2, t1], [e2, e3, t2], [e3, e4, t1, t2], [e4, e1, t1])
  } else if (input.type === 'gambrel') {
    const mz = (input.baseD / 2) * input.shapeRatios.gambrelLowerWidthRatio
    const dist = input.d / 2 - mz
    const mh = input.wh + dist * (input.tanTheta || 0)

    const m1 = v(-input.w / 2, mh, mz)
    const m2 = v(input.w / 2, mh, mz)
    const m3 = v(input.w / 2, mh, -mz)
    const m4 = v(-input.w / 2, mh, -mz)
    const r1 = v(-input.w / 2, h, 0)
    const r2 = v(input.w / 2, h, 0)
    faces.push(
      [e4, e1, m1, r1, m4],
      [e2, e3, m3, r2, m2],
      [e1, e2, m2, m1],
      [m1, m2, r2, r1],
      [e3, e4, m4, m3],
      [m3, m4, r1, r2],
    )
  } else if (input.type === 'mansard') {
    const i = Math.min(input.baseW, input.baseD) * input.shapeRatios.mansardSteepWidthRatio
    const mh = input.wh + i * (input.tanTheta || 0)

    const m1 = v(-input.w / 2 + i, mh, input.d / 2 - i)
    const m2 = v(input.w / 2 - i, mh, input.d / 2 - i)
    const m3 = v(input.w / 2 - i, mh, -input.d / 2 + i)
    const m4 = v(-input.w / 2 + i, mh, -input.d / 2 + i)
    const topW = input.w - i * 2
    const topD = input.d - i * 2

    faces.push([e1, e2, m2, m1], [e2, e3, m3, m2], [e3, e4, m4, m3], [e4, e1, m1, m4])

    if (Math.abs(topW - topD) < 0.01) {
      const r = v(0, h, 0)
      faces.push([m4, m1, r], [m1, m2, r], [m2, m3, r], [m3, m4, r])
    } else if (topW >= topD) {
      const r1 = v(-topW / 2 + topD / 2, h, 0)
      const r2 = v(topW / 2 - topD / 2, h, 0)
      faces.push([m4, m1, r1], [m2, m3, r2], [m1, m2, r2, r1], [m3, m4, r1, r2])
    } else {
      const r1 = v(0, h, topD / 2 - topW / 2)
      const r2 = v(0, h, -topD / 2 + topW / 2)
      faces.push([m1, m2, r1], [m3, m4, r2], [m2, m3, r2, r1], [m4, m1, r1, r2])
    }
  } else if (input.type === 'dutch') {
    const dutch = getDutchRoofShapeMetrics({
      w: input.w,
      d: input.d,
      wh: input.wh,
      rh: input.rh,
      dutchI: input.insets.dutchI,
      baseW: input.baseW,
      baseD: input.baseD,
      shapeRatios: input.shapeRatios,
    })
    if (!dutch) return faces

    const m1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const m2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
    const m3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
    const m4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)

    if (dutch.axis === 'width') {
      const o1 = v(-dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const o2 = v(dutch.outerWaistHalfX, dutch.middleHeight, dutch.innerWaistHalfZ)
      const o3 = v(dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const o4 = v(-dutch.outerWaistHalfX, dutch.middleHeight, -dutch.innerWaistHalfZ)
      const r1 = v(-dutch.innerWaistHalfX, h, 0)
      const r2 = v(dutch.innerWaistHalfX, h, 0)
      const endSlopes = input.excludeDutchEndSlopes
        ? []
        : getDutchEndSlopeFaces({
            w: input.w,
            d: input.d,
            wh: input.wh,
            rh: input.rh,
            insets: input.insets,
            baseW: input.baseW,
            baseD: input.baseD,
            shapeRatios: input.shapeRatios,
            dutchTopRakeThickness: input.dutchTopRakeThickness,
          })
      faces.push([e1, e2, o2, m2, m1, o1], [e3, e4, o4, m4, m3, o3])
      if (endSlopes.length === 2) {
        faces.push(...endSlopes)
      } else if (!input.excludeDutchEndSlopes) {
        faces.push([e2, e3, o3, o2], [e4, e1, o1, o4])
      }
      faces.push([m1, m2, r2, r1], [m3, m4, r1, r2])
      faces.push([m4, m1, r1], [m2, m3, r2])
    } else {
      const o1 = v(-dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
      const o2 = v(dutch.innerWaistHalfX, dutch.middleHeight, dutch.outerWaistHalfZ)
      const o3 = v(dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
      const o4 = v(-dutch.innerWaistHalfX, dutch.middleHeight, -dutch.outerWaistHalfZ)
      const r1 = v(0, h, dutch.innerWaistHalfZ)
      const r2 = v(0, h, -dutch.innerWaistHalfZ)
      const endSlopes = input.excludeDutchEndSlopes
        ? []
        : getDutchEndSlopeFaces({
            w: input.w,
            d: input.d,
            wh: input.wh,
            rh: input.rh,
            insets: input.insets,
            baseW: input.baseW,
            baseD: input.baseD,
            shapeRatios: input.shapeRatios,
            dutchTopRakeThickness: input.dutchTopRakeThickness,
          })
      faces.push([e2, e3, o3, m3, m2, o2], [e4, e1, o1, m1, m4, o4])
      if (endSlopes.length === 2) {
        faces.push(...endSlopes)
      } else if (!input.excludeDutchEndSlopes) {
        faces.push([e1, e2, o2, o1], [e3, e4, o4, o3])
      }
      faces.push([m2, m3, r2, r1], [m4, m1, r1, r2])
      faces.push([m1, m2, r1], [m3, m4, r2])
    }
  }

  return faces
}
