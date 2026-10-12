import { GuidRegistry } from './guid'
import {
  DERIVED,
  enumValue,
  formatReal,
  int,
  raw,
  type StepRef,
  type StepValue,
  StepWriter,
  typed,
} from './step'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

/** A right-handed IFC frame: origin plus a rotation about +Z (plan angle, radians). */
export interface PlanFrame {
  origin: Vec3
  angle: number
}

export const IDENTITY_FRAME: PlanFrame = { origin: [0, 0, 0], angle: 0 }

export function frameToLocal(frame: PlanFrame, point: Vec3): Vec3 {
  const dx = point[0] - frame.origin[0]
  const dy = point[1] - frame.origin[1]
  const c = Math.cos(frame.angle)
  const s = Math.sin(frame.angle)
  return [dx * c + dy * s, -dx * s + dy * c, point[2] - frame.origin[2]]
}

/** `child` expressed relative to `parent` (both in the same parent space). */
export function relativeFrame(parent: PlanFrame, child: PlanFrame): PlanFrame {
  return { origin: frameToLocal(parent, child.origin), angle: child.angle - parent.angle }
}

export function signedArea(points: readonly Vec2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  return area / 2
}

/** Drop repeated and closing vertices; returns [] for degenerate rings. */
export function cleanRing(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 1e-6) continue
    out.push(point)
  }
  while (out.length > 1) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) >= 1e-6) break
    out.pop()
  }
  return out.length >= 3 && Math.abs(signedArea(out)) > 1e-9 ? out : []
}

export function orientRing(points: Vec2[], counterClockwise: boolean): Vec2[] {
  return signedArea(points) > 0 === counterClockwise ? points : [...points].reverse()
}

export interface IfcColor {
  rgb: Vec3
  opacity: number
}

export interface TriangleSet {
  /** Local coordinates, flat XYZ. */
  positions: ArrayLike<number>
  indices: ArrayLike<number>
  color?: IfcColor
}

const MESH_DECIMALS = 5

/**
 * IFC4 entity builders shared by the scene mapper. Keeps attribute order for
 * each entity in one place; the mapper only deals with Pascal semantics.
 */
export class IfcModel {
  readonly step = new StepWriter()
  readonly guids = new GuidRegistry()
  ownerHistory: StepRef | null = null
  bodyContext!: StepRef
  axisContext!: StepRef
  private readonly styleCache = new Map<string, StepRef>()

  guid(seed: string, preferred?: unknown): string {
    return this.guids.claim(seed, preferred)
  }

  point2(p: Vec2): StepRef {
    return this.step.addShared('IFCCARTESIANPOINT', [p[0], p[1]])
  }

  point3(p: Vec3): StepRef {
    return this.step.addShared('IFCCARTESIANPOINT', [p[0], p[1], p[2]])
  }

  direction(d: readonly number[]): StepRef {
    return this.step.addShared(
      'IFCDIRECTION',
      d.map((v) => Math.round(v * 1e12) / 1e12),
    )
  }

  axis2Placement3D(frame: PlanFrame): StepRef {
    const identityRotation = Math.abs(frame.angle) < 1e-12
    return this.step.add(
      'IFCAXIS2PLACEMENT3D',
      this.point3(frame.origin),
      identityRotation ? null : this.direction([0, 0, 1]),
      identityRotation ? null : this.direction([Math.cos(frame.angle), Math.sin(frame.angle), 0]),
    )
  }

  localPlacement(relativeTo: StepRef | null, frame: PlanFrame): StepRef {
    return this.step.add('IFCLOCALPLACEMENT', relativeTo, this.axis2Placement3D(frame))
  }

  polyline2(points: readonly Vec2[], closed: boolean): StepRef {
    const refs = points.map((p) => this.point2(p))
    if (closed && refs.length > 0) refs.push(refs[0]!)
    return this.step.add('IFCPOLYLINE', refs)
  }

  /** Outer ring CCW, holes CW; rings must already be cleaned. */
  polygonProfile(outer: Vec2[], holes: Vec2[][] = []): StepRef {
    const outerCurve = this.polyline2(orientRing(outer, true), true)
    if (holes.length === 0) {
      return this.step.add('IFCARBITRARYCLOSEDPROFILEDEF', enumValue('AREA'), null, outerCurve)
    }
    return this.step.add(
      'IFCARBITRARYPROFILEDEFWITHVOIDS',
      enumValue('AREA'),
      null,
      outerCurve,
      holes.map((hole) => this.polyline2(orientRing(hole, false), true)),
    )
  }

  rectangleProfile(xDim: number, yDim: number, center: Vec2 = [0, 0]): StepRef {
    const position = this.step.add('IFCAXIS2PLACEMENT2D', this.point2(center), null)
    return this.step.add('IFCRECTANGLEPROFILEDEF', enumValue('AREA'), null, position, xDim, yDim)
  }

  iShapeProfile(
    overallWidth: number,
    overallDepth: number,
    webThickness: number,
    flangeThickness: number,
  ): StepRef {
    const position = this.step.add('IFCAXIS2PLACEMENT2D', this.point2([0, 0]), null)
    return this.step.add(
      'IFCISHAPEPROFILEDEF',
      enumValue('AREA'),
      null,
      position,
      overallWidth,
      overallDepth,
      webThickness,
      flangeThickness,
      null,
      null,
      null,
    )
  }

  circleProfile(radius: number): StepRef {
    const position = this.step.add('IFCAXIS2PLACEMENT2D', this.point2([0, 0]), null)
    return this.step.add('IFCCIRCLEPROFILEDEF', enumValue('AREA'), null, position, radius)
  }

  /**
   * Prism of `profile` from local z = `bottom`, `depth` along `direction`:
   * upright by default, oblique for a leaning element.
   */
  extrusion(
    profile: StepRef,
    bottom: number,
    depth: number,
    color?: IfcColor,
    direction: Vec3 = [0, 0, 1],
  ): StepRef {
    const solid = this.step.add(
      'IFCEXTRUDEDAREASOLID',
      profile,
      this.axis2Placement3D({ origin: [0, 0, bottom], angle: 0 }),
      this.direction(direction),
      depth,
    )
    if (color) this.styleItem(solid, color)
    return solid
  }

  triangulatedFaceSet(set: TriangleSet): StepRef | null {
    const { positions, indices } = set
    const vertexCount = Math.floor(positions.length / 3)
    if (vertexCount < 3) return null
    const triangles: string[] = []
    const indexCount = indices.length > 0 ? indices.length : vertexCount
    for (let i = 0; i + 2 < indexCount; i += 3) {
      const a = indices.length > 0 ? indices[i]! : i
      const b = indices.length > 0 ? indices[i + 1]! : i + 1
      const c = indices.length > 0 ? indices[i + 2]! : i + 2
      if (a === b || b === c || a === c) continue
      if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue
      triangles.push(`(${a + 1},${b + 1},${c + 1})`)
    }
    if (triangles.length === 0) return null
    const coords: string[] = []
    for (let i = 0; i < vertexCount; i++) {
      coords.push(
        `(${formatReal(positions[i * 3]!, MESH_DECIMALS)},${formatReal(positions[i * 3 + 1]!, MESH_DECIMALS)},${formatReal(positions[i * 3 + 2]!, MESH_DECIMALS)})`,
      )
    }
    const pointList = this.step.add('IFCCARTESIANPOINTLIST3D', raw(`(${coords.join(',')})`))
    const faceSet = this.step.add(
      'IFCTRIANGULATEDFACESET',
      pointList,
      null,
      null,
      raw(`(${triangles.join(',')})`),
      null,
    )
    if (set.color) this.styleItem(faceSet, set.color)
    return faceSet
  }

  private surfaceStyle(color: IfcColor): StepRef {
    const [r, g, b] = color.rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 1000) / 1000)
    const transparency = Math.round((1 - Math.max(0, Math.min(1, color.opacity))) * 1000) / 1000
    const key = `${r},${g},${b},${transparency}`
    const cached = this.styleCache.get(key)
    if (cached) return cached
    const rgb = this.step.add('IFCCOLOURRGB', null, r!, g!, b!)
    const shading = this.step.add('IFCSURFACESTYLESHADING', rgb, transparency)
    const style = this.step.add('IFCSURFACESTYLE', null, enumValue('BOTH'), [shading])
    this.styleCache.set(key, style)
    return style
  }

  styleItem(item: StepRef, color: IfcColor): void {
    this.step.add('IFCSTYLEDITEM', item, [this.surfaceStyle(color)], null)
  }

  shape(representations: StepRef[]): StepRef {
    return this.step.add('IFCPRODUCTDEFINITIONSHAPE', null, null, representations)
  }

  bodyRepresentation(type: 'SweptSolid' | 'Tessellation', items: StepRef[]): StepRef {
    return this.step.add('IFCSHAPEREPRESENTATION', this.bodyContext, 'Body', type, items)
  }

  axisRepresentation(curve: StepRef): StepRef {
    return this.step.add('IFCSHAPEREPRESENTATION', this.axisContext, 'Axis', 'Curve2D', [curve])
  }

  rel(type: string, seed: string, ...args: StepValue[]): StepRef {
    return this.step.add(type, this.guid(seed), this.ownerHistory, null, null, ...args)
  }

  propertySet(
    seed: string,
    name: string,
    properties: Array<[string, StepValue]>,
    relatedObjects: StepRef[],
  ): void {
    const props = properties
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([propName, value]) =>
        this.step.add('IFCPROPERTYSINGLEVALUE', propName, null, value, null),
      )
    if (props.length === 0 || relatedObjects.length === 0) return
    const pset = this.step.add(
      'IFCPROPERTYSET',
      this.guid(`${seed}:pset:${name}`),
      this.ownerHistory,
      name,
      null,
      props,
    )
    this.rel('IFCRELDEFINESBYPROPERTIES', `${seed}:rel:${name}`, relatedObjects, pset)
  }

  lengthQuantities(
    seed: string,
    name: string,
    quantities: Array<[string, number]>,
    relatedObjects: StepRef[],
  ): void {
    const refs = quantities.map(([qName, value]) =>
      this.step.add('IFCQUANTITYLENGTH', qName, null, null, value, null),
    )
    const set = this.step.add(
      'IFCELEMENTQUANTITY',
      this.guid(`${seed}:qto:${name}`),
      this.ownerHistory,
      name,
      null,
      null,
      refs,
    )
    this.rel('IFCRELDEFINESBYPROPERTIES', `${seed}:rel:${name}`, relatedObjects, set)
  }
}

export const label = (value: string) => typed('IFCLABEL', value)
export const identifier = (value: string) => typed('IFCIDENTIFIER', value)
export const text = (value: string) => typed('IFCTEXT', value)
export const bool = (value: boolean) => typed('IFCBOOLEAN', value)
export const length = (value: number) => typed('IFCLENGTHMEASURE', value)
export const ratio = (value: number) => typed('IFCPOSITIVERATIOMEASURE', value)
export { DERIVED, enumValue, int }
