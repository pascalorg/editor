import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ColumnNode,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DoorNode,
  LevelNode,
  RoofNode,
  SiteNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { customAlphabet } from 'nanoid'
import * as WebIFC from 'web-ifc'

export type PascalNode = AnyNode

export interface PascalSceneGraph {
  nodes: Record<AnyNodeId, AnyNode>
  rootNodeIds: AnyNodeId[]
  collections?: Record<string, unknown>
}

// Pascal's BaseNode.metadata is typed as `JSONType` (z.json()) — a loose
// JSON value. The converter writes a fixed shape; this typed accessor
// keeps dot-access ergonomics without spraying `as any` through the
// post-processing loops. Read-side only — writes still inline literals.
type ConverterMetadata = {
  ifcType?: string
  expressID?: number
  globalId?: string
  levelId?: string
  material?: string
  materialLayers?: { name: string; thickness?: number }[]
  typeName?: string
  properties?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

function meta(node: { metadata?: unknown } | null | undefined): ConverterMetadata {
  return (node?.metadata ?? {}) as ConverterMetadata
}

// Pascal's `BaseNode.metadata` is `z.json()` — a recursive JSON value
// type that doesn't accept `undefined` (JSON has `null`, not undefined).
// The converter pulls many fields from optional IFC properties that
// often return `undefined`; stripping them at the boundary keeps the
// schemas happy without spraying `?? null` through every assignment.
function buildMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

// Wraps a Zod `.parse()` call and surfaces a single-line readable error
// instead of the framework's JSON-stringified issue list. The first
// issue is usually the actionable one; we mention the count if there
// are more so the user knows there's a deeper problem.
function tryParse<T>(schema: { parse: (input: unknown) => T }, kind: string, input: unknown): T {
  try {
    return schema.parse(input)
  } catch (err) {
    const issues = (err as { issues?: { path?: (string | number)[]; message?: string }[] }).issues
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0]
      const path =
        first && Array.isArray(first.path) && first.path.length > 0
          ? ` at "${first.path.join('.')}"`
          : ''
      const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : ''
      throw new Error(
        `Could not build ${kind} node${path}: ${first?.message ?? 'schema mismatch'}${more}`,
      )
    }
    throw err
  }
}

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)

function generateId<T extends string>(prefix: T): `${T}_${string}` {
  return `${prefix}_${nanoid()}` as `${T}_${string}`
}

// --- Unit detection ---

function getLengthUnitFactor(ifcApi: WebIFC.IfcAPI, modelID: number): number {
  const prefixFactors: Record<string, number> = {
    EXA: 1e18,
    PETA: 1e15,
    TERA: 1e12,
    GIGA: 1e9,
    MEGA: 1e6,
    KILO: 1e3,
    HECTO: 1e2,
    DECA: 1e1,
    DECI: 1e-1,
    CENTI: 1e-2,
    MILLI: 1e-3,
    MICRO: 1e-6,
    NANO: 1e-9,
    PICO: 1e-12,
    FEMTO: 1e-15,
    ATTO: 1e-18,
  }

  try {
    const projects = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT)
    if (projects.size() === 0) return 1

    const proj = ifcApi.GetLine(modelID, projects.get(0))
    if (!proj.UnitsInContext?.value) return 1

    const unitAssign = ifcApi.GetLine(modelID, proj.UnitsInContext.value)
    if (!unitAssign.Units) return 1

    for (const unitRef of unitAssign.Units) {
      const unit = ifcApi.GetLine(modelID, unitRef.value)
      if (unit.UnitType?.value !== 'LENGTHUNIT') continue

      if (unit.Name?.value === 'METRE' || unit.Name?.value === 'METER') {
        const prefix = unit.Prefix?.value as string | undefined
        return prefix ? (prefixFactors[prefix] ?? 1) : 1
      }

      if (unit.Name?.value === 'FOOT' || unit.Name?.value === 'FEET') {
        return 0.3048
      }
      if (unit.Name?.value === 'INCH') {
        return 0.0254
      }

      // ConversionBasedUnit — read the conversion factor
      if (unit.ConversionFactor?.value) {
        const factor = ifcApi.GetLine(modelID, unit.ConversionFactor.value)
        if (factor.ValueComponent?.value) {
          return factor.ValueComponent.value
        }
      }
    }
  } catch {
    // fall through
  }

  return 1
}

// --- 4x4 matrix math ---

type Mat4 = number[]

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16).fill(0)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) {
        r[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col]
      }
    }
  }
  return r
}

function transformPoint3(m: Mat4, p: number[]): number[] {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ]
}

function buildAxis2Placement3DMatrix(
  ifcApi: WebIFC.IfcAPI,
  modelID: number,
  axis2Id: number,
): Mat4 {
  const axis2 = ifcApi.GetLine(modelID, axis2Id)

  const num = (v: any): number | undefined => {
    if (v == null) return undefined
    if (typeof v === 'number') return v
    if (v.value != null) return v.value
    return undefined
  }

  let ox = 0,
    oy = 0,
    oz = 0
  if (axis2.Location?.value) {
    const loc = ifcApi.GetLine(modelID, axis2.Location.value)
    const coords = loc.Coordinates.map((c: any) => num(c))
    ox = coords[0] ?? 0
    oy = coords[1] ?? 0
    oz = coords[2] ?? 0
  }

  // Z-axis (Axis direction) — default (0,0,1)
  let zx = 0,
    zy = 0,
    zz = 1
  if (axis2.Axis?.value) {
    const ax = ifcApi.GetLine(modelID, axis2.Axis.value)
    const d = ax.DirectionRatios.map((c: any) => num(c))
    if (d[0] != null) {
      zx = d[0]
      zy = d[1] ?? 0
      zz = d[2] ?? 0
    }
  }

  // X-axis (RefDirection) — default (1,0,0)
  let xx = 1,
    xy = 0,
    xz = 0
  if (axis2.RefDirection?.value) {
    const rd = ifcApi.GetLine(modelID, axis2.RefDirection.value)
    const d = rd.DirectionRatios.map((c: any) => num(c))
    if (d[0] != null) {
      xx = d[0]
      xy = d[1] ?? 0
      xz = d[2] ?? 0
    }
  }

  // Normalize Z
  const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1
  zx /= zLen
  zy /= zLen
  zz /= zLen

  // Y = Z cross X, then normalize
  let yx = zy * xz - zz * xy
  let yy = zz * xx - zx * xz
  let yz = zx * xy - zy * xx
  const yLen = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1
  yx /= yLen
  yy /= yLen
  yz /= yLen

  // Recompute X = Y cross Z to ensure orthonormal
  xx = yy * zz - yz * zy
  xy = yz * zx - yx * zz
  xz = yx * zy - yy * zx

  // Row-major 4x4
  return [xx, yx, zx, ox, xy, yy, zy, oy, xz, yz, zz, oz, 0, 0, 0, 1]
}

// --- Placement chain resolver ---

function resolveWorldTransform(ifcApi: WebIFC.IfcAPI, modelID: number, placementId: number): Mat4 {
  const chain: number[] = []
  let current: number | null = placementId

  while (current) {
    const placement = ifcApi.GetLine(modelID, current)
    if (placement.RelativePlacement?.value) {
      chain.push(placement.RelativePlacement.value)
    }
    current = placement.PlacementRelTo?.value ?? null
  }

  // Multiply from root to leaf
  let result = identity()
  for (let i = chain.length - 1; i >= 0; i--) {
    const mat = buildAxis2Placement3DMatrix(ifcApi, modelID, chain[i])
    result = multiply(result, mat)
  }
  return result
}

// --- Geometry extraction helpers ---

function getAxisPolyline(ifcApi: WebIFC.IfcAPI, modelID: number, element: any): number[][] | null {
  try {
    if (!element.Representation?.value) return null
    const prodRep = ifcApi.GetLine(modelID, element.Representation.value)
    for (const repRef of prodRep.Representations) {
      const rep = ifcApi.GetLine(modelID, repRef.value)
      if (rep.RepresentationIdentifier?.value !== 'Axis') continue
      for (const itemRef of rep.Items) {
        const item = ifcApi.GetLine(modelID, itemRef.value)

        // IFCPOLYLINE — Points is an array of CartesianPoint references
        if (Array.isArray(item.Points)) {
          const points: number[][] = []
          for (const ptRef of item.Points) {
            const pt = ifcApi.GetLine(modelID, ptRef.value)
            const coords = pt.Coordinates.map((c: any) =>
              typeof c === 'number' ? c : (c?.value ?? 0),
            )
            points.push([coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0])
          }
          if (points.length >= 2) return points
        }

        // IFCINDEXEDPOLYCURVE — Points is a reference to a point list entity
        if (item.Points?.value && !Array.isArray(item.Points)) {
          const ptList = ifcApi.GetLine(modelID, item.Points.value)
          if (ptList.CoordList) {
            const points: number[][] = []
            for (const coords of ptList.CoordList) {
              const c = Array.isArray(coords)
                ? coords.map((v: any) => (typeof v === 'number' ? v : (v?.value ?? 0)))
                : []
              points.push([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0])
            }
            if (points.length >= 2) return points
          }
        }

        // IFCGEOMETRICSET — unwrap to find an inner curve
        if (item.Elements) {
          for (const elemRef of item.Elements) {
            const inner = ifcApi.GetLine(modelID, elemRef.value)
            if (inner.Points?.value) {
              const ptList = ifcApi.GetLine(modelID, inner.Points.value)
              if (ptList.CoordList) {
                const points: number[][] = []
                for (const coords of ptList.CoordList) {
                  const c = Array.isArray(coords)
                    ? coords.map((v: any) => (typeof v === 'number' ? v : (v?.value ?? 0)))
                    : []
                  points.push([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0])
                }
                if (points.length >= 2) return points
              }
            }
          }
        }
      }
    }
  } catch {
    // fall through
  }
  return null
}

type ExtrusionData = {
  depth: number | null
  xDim: number | null
  yDim: number | null
  profilePoints: number[][] | null
}

function extractFromExtrusionItem(
  ifcApi: WebIFC.IfcAPI,
  modelID: number,
  item: any,
  result: ExtrusionData,
): boolean {
  // Unwrap BooleanClippingResult → follow FirstOperand chain to find extrusion
  let current = item
  for (let guard = 0; guard < 10; guard++) {
    if (current.Depth?.value) break
    if (current.FirstOperand?.value) {
      current = ifcApi.GetLine(modelID, current.FirstOperand.value)
    } else {
      break
    }
  }

  if (current.Depth?.value) {
    result.depth = current.Depth.value
  }

  if (current.SweptArea?.value) {
    const profile = ifcApi.GetLine(modelID, current.SweptArea.value)

    if (profile.XDim?.value) {
      result.xDim = profile.XDim.value
      result.yDim = profile.YDim?.value ?? null
    }

    // Extract profile points — OuterCurve for ArbitraryClosedProfileDef
    const curveRef = profile.OuterCurve?.value
    if (curveRef) {
      const curve = ifcApi.GetLine(modelID, curveRef)
      if (curve.Points) {
        const pts: number[][] = []
        // IFCPOLYLINE — Points is array of CartesianPoint refs
        if (
          Array.isArray(curve.Points) &&
          curve.Points.length > 0 &&
          curve.Points[0]?.value != null
        ) {
          for (const ptRef of curve.Points) {
            const pt = ifcApi.GetLine(modelID, ptRef.value)
            const coords = pt.Coordinates.map((c: any) =>
              typeof c === 'number' ? c : (c?.value ?? 0),
            )
            pts.push([coords[0] ?? 0, coords[1] ?? 0])
          }
        }
        // IFCINDEXEDPOLYCURVE — Points is a reference to a point list
        else if (curve.Points?.value) {
          const ptList = ifcApi.GetLine(modelID, curve.Points.value)
          if (ptList.CoordList) {
            for (const coords of ptList.CoordList) {
              const c = Array.isArray(coords)
                ? coords.map((v: any) => (typeof v === 'number' ? v : (v?.value ?? 0)))
                : []
              pts.push([c[0] ?? 0, c[1] ?? 0])
            }
          }
        }
        if (pts.length >= 3) result.profilePoints = pts
      }
    }
  }

  return result.depth !== null
}

function getBodyExtrusionData(ifcApi: WebIFC.IfcAPI, modelID: number, element: any): ExtrusionData {
  const result: ExtrusionData = {
    depth: null,
    xDim: null,
    yDim: null,
    profilePoints: null,
  }
  try {
    if (!element.Representation?.value) return result
    const prodRep = ifcApi.GetLine(modelID, element.Representation.value)
    for (const repRef of prodRep.Representations) {
      const rep = ifcApi.GetLine(modelID, repRef.value)
      if (rep.RepresentationIdentifier?.value !== 'Body') continue

      for (const itemRef of rep.Items) {
        const item = ifcApi.GetLine(modelID, itemRef.value)

        // Direct extrusion or BooleanClippingResult
        if (extractFromExtrusionItem(ifcApi, modelID, item, result)) return result

        // MappedRepresentation → unwrap to inner items
        if (item.MappingSource?.value) {
          const src = ifcApi.GetLine(modelID, item.MappingSource.value)
          if (src.MappedRepresentation?.value) {
            const mapped = ifcApi.GetLine(modelID, src.MappedRepresentation.value)
            if (mapped.Items) {
              for (const mItemRef of mapped.Items) {
                const mItem = ifcApi.GetLine(modelID, mItemRef.value)
                if (extractFromExtrusionItem(ifcApi, modelID, mItem, result)) return result
              }
            }
          }
        }
      }
    }
  } catch {
    // fall through
  }
  return result
}

function findExtrusionPosition(ifcApi: WebIFC.IfcAPI, modelID: number, item: any): Mat4 | null {
  let current = item
  for (let guard = 0; guard < 10; guard++) {
    if (current.Position?.value) {
      return buildAxis2Placement3DMatrix(ifcApi, modelID, current.Position.value)
    }
    if (current.FirstOperand?.value) {
      current = ifcApi.GetLine(modelID, current.FirstOperand.value)
    } else {
      break
    }
  }
  return null
}

function getExtrusionPosition(ifcApi: WebIFC.IfcAPI, modelID: number, element: any): Mat4 | null {
  try {
    if (!element.Representation?.value) return null
    const prodRep = ifcApi.GetLine(modelID, element.Representation.value)
    for (const repRef of prodRep.Representations) {
      const rep = ifcApi.GetLine(modelID, repRef.value)
      if (rep.RepresentationIdentifier?.value !== 'Body') continue
      for (const itemRef of rep.Items) {
        const item = ifcApi.GetLine(modelID, itemRef.value)
        const pos = findExtrusionPosition(ifcApi, modelID, item)
        if (pos) return pos

        if (item.MappingSource?.value) {
          const src = ifcApi.GetLine(modelID, item.MappingSource.value)
          if (src.MappedRepresentation?.value) {
            const mapped = ifcApi.GetLine(modelID, src.MappedRepresentation.value)
            if (mapped.Items) {
              for (const mItemRef of mapped.Items) {
                const mItem = ifcApi.GetLine(modelID, mItemRef.value)
                const mPos = findExtrusionPosition(ifcApi, modelID, mItem)
                if (mPos) return mPos
              }
            }
          }
        }
      }
    }
  } catch {
    // fall through
  }
  return null
}

// --- Main converter ---

export interface ConversionOptions {
  swapYZ?: boolean
  extrusionDepthIsHeight?: boolean
  swapProfileDimensions?: boolean
  label?: string
}

export const VARIANT_PRESETS: Record<string, ConversionOptions> = {
  A: {
    swapYZ: true,
    extrusionDepthIsHeight: true,
    swapProfileDimensions: false,
    label: 'Default (Y-up, depth=height)',
  },
  B: {
    swapYZ: false,
    extrusionDepthIsHeight: true,
    swapProfileDimensions: false,
    label: 'Z-Up (no axis swap)',
  },
}

export async function convertIfcToPascal(
  ifcData: Uint8Array,
  onProgress?: (message: string, percent: number) => void,
  options?: ConversionOptions,
): Promise<PascalSceneGraph> {
  const opts = {
    swapYZ: options?.swapYZ ?? true,
    extrusionDepthIsHeight: options?.extrusionDepthIsHeight ?? true,
    swapProfileDimensions: options?.swapProfileDimensions ?? false,
  }

  const progress = (msg: string, pct: number) => {
    console.log(`[IFC→Pascal] ${msg} (${pct}%)`)
    onProgress?.(msg, pct)
  }

  progress('Initializing IFC parser...', 0)
  const ifcApi = new WebIFC.IfcAPI()
  ifcApi.SetWasmPath('/', true)

  await ifcApi.Init()
  progress('Opening IFC model...', 10)
  const modelID = ifcApi.OpenModel(ifcData)

  console.log(
    `[IFC→Pascal] Model opened, ID: ${modelID}, File size: ${(ifcData.length / 1024).toFixed(1)} KB`,
  )
  const nodes: Record<string, PascalNode> = {}
  const rootNodeIds: string[] = []

  // Maps to track relationships
  const parentMap = new Map<number, number>()
  const childrenMap = new Map<number, number[]>()
  const expressIdToNodeId = new Map<number, string>()

  progress('Analyzing spatial relationships...', 20)

  // Detect length unit → meters conversion factor
  const unitFactor = getLengthUnitFactor(ifcApi, modelID)

  // Compute scene origin offset to center georeferenced models near (0,0,0)
  let originOffset: number[] = [0, 0, 0]
  try {
    const siteIds = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSITE)
    const anchorId = siteIds.size() > 0 ? siteIds.get(0) : null
    if (anchorId) {
      const anchor = ifcApi.GetLine(modelID, anchorId)
      if (anchor.ObjectPlacement?.value) {
        const mat = resolveWorldTransform(ifcApi, modelID, anchor.ObjectPlacement.value)
        originOffset = transformPoint3(mat, [0, 0, 0])
      }
    }
  } catch {
    /* keep zero offset */
  }

  function worldToScene(worldPt: number[]): number[] {
    return [
      (worldPt[0] - originOffset[0]) * unitFactor,
      (worldPt[1] - originOffset[1]) * unitFactor,
      (worldPt[2] - originOffset[2]) * unitFactor,
    ]
  }

  // Collect storey expressIDs for level mapping
  const storeyExpressIds = new Set<number>()
  const storeyIds = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY)
  for (let i = 0; i < storeyIds.size(); i++) {
    storeyExpressIds.add(storeyIds.get(i))
  }

  // First pass: collect spatial hierarchy relationships
  const relAggregates = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELAGGREGATES)

  for (let i = 0; i < relAggregates.size(); i++) {
    const relID = relAggregates.get(i)
    const rel = ifcApi.GetLine(modelID, relID)

    if (rel.RelatingObject && rel.RelatedObjects) {
      const parentExpressID = rel.RelatingObject.value
      const children = rel.RelatedObjects.map((obj: any) => obj.value)

      children.forEach((childID: number) => {
        parentMap.set(childID, parentExpressID)
      })

      if (!childrenMap.has(parentExpressID)) {
        childrenMap.set(parentExpressID, [])
      }
      childrenMap.get(parentExpressID)?.push(...children)
    }
  }

  // Second pass: collect spatial containment
  const relContained = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)

  for (let i = 0; i < relContained.size(); i++) {
    const relID = relContained.get(i)
    const rel = ifcApi.GetLine(modelID, relID)

    if (rel.RelatingStructure && rel.RelatedElements) {
      const parentExpressID = rel.RelatingStructure.value
      const children = rel.RelatedElements.map((obj: any) => obj.value)

      children.forEach((childID: number) => {
        parentMap.set(childID, parentExpressID)
      })

      if (!childrenMap.has(parentExpressID)) {
        childrenMap.set(parentExpressID, [])
      }
      childrenMap.get(parentExpressID)?.push(...children)
    }
  }

  // Resolve containing storey for an element by walking the parent chain
  function findStoreyForElement(expressId: number): number | null {
    let current: number | undefined = expressId
    for (let guard = 0; guard < 20 && current != null; guard++) {
      if (storeyExpressIds.has(current)) return current
      current = parentMap.get(current)
    }
    return null
  }

  progress('Processing sites...', 30)
  // Process sites
  const sites = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSITE)
  console.log(`[IFC→Pascal] Found ${sites.size()} sites`)
  for (let i = 0; i < sites.size(); i++) {
    const siteExpressID = sites.get(i)
    const site = ifcApi.GetLine(modelID, siteExpressID)

    const nodeId = generateId('site')
    expressIdToNodeId.set(siteExpressID, nodeId)
    rootNodeIds.push(nodeId)

    const siteNode = tryParse(SiteNode, 'site', {
      object: 'node',
      id: nodeId,
      type: 'site',
      name: site.Name?.value || site.LongName?.value || 'Site',
      parentId: null,
      visible: true,
      polygon: {
        // Pascal SiteNode requires a property-line polygon. The
        // converter doesn't read IFC site geometry yet, so seed the
        // editor's default 30x30 square here.
        // TODO(ifc-fix): derive from IfcSite.SiteAddress or building footprints.
        type: 'polygon',
        points: [
          [-15, -15],
          [15, -15],
          [15, 15],
          [-15, 15],
        ],
      },
      children: [],
      metadata: buildMetadata({
        ifcType: 'IFCSITE',
        expressID: siteExpressID,
        globalId: site.GlobalId?.value,
      }),
    })

    nodes[nodeId] = siteNode
  }

  progress('Processing buildings...', 40)
  // Process buildings
  const buildings = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDING)
  console.log(`[IFC→Pascal] Found ${buildings.size()} buildings`)
  for (let i = 0; i < buildings.size(); i++) {
    const buildingExpressID = buildings.get(i)
    const building = ifcApi.GetLine(modelID, buildingExpressID)

    const nodeId = generateId('building')
    expressIdToNodeId.set(buildingExpressID, nodeId)

    const parentExpressID = parentMap.get(buildingExpressID)
    const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

    const buildingNode = tryParse(BuildingNode, 'building', {
      object: 'node',
      id: nodeId,
      type: 'building',
      name: building.Name?.value || building.LongName?.value || 'Building',
      parentId: parentNodeId || null,
      visible: true,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: [],
      metadata: buildMetadata({
        ifcType: 'IFCBUILDING',
        expressID: buildingExpressID,
        globalId: building.GlobalId?.value,
      }),
    })

    nodes[nodeId] = buildingNode

    if (parentNodeId && nodes[parentNodeId]) {
      ;(nodes[parentNodeId] as any).children?.push(nodeId)
    }
  }

  progress('Processing levels...', 50)
  // Process building storeys (levels)
  const storeys = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY)
  console.log(`[IFC→Pascal] Found ${storeys.size()} levels`)
  for (let i = 0; i < storeys.size(); i++) {
    const storeyExpressID = storeys.get(i)
    const storey = ifcApi.GetLine(modelID, storeyExpressID)

    const nodeId = generateId('level')
    expressIdToNodeId.set(storeyExpressID, nodeId)

    const parentExpressID = parentMap.get(storeyExpressID)
    const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

    // Resolve storey elevation from placement chain
    let elevation = storey.Elevation?.value ?? 0
    if (storey.ObjectPlacement?.value) {
      try {
        const worldMat = resolveWorldTransform(ifcApi, modelID, storey.ObjectPlacement.value)
        const worldOrigin = transformPoint3(worldMat, [0, 0, 0])
        elevation = worldToScene(worldOrigin)[2]
      } catch {
        elevation = (storey.Elevation?.value ?? 0) * unitFactor
      }
    } else {
      elevation *= unitFactor
    }

    const levelNode = tryParse(LevelNode, 'level', {
      object: 'node',
      id: nodeId,
      type: 'level',
      name: storey.Name?.value || storey.LongName?.value || `Level ${i}`,
      level: i,
      parentId: parentNodeId || null,
      visible: true,
      children: [],
      metadata: buildMetadata({
        ifcType: 'IFCBUILDINGSTOREY',
        expressID: storeyExpressID,
        globalId: storey.GlobalId?.value,
        elevation,
      }),
    })

    nodes[nodeId] = levelNode

    if (parentNodeId && nodes[parentNodeId]) {
      ;(nodes[parentNodeId] as any).children?.push(nodeId)
    }
  }

  progress('Processing walls...', 60)

  // Build void/fill relationship maps for doors and windows
  // IFCRELVOIDSELEMENT: wall (RelatingBuildingElement) → opening (RelatedOpeningElement)
  const wallToOpenings = new Map<number, number[]>()
  const relVoids = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELVOIDSELEMENT)
  for (let i = 0; i < relVoids.size(); i++) {
    const rel = ifcApi.GetLine(modelID, relVoids.get(i))
    const wallId = rel.RelatingBuildingElement?.value
    const openingId = rel.RelatedOpeningElement?.value
    if (wallId && openingId) {
      if (!wallToOpenings.has(wallId)) wallToOpenings.set(wallId, [])
      wallToOpenings.get(wallId)!.push(openingId)
    }
  }

  // IFCRELFILLSELEMENT: opening (RelatingOpeningElement) → door/window (RelatedBuildingElement)
  const openingToFill = new Map<number, number>()
  const relFills = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELFILLSELEMENT)
  for (let i = 0; i < relFills.size(); i++) {
    const rel = ifcApi.GetLine(modelID, relFills.get(i))
    const openingId = rel.RelatingOpeningElement?.value
    const fillId = rel.RelatedBuildingElement?.value
    if (openingId && fillId) {
      openingToFill.set(openingId, fillId)
    }
  }

  // Collect all door and window expressIDs for type checking
  const doorExpressIds = new Set<number>()
  const windowExpressIds = new Set<number>()
  for (const doorType of [WebIFC.IFCDOOR, WebIFC.IFCDOORSTANDARDCASE]) {
    const ids = ifcApi.GetLineIDsWithType(modelID, doorType)
    for (let i = 0; i < ids.size(); i++) doorExpressIds.add(ids.get(i))
  }
  for (const winType of [WebIFC.IFCWINDOW, WebIFC.IFCWINDOWSTANDARDCASE]) {
    const ids = ifcApi.GetLineIDsWithType(modelID, winType)
    for (let i = 0; i < ids.size(); i++) windowExpressIds.add(ids.get(i))
  }

  // Process walls (both IFCWALL and IFCWALLSTANDARDCASE)
  const wallTypes = [WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE]
  for (const wallType of wallTypes) {
    const walls = ifcApi.GetLineIDsWithType(modelID, wallType)
    for (let i = 0; i < walls.size(); i++) {
      const wallExpressID = walls.get(i)
      if (expressIdToNodeId.has(wallExpressID)) continue

      const wall = ifcApi.GetLine(modelID, wallExpressID)

      const nodeId = generateId('wall')
      expressIdToNodeId.set(wallExpressID, nodeId)

      const parentExpressID = parentMap.get(wallExpressID)
      const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

      let start: [number, number] = [0, 0]
      let end: [number, number] | null = null
      let thickness: number | undefined
      let height: number | undefined

      try {
        // Resolve world placement
        const worldMat = wall.ObjectPlacement?.value
          ? resolveWorldTransform(ifcApi, modelID, wall.ObjectPlacement.value)
          : identity()

        // Try to get axis polyline (local 2D line along wall)
        const axisPts = getAxisPolyline(ifcApi, modelID, wall)

        if (axisPts && axisPts.length >= 2) {
          const s0 = worldToScene(transformPoint3(worldMat, axisPts[0]))
          const s1 = worldToScene(transformPoint3(worldMat, axisPts[axisPts.length - 1]))
          start = [s0[0], s0[1]]
          end = [s1[0], s1[1]]
        } else {
          // Fallback: use placement origin + body XDim for length
          const s = worldToScene(transformPoint3(worldMat, [0, 0, 0]))
          start = [s[0], s[1]]
          // Will try to get length from body below
        }

        // Get body extrusion data for thickness/height
        const body = getBodyExtrusionData(ifcApi, modelID, wall)

        if (body.depth) {
          if (opts.extrusionDepthIsHeight) {
            height = body.depth * unitFactor
          } else {
            thickness = body.depth * unitFactor
          }
        }

        const dimForThickness = opts.swapProfileDimensions ? body.xDim : body.yDim
        if (dimForThickness) {
          thickness = dimForThickness * unitFactor
        } else if (body.profilePoints && body.profilePoints.length >= 3) {
          const ys = body.profilePoints.map((p) => p[1])
          thickness = (Math.max(...ys) - Math.min(...ys)) * unitFactor
        }

        // If no axis polyline, derive wall length from profile or XDim
        if (!axisPts) {
          let wallLength = body.xDim
          if (!wallLength && body.profilePoints && body.profilePoints.length >= 3) {
            const xs = body.profilePoints.map((p) => p[0])
            wallLength = Math.max(...xs) - Math.min(...xs)
          }
          if (wallLength) {
            const se = worldToScene(transformPoint3(worldMat, [wallLength, 0, 0]))
            end = [se[0], se[1]]
          }
        }
      } catch {
        // keep defaults
      }

      // Skip walls where we couldn't determine geometry
      if (!end) continue

      // Plain IFCWALL frequently carries Brep / mapped geometry rather
      // than a clean IfcExtrudedAreaSolid, so getBodyExtrusionData can't
      // read its height/thickness (only IFCWALLSTANDARDCASE reliably
      // works). Fall back to the editor's wall defaults so the wall
      // renders at a sensible size instead of collapsing to a
      // zero-height sliver — which also breaks the door/window CSG
      // cutouts punched into it.
      // TODO(ifc-fix): derive exact dims from the element geometry AABB
      // (web-ifc GetFlatMesh) for non-extruded walls.
      if (height === undefined) height = DEFAULT_WALL_HEIGHT
      if (thickness === undefined) thickness = DEFAULT_WALL_THICKNESS

      const wallNode = tryParse(WallNode, 'wall', {
        object: 'node',
        id: nodeId,
        type: 'wall',
        name: wall.Name?.value || `Wall ${i + 1}`,
        parentId: parentNodeId || null,
        visible: true,
        start,
        end,
        thickness,
        height,
        frontSide: 'unknown',
        backSide: 'unknown',
        children: [],
        metadata: buildMetadata({
          ifcType: wallType === WebIFC.IFCWALL ? 'IFCWALL' : 'IFCWALLSTANDARDCASE',
          expressID: wallExpressID,
          globalId: wall.GlobalId?.value,
        }),
      })

      nodes[nodeId] = wallNode

      if (parentNodeId && nodes[parentNodeId]) {
        ;(nodes[parentNodeId] as any).children?.push(nodeId)
      }
    }
  }

  // Process doors and windows via void/fill relationships
  for (const [wallExpressID, openingIds] of wallToOpenings) {
    const wallNodeId = expressIdToNodeId.get(wallExpressID)
    if (!wallNodeId) continue
    const wallNode = nodes[wallNodeId] as WallNode
    if (!wallNode || wallNode.type !== 'wall') continue

    const wallDx = wallNode.end[0] - wallNode.start[0]
    const wallDy = wallNode.end[1] - wallNode.start[1]
    const wallLength = Math.sqrt(wallDx * wallDx + wallDy * wallDy)

    // Wall world matrix for projecting opening positions
    let wallWorldMat: Mat4 | null = null
    try {
      const wall = ifcApi.GetLine(modelID, wallExpressID)
      if (wall.ObjectPlacement?.value) {
        wallWorldMat = resolveWorldTransform(ifcApi, modelID, wall.ObjectPlacement.value)
      }
    } catch {
      /* ignore */
    }

    for (const openingId of openingIds) {
      const fillId = openingToFill.get(openingId)
      if (!fillId) continue

      const isDoor = doorExpressIds.has(fillId)
      const isWindow = windowExpressIds.has(fillId)
      if (!isDoor && !isWindow) continue

      try {
        const element = ifcApi.GetLine(modelID, fillId)

        // Get dimensions from OverallWidth/OverallHeight
        let width: number | undefined
        let height: number | undefined
        if (element.OverallWidth?.value) width = element.OverallWidth.value * unitFactor
        if (element.OverallHeight?.value) height = element.OverallHeight.value * unitFactor

        // Compute position along wall from opening placement
        let position: number | undefined
        try {
          const opening = ifcApi.GetLine(modelID, openingId)
          if (opening.ObjectPlacement?.value) {
            const openingWorldMat = resolveWorldTransform(
              ifcApi,
              modelID,
              opening.ObjectPlacement.value,
            )
            const openingScene = worldToScene(transformPoint3(openingWorldMat, [0, 0, 0]))
            const ox = openingScene[0] - wallNode.start[0]
            const oy = openingScene[1] - wallNode.start[1]
            if (wallLength > 1e-6) {
              const dot = (ox * wallDx + oy * wallDy) / wallLength
              // Clamp so the opening's [pos - w/2, pos + w/2] footprint
              // stays inside the wall — an overflowing CSG cutout breaks
              // the wall mesh.
              const half = (width ?? 0) / 2
              const lo = Math.min(half, wallLength / 2)
              const hi = Math.max(wallLength - half, wallLength / 2)
              position = Math.max(lo, Math.min(hi, dot))
            }
          }
        } catch {
          /* ignore */
        }

        // Get sill height for windows from opening placement Z relative to wall
        let sillHeight: number | undefined
        if (isWindow) {
          try {
            const opening = ifcApi.GetLine(modelID, openingId)
            if (opening.ObjectPlacement?.value) {
              const openingWorldMat = resolveWorldTransform(
                ifcApi,
                modelID,
                opening.ObjectPlacement.value,
              )
              const openingScene = worldToScene(transformPoint3(openingWorldMat, [0, 0, 0]))
              if (wallWorldMat) {
                const wallScene = worldToScene(transformPoint3(wallWorldMat, [0, 0, 0]))
                sillHeight = openingScene[2] - wallScene[2]
              } else {
                sillHeight = openingScene[2]
              }
              if (sillHeight !== undefined && sillHeight < 0.01) sillHeight = undefined
            }
          } catch {
            /* ignore */
          }
        }

        if (isDoor) {
          const nodeId = generateId('door')
          expressIdToNodeId.set(fillId, nodeId)

          // Vertical centering is now handled: door center Y = height/2 so the
          // opening sits at the correct position. Remaining caveat: door bottom
          // is assumed at floor y=0 (i.e. the door starts at the wall's base).
          // Defaults match @pascal-app/core door schema fallbacks.
          const doorPosition: [number, number, number] = [position ?? 0, (height ?? 2.1) / 2, 0]
          const doorNode = tryParse(DoorNode, 'door', {
            object: 'node',
            id: nodeId,
            type: 'door',
            name: element.Name?.value || `Door`,
            parentId: wallNodeId,
            visible: true,
            width: width ?? 0.9,
            height: height ?? 2.1,
            position: doorPosition,
            metadata: buildMetadata({
              ifcType: 'IFCDOOR',
              expressID: fillId,
              globalId: element.GlobalId?.value,
              hostWallExpressID: wallExpressID,
            }),
          })

          nodes[nodeId] = doorNode
          wallNode.children.push(nodeId)
        } else {
          const nodeId = generateId('window')
          expressIdToNodeId.set(fillId, nodeId)

          // TODO(ifc-fix): same scalar-vs-tuple position issue as door above.
          // sillHeight stays read-only metadata until we resolve the window
          // schema (Pascal's WindowNode doesn't have sillHeight today —
          // moved to metadata for now so we don't lose the value).
          const windowPosition: [number, number, number] = [
            position ?? 0,
            (sillHeight ?? 0) + (height ?? 1.2) / 2,
            0,
          ]
          const windowNode = tryParse(WindowNode, 'window', {
            object: 'node',
            id: nodeId,
            type: 'window',
            name: element.Name?.value || `Window`,
            parentId: wallNodeId,
            visible: true,
            width: width ?? 1.0,
            height: height ?? 1.2,
            position: windowPosition,
            metadata: buildMetadata({
              ifcType: 'IFCWINDOW',
              expressID: fillId,
              globalId: element.GlobalId?.value,
              hostWallExpressID: wallExpressID,
              sillHeight,
            }),
          })

          nodes[nodeId] = windowNode
          wallNode.children.push(nodeId)
        }
      } catch {
        // skip this opening
      }
    }
  }

  // Process any doors/windows NOT linked via the void/fill chain. Some
  // exporters (e.g. the Paris sample) carve openings with
  // IFCRELVOIDSELEMENT but omit IFCRELFILLSELEMENT, so the
  // door/window → wall link is only implicit in the element's world
  // placement. We recover it by projecting the element's world position
  // onto the nearest wall segment. Anything farther than
  // HOST_WALL_MAX_DIST from every wall stays parented to its spatial
  // container at the origin — we have no basis to place it on a wall.
  const HOST_WALL_MAX_DIST = 1.0 // metres

  type WallInfo = {
    nodeId: string
    start: [number, number]
    end: [number, number]
    length: number
    baseY: number
  }
  const wallInfos: WallInfo[] = []
  for (const [wallExpressId, wallNodeId] of expressIdToNodeId) {
    const node = nodes[wallNodeId]
    if (!node || node.type !== 'wall') continue
    const w = node as WallNode
    const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    if (length < 1e-6) continue
    let baseY = 0
    try {
      const wall = ifcApi.GetLine(modelID, wallExpressId)
      if (wall.ObjectPlacement?.value) {
        const m = resolveWorldTransform(ifcApi, modelID, wall.ObjectPlacement.value)
        baseY = worldToScene(transformPoint3(m, [0, 0, 0]))[2]
      }
    } catch {
      /* keep baseY = 0 */
    }
    wallInfos.push({ nodeId: wallNodeId, start: w.start, end: w.end, length, baseY })
  }

  // Pick the host wall for an opening at ground-plane point [x, y] with
  // the given width. Among walls within HOST_WALL_MAX_DIST
  // perpendicular, prefer one long enough to contain the opening — the
  // castle's IFCWALL decomposition leaves tiny stub walls near corners,
  // and a plain nearest-by-distance match would snap (say) a 0.7m door
  // onto a 0.4m stub, so its CSG cutout overflows and breaks the wall.
  // Returns the along-wall position already clamped so the opening
  // footprint stays inside the wall.
  const findHostWall = (x: number, y: number, width: number) => {
    let best: { info: WallInfo; along: number; dist: number; fits: boolean } | null = null
    for (const info of wallInfos) {
      const dx = info.end[0] - info.start[0]
      const dy = info.end[1] - info.start[1]
      const lenSq = dx * dx + dy * dy
      if (lenSq < 1e-9) continue
      const t = Math.max(
        0,
        Math.min(1, ((x - info.start[0]) * dx + (y - info.start[1]) * dy) / lenSq),
      )
      const footX = info.start[0] + t * dx
      const footY = info.start[1] + t * dy
      const dist = Math.hypot(x - footX, y - footY)
      if (dist > HOST_WALL_MAX_DIST) continue
      // Keep the [along - width/2, along + width/2] span inside the wall.
      const half = width / 2
      const lo = Math.min(half, info.length / 2)
      const hi = Math.max(info.length - half, info.length / 2)
      const along = Math.max(lo, Math.min(hi, t * info.length))
      const fits = info.length + 1e-6 >= width
      const cand = { info, along, dist, fits }
      if (!best) {
        best = cand
      } else if (cand.fits !== best.fits) {
        if (cand.fits) best = cand
      } else if (cand.dist < best.dist) {
        best = cand
      }
    }
    return best
  }

  for (const fillId of [...doorExpressIds, ...windowExpressIds]) {
    if (expressIdToNodeId.has(fillId)) continue
    try {
      const element = ifcApi.GetLine(modelID, fillId)
      const isDoor = doorExpressIds.has(fillId)

      let width: number | undefined
      let height: number | undefined
      if (element.OverallWidth?.value) width = element.OverallWidth.value * unitFactor
      if (element.OverallHeight?.value) height = element.OverallHeight.value * unitFactor

      // Element world placement → scene point. Ground plane is [x, y]
      // (IFC X/Y, matching wall start/end); vertical is component [2].
      let scene: number[] | null = null
      try {
        if (element.ObjectPlacement?.value) {
          const m = resolveWorldTransform(ifcApi, modelID, element.ObjectPlacement.value)
          scene = worldToScene(transformPoint3(m, [0, 0, 0]))
        }
      } catch {
        /* no placement */
      }

      const effWidth = width ?? (isDoor ? 0.9 : 1.0)
      const hosted = scene ? findHostWall(scene[0], scene[1], effWidth) : null

      // When hosted, parent to (and live inside) the wall — same as the
      // void/fill path. Otherwise fall back to the spatial container.
      const containerExpressID = parentMap.get(fillId)
      const containerNodeId = containerExpressID
        ? (expressIdToNodeId.get(containerExpressID) ?? null)
        : null
      const parentNodeId = hosted ? hosted.info.nodeId : containerNodeId

      if (isDoor) {
        const h = height ?? 2.1
        const nodeId = generateId('door')
        expressIdToNodeId.set(fillId, nodeId)
        const doorNode = tryParse(DoorNode, 'door', {
          object: 'node',
          id: nodeId,
          type: 'door',
          name: element.Name?.value || `Door`,
          parentId: parentNodeId,
          visible: true,
          width: width ?? 0.9,
          height: h,
          // Placed by nearest-wall projection; [0,0,0] only when no wall
          // is within range (then it sits on its spatial container).
          position: hosted ? [hosted.along, h / 2, 0] : [0, 0, 0],
          ...(hosted ? { wallId: hosted.info.nodeId } : {}),
          metadata: buildMetadata({
            ifcType: 'IFCDOOR',
            expressID: fillId,
            globalId: element.GlobalId?.value,
          }),
        })
        nodes[nodeId] = doorNode
        if (parentNodeId && nodes[parentNodeId]) {
          ;(nodes[parentNodeId] as { children?: string[] }).children?.push(nodeId)
        }
      } else {
        const h = height ?? 1.2
        const sill = hosted && scene ? Math.max(0, scene[2] - hosted.info.baseY) : 0
        const nodeId = generateId('window')
        expressIdToNodeId.set(fillId, nodeId)
        const windowNode = tryParse(WindowNode, 'window', {
          object: 'node',
          id: nodeId,
          type: 'window',
          name: element.Name?.value || `Window`,
          parentId: parentNodeId,
          visible: true,
          width: width ?? 1.0,
          height: h,
          position: hosted ? [hosted.along, sill + h / 2, 0] : [0, 0, 0],
          ...(hosted ? { wallId: hosted.info.nodeId } : {}),
          metadata: buildMetadata({
            ifcType: 'IFCWINDOW',
            expressID: fillId,
            globalId: element.GlobalId?.value,
            ...(hosted ? { sillHeight: sill } : {}),
          }),
        })
        nodes[nodeId] = windowNode
        if (parentNodeId && nodes[parentNodeId]) {
          ;(nodes[parentNodeId] as { children?: string[] }).children?.push(nodeId)
        }
      }
    } catch {
      // skip
    }
  }

  // Process slabs
  const slabs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSLAB)
  console.log(`[IFC→Pascal] Found ${slabs.size()} slabs`)
  for (let i = 0; i < slabs.size(); i++) {
    const slabExpressID = slabs.get(i)
    const slab = ifcApi.GetLine(modelID, slabExpressID)

    const nodeId = generateId('slab')
    expressIdToNodeId.set(slabExpressID, nodeId)

    const parentExpressID = parentMap.get(slabExpressID)
    const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

    let polygon: [number, number][] | null = null
    let elevation = 0
    let thickness: number | undefined

    try {
      // Resolve world placement for the slab element
      const worldMat = slab.ObjectPlacement?.value
        ? resolveWorldTransform(ifcApi, modelID, slab.ObjectPlacement.value)
        : identity()

      // Get elevation from placement Z
      const s = worldToScene(transformPoint3(worldMat, [0, 0, 0]))
      elevation = s[2]

      // Get body extrusion data
      const body = getBodyExtrusionData(ifcApi, modelID, slab)

      // Extrusion depth is slab thickness
      if (body.depth) {
        thickness = body.depth * unitFactor
      }

      // Extrusion Position provides an additional local offset for the profile
      const extrusionMat = getExtrusionPosition(ifcApi, modelID, slab)

      if (body.profilePoints && body.profilePoints.length >= 3) {
        const combinedMat = extrusionMat ? multiply(worldMat, extrusionMat) : worldMat
        polygon = body.profilePoints.map((pt) => {
          const sc = worldToScene(transformPoint3(combinedMat, [pt[0], pt[1], 0]))
          return [sc[0], sc[1]] as [number, number]
        })
        const first = polygon[0]
        const last = polygon[polygon.length - 1]
        if (
          polygon.length > 3 &&
          Math.abs(first[0] - last[0]) < 1e-6 &&
          Math.abs(first[1] - last[1]) < 1e-6
        ) {
          polygon.pop()
        }
      } else if (body.xDim && body.yDim) {
        const hw = body.xDim / 2
        const hh = body.yDim / 2
        const corners: number[][] = [
          [-hw, -hh, 0],
          [hw, -hh, 0],
          [hw, hh, 0],
          [-hw, hh, 0],
        ]
        const combinedMat = extrusionMat ? multiply(worldMat, extrusionMat) : worldMat
        polygon = corners.map((c) => {
          const sc = worldToScene(transformPoint3(combinedMat, c))
          return [sc[0], sc[1]] as [number, number]
        })
      }
    } catch {
      // keep defaults
    }

    // Skip slabs where we couldn't extract a polygon
    if (!polygon || polygon.length < 3) continue

    const slabNode = tryParse(SlabNode, 'slab', {
      object: 'node',
      id: nodeId,
      type: 'slab',
      name: slab.Name?.value || `Slab ${i + 1}`,
      parentId: parentNodeId || null,
      visible: true,
      polygon,
      holes: [],
      elevation,
      // TODO(ifc-fix): Pascal SlabNode has no `thickness` field — moved
      // to metadata so the IFC value isn't lost.
      metadata: buildMetadata({
        ifcType: 'IFCSLAB',
        expressID: slabExpressID,
        globalId: slab.GlobalId?.value,
        thickness,
      }),
    })

    nodes[nodeId] = slabNode

    if (parentNodeId && nodes[parentNodeId]) {
      ;(nodes[parentNodeId] as any).children?.push(nodeId)
    }
  }

  // Process stairs
  const stairs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCSTAIR)
  for (let i = 0; i < stairs.size(); i++) {
    const stairExpressID = stairs.get(i)
    if (expressIdToNodeId.has(stairExpressID)) continue

    const stair = ifcApi.GetLine(modelID, stairExpressID)
    const nodeId = generateId('stair')
    expressIdToNodeId.set(stairExpressID, nodeId)

    const parentExpressID = parentMap.get(stairExpressID)
    const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

    let position: [number, number, number] = [0, 0, 0]
    let boundingBox: [number, number, number] | undefined

    try {
      const worldMat = stair.ObjectPlacement?.value
        ? resolveWorldTransform(ifcApi, modelID, stair.ObjectPlacement.value)
        : identity()
      const s = worldToScene(transformPoint3(worldMat, [0, 0, 0]))
      position = opts.swapYZ ? [s[0], s[2], s[1]] : [s[0], s[1], s[2]]

      // Try stair's own body first
      const body = getBodyExtrusionData(ifcApi, modelID, stair)
      if (body.xDim && body.yDim && body.depth) {
        boundingBox = opts.swapYZ
          ? [body.xDim * unitFactor, body.depth * unitFactor, body.yDim * unitFactor]
          : [body.xDim * unitFactor, body.yDim * unitFactor, body.depth * unitFactor]
      }

      // If no body, try to derive from stair flight children
      if (!boundingBox) {
        const stairChildren = childrenMap.get(stairExpressID) ?? []
        for (const childId of stairChildren) {
          try {
            const child = ifcApi.GetLine(modelID, childId)
            // Check for NumberOfRisers / RiserHeight / TreadLength
            const nRisers = child.NumberOfRisers?.value ?? child.NumberOfRiser?.value
            const riserHeight = child.RiserHeight?.value
            const treadLength = child.TreadLength?.value
            if (nRisers && riserHeight && treadLength) {
              const totalHeight = nRisers * riserHeight * unitFactor
              const totalRun = (nRisers - 1) * treadLength * unitFactor
              const width = 1.0 // Default stair width
              const flightBody = getBodyExtrusionData(ifcApi, modelID, child)
              const stairWidth = flightBody.yDim ? flightBody.yDim * unitFactor : width
              boundingBox = opts.swapYZ
                ? [totalRun || 1, totalHeight, stairWidth]
                : [totalRun || 1, stairWidth, totalHeight]
              break
            }
            // Fallback: try flight body extrusion
            const flightBody = getBodyExtrusionData(ifcApi, modelID, child)
            if (flightBody.xDim && flightBody.yDim && flightBody.depth) {
              boundingBox = opts.swapYZ
                ? [
                    flightBody.xDim * unitFactor,
                    flightBody.depth * unitFactor,
                    flightBody.yDim * unitFactor,
                  ]
                : [
                    flightBody.xDim * unitFactor,
                    flightBody.yDim * unitFactor,
                    flightBody.depth * unitFactor,
                  ]
              break
            }
          } catch {
            /* skip child */
          }
        }
      }
    } catch {
      /* keep defaults */
    }

    const stairNode = tryParse(StairNode, 'stair', {
      object: 'node',
      id: nodeId,
      type: 'stair',
      name: stair.Name?.value || `Stair ${i + 1}`,
      parentId: parentNodeId || null,
      visible: true,
      position,
      children: [],
      // TODO(ifc-fix): Pascal StairNode is parametric (segments / treads /
      // risers). The converter only knows the bounding box right now;
      // keep it in metadata until we map IFC stairs onto the parametric
      // shape (or extend StairNode with a raw-geometry escape hatch).
      metadata: buildMetadata({
        ifcType: 'IFCSTAIR',
        expressID: stairExpressID,
        globalId: stair.GlobalId?.value,
        predefinedType: stair.PredefinedType?.value,
        boundingBox,
      }),
    })

    nodes[nodeId] = stairNode
    if (parentNodeId && nodes[parentNodeId]) {
      ;(nodes[parentNodeId] as any).children?.push(nodeId)
    }
  }

  // Process roofs
  const roofs = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCROOF)
  for (let i = 0; i < roofs.size(); i++) {
    const roofExpressID = roofs.get(i)
    if (expressIdToNodeId.has(roofExpressID)) continue

    const roof = ifcApi.GetLine(modelID, roofExpressID)
    const nodeId = generateId('roof')
    expressIdToNodeId.set(roofExpressID, nodeId)

    const parentExpressID = parentMap.get(roofExpressID)
    const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

    let polygon: [number, number][] | undefined
    let elevation: number | undefined
    let height: number | undefined

    try {
      const worldMat = roof.ObjectPlacement?.value
        ? resolveWorldTransform(ifcApi, modelID, roof.ObjectPlacement.value)
        : identity()
      const s = worldToScene(transformPoint3(worldMat, [0, 0, 0]))
      elevation = s[2]

      const body = getBodyExtrusionData(ifcApi, modelID, roof)
      if (body.depth) height = body.depth * unitFactor

      const extrusionMat = getExtrusionPosition(ifcApi, modelID, roof)

      if (body.profilePoints && body.profilePoints.length >= 3) {
        const combinedMat = extrusionMat ? multiply(worldMat, extrusionMat) : worldMat
        polygon = body.profilePoints.map((pt) => {
          const sc = worldToScene(transformPoint3(combinedMat, [pt[0], pt[1], 0]))
          return [sc[0], sc[1]] as [number, number]
        })
        const first = polygon[0]
        const last = polygon[polygon.length - 1]
        if (
          polygon.length > 3 &&
          Math.abs(first[0] - last[0]) < 1e-6 &&
          Math.abs(first[1] - last[1]) < 1e-6
        ) {
          polygon.pop()
        }
      } else if (body.xDim && body.yDim) {
        const hw = body.xDim / 2
        const hh = body.yDim / 2
        const corners: number[][] = [
          [-hw, -hh, 0],
          [hw, -hh, 0],
          [hw, hh, 0],
          [-hw, hh, 0],
        ]
        const combinedMat = extrusionMat ? multiply(worldMat, extrusionMat) : worldMat
        polygon = corners.map((c) => {
          const sc = worldToScene(transformPoint3(combinedMat, c))
          return [sc[0], sc[1]] as [number, number]
        })
      }
    } catch {
      /* keep defaults */
    }

    const roofNode = tryParse(RoofNode, 'roof', {
      object: 'node',
      id: nodeId,
      type: 'roof',
      name: roof.Name?.value || `Roof ${i + 1}`,
      parentId: parentNodeId || null,
      visible: true,
      elevation,
      // TODO(ifc-fix): Pascal RoofNode is composed of roof-segments. The
      // converter only has the flat polygon + height; pass them through
      // metadata until we map the IFC roof onto the segment-based shape.
      metadata: buildMetadata({
        ifcType: 'IFCROOF',
        expressID: roofExpressID,
        globalId: roof.GlobalId?.value,
        predefinedType: roof.PredefinedType?.value,
        polygon,
        height,
      }),
    })

    nodes[nodeId] = roofNode
    if (parentNodeId && nodes[parentNodeId]) {
      ;(nodes[parentNodeId] as any).children?.push(nodeId)
    }
  }

  // Process columns
  const columnTypes = [WebIFC.IFCCOLUMN]
  try {
    columnTypes.push(WebIFC.IFCCOLUMNSTANDARDCASE)
  } catch {
    /* not in all versions */
  }
  for (const colType of columnTypes) {
    let cols
    try {
      cols = ifcApi.GetLineIDsWithType(modelID, colType)
    } catch {
      continue
    }
    for (let i = 0; i < cols.size(); i++) {
      const colExpressID = cols.get(i)
      if (expressIdToNodeId.has(colExpressID)) continue

      const col = ifcApi.GetLine(modelID, colExpressID)
      const nodeId = generateId('column')
      expressIdToNodeId.set(colExpressID, nodeId)

      const parentExpressID = parentMap.get(colExpressID)
      const parentNodeId = parentExpressID ? expressIdToNodeId.get(parentExpressID) : null

      let position: [number, number, number] = [0, 0, 0]
      let width: number | undefined
      let depth: number | undefined
      let height: number | undefined

      try {
        const worldMat = col.ObjectPlacement?.value
          ? resolveWorldTransform(ifcApi, modelID, col.ObjectPlacement.value)
          : identity()
        const s = worldToScene(transformPoint3(worldMat, [0, 0, 0]))
        position = opts.swapYZ ? [s[0], s[2], s[1]] : [s[0], s[1], s[2]]

        const body = getBodyExtrusionData(ifcApi, modelID, col)
        if (body.depth) height = body.depth * unitFactor
        if (opts.swapProfileDimensions) {
          if (body.yDim) width = body.yDim * unitFactor
          if (body.xDim) depth = body.xDim * unitFactor
        } else {
          if (body.xDim) width = body.xDim * unitFactor
          if (body.yDim) depth = body.yDim * unitFactor
        }
      } catch {
        /* keep defaults */
      }

      // Structural IFC columns are plain shafts. The ColumnNode defaults
      // are decorative (round-rings base + simple capital + a necked
      // shaft → a classical/Greek look), and the default round
      // cross-section ignores width/depth in favour of `radius`. Strip
      // the ornament, keep the shaft full-width, and size from the IFC
      // profile: rectangular when width≠depth, otherwise a round shaft
      // whose radius comes from the profile.
      const isRect =
        width !== undefined &&
        depth !== undefined &&
        Math.abs(width - depth) > 0.15 * Math.max(width, depth)
      const columnNode = tryParse(ColumnNode, 'column', {
        object: 'node',
        id: nodeId,
        type: 'column',
        name: col.Name?.value || `Column ${i + 1}`,
        parentId: parentNodeId || null,
        visible: true,
        position,
        width,
        depth,
        height,
        crossSection: isRect ? 'rectangular' : 'round',
        radius: Math.max(width ?? 0.44, depth ?? 0.44) / 2,
        style: 'plain',
        shaftProfile: 'straight',
        shaftStartScale: 1,
        shaftEndScale: 1,
        shaftSegmentCount: 1,
        baseStyle: 'none',
        capitalStyle: 'none',
        baseHeight: 0,
        capitalHeight: 0,
        metadata: buildMetadata({
          ifcType: 'IFCCOLUMN',
          expressID: colExpressID,
          globalId: col.GlobalId?.value,
        }),
      })

      nodes[nodeId] = columnNode
      if (parentNodeId && nodes[parentNodeId]) {
        ;(nodes[parentNodeId] as any).children?.push(nodeId)
      }
    }
  }

  // Beams: skipped for now — Pascal has no `beam` node type yet. When it
  // lands in @pascal-app/core, restore the IFCBEAM → BeamNode mapping
  // (axis polyline → start/end [x,y,z], profile XDim/YDim → width/depth,
  // extrusion depth → axis length). Reference implementation lives in
  // git history of this file. We still walk the entities to log how
  // many beams the IFC contained so the conversion summary is accurate.
  let skippedBeamCount = 0
  const beamTypes = [WebIFC.IFCBEAM]
  try {
    beamTypes.push(WebIFC.IFCBEAMSTANDARDCASE)
  } catch {
    /* not in all versions */
  }
  for (const beamType of beamTypes) {
    try {
      const beams = ifcApi.GetLineIDsWithType(modelID, beamType)
      skippedBeamCount += beams.size()
    } catch {
      /* type not present in this file */
    }
  }
  if (skippedBeamCount > 0) {
    console.warn(
      `[IFC→Pascal] Skipped ${skippedBeamCount} beam${skippedBeamCount === 1 ? '' : 's'} — Pascal has no beam node yet.`,
    )
  }

  // Items: skipped for now — Pascal's ItemNode requires a full `asset`
  // (catalog reference with id/src/dimensions/etc.) that the converter
  // can't synthesise from raw IFC geometry. When the editor grows a
  // raw-geometry escape hatch (or we add a placeholder-asset registry),
  // restore the mapping from the pre-migration git history. We still
  // walk the entities to log a count for diagnostics.
  let skippedItemCount = 0
  const itemTypeKeys = [
    WebIFC.IFCFURNISHINGELEMENT,
    WebIFC.IFCBUILDINGELEMENTPROXY,
    WebIFC.IFCRAILING,
    WebIFC.IFCCOVERING,
    WebIFC.IFCCURTAINWALL,
    WebIFC.IFCPLATE,
    WebIFC.IFCMEMBER,
    WebIFC.IFCFOOTING,
  ]
  for (const itemType of itemTypeKeys) {
    try {
      const items = ifcApi.GetLineIDsWithType(modelID, itemType)
      skippedItemCount += items.size()
    } catch {
      /* type not present in this file */
    }
  }
  if (skippedItemCount > 0) {
    console.warn(
      `[IFC→Pascal] Skipped ${skippedItemCount} item${skippedItemCount === 1 ? '' : 's'} — Pascal items require a catalog asset the converter can't synthesise yet.`,
    )
  }

  // Post-process: resolve levelId for all element nodes
  for (const node of Object.values(nodes)) {
    const m = meta(node)
    if (!m.expressID) continue
    const storeyExpId = findStoreyForElement(m.expressID)
    if (storeyExpId != null) {
      m.levelId = expressIdToNodeId.get(storeyExpId) ?? undefined
    }
  }

  // Post-process: extract property sets and materials
  const elementExpressIds = new Set<number>()
  const expressIdToNode = new Map<number, PascalNode>()
  for (const node of Object.values(nodes)) {
    const m = meta(node)
    if (m.expressID != null) {
      elementExpressIds.add(m.expressID)
      expressIdToNode.set(m.expressID, node)
    }
  }

  // Property sets via IFCRELDEFINESBYPROPERTIES
  try {
    const relDefines = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES)
    for (let i = 0; i < relDefines.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relDefines.get(i))
        if (!rel.RelatedObjects || !rel.RelatingPropertyDefinition?.value) continue
        const psetId = rel.RelatingPropertyDefinition.value
        const pset = ifcApi.GetLine(modelID, psetId)
        const psetName = pset.Name?.value ?? 'Properties'

        const props: Record<string, string | number | boolean> = {}
        if (pset.HasProperties) {
          for (const propRef of pset.HasProperties) {
            try {
              const prop = ifcApi.GetLine(modelID, propRef.value)
              const name = prop.Name?.value
              const val = prop.NominalValue?.value
              if (name != null && val != null) props[name] = val
            } catch {
              /* skip */
            }
          }
        }
        if (pset.Quantities) {
          for (const qRef of pset.Quantities) {
            try {
              const q = ifcApi.GetLine(modelID, qRef.value)
              const name = q.Name?.value
              const val =
                q.LengthValue?.value ??
                q.AreaValue?.value ??
                q.VolumeValue?.value ??
                q.WeightValue?.value ??
                q.CountValue?.value
              if (name != null && val != null) props[name] = val
            } catch {
              /* skip */
            }
          }
        }
        if (Object.keys(props).length === 0) continue

        for (const objRef of rel.RelatedObjects) {
          const node = expressIdToNode.get(objRef.value)
          if (!node) continue
          const m = meta(node)
          if (!m.properties) m.properties = {}
          m.properties[psetName] = props
        }
      } catch {
        /* skip rel */
      }
    }
  } catch {
    /* no property rels */
  }

  // Materials via IFCRELASSOCIATESMATERIAL
  try {
    const relMat = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL)
    for (let i = 0; i < relMat.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relMat.get(i))
        if (!rel.RelatedObjects || !rel.RelatingMaterial?.value) continue
        const mat = ifcApi.GetLine(modelID, rel.RelatingMaterial.value)

        let materialName: string | null = null
        const layers: { name: string; thickness?: number }[] = []

        const extractLayers = (layersArr: any[]) => {
          for (const lRef of layersArr) {
            try {
              const layer = ifcApi.GetLine(modelID, lRef.value)
              const layerMat = layer.Material?.value
                ? ifcApi.GetLine(modelID, layer.Material.value)
                : null
              layers.push({
                name: layerMat?.Name?.value ?? 'Unknown',
                thickness:
                  layer.LayerThickness?.value != null
                    ? layer.LayerThickness.value * unitFactor
                    : undefined,
              })
            } catch {
              /* skip */
            }
          }
        }

        if (mat.ForLayerSet?.value) {
          const layerSet = ifcApi.GetLine(modelID, mat.ForLayerSet.value)
          materialName = layerSet.LayerSetName?.value ?? null
          if (layerSet.MaterialLayers) extractLayers(layerSet.MaterialLayers)
        } else if (mat.MaterialLayers) {
          materialName = mat.LayerSetName?.value ?? null
          extractLayers(mat.MaterialLayers)
        } else if (mat.Name?.value) {
          materialName = mat.Name.value
        }

        if (!materialName && layers.length === 0) continue

        for (const objRef of rel.RelatedObjects) {
          const node = expressIdToNode.get(objRef.value)
          if (!node) continue
          const m = meta(node)
          if (materialName) m.material = materialName
          if (layers.length > 0) m.materialLayers = layers
        }
      } catch {
        /* skip rel */
      }
    }
  } catch {
    /* no material rels */
  }

  // Type names via IFCRELDEFINESBYTYPE
  try {
    const relDefType = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE)
    for (let i = 0; i < relDefType.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relDefType.get(i))
        if (!rel.RelatedObjects || !rel.RelatingType?.value) continue
        const type = ifcApi.GetLine(modelID, rel.RelatingType.value)
        const typeName = type.Name?.value
        if (!typeName) continue

        for (const objRef of rel.RelatedObjects) {
          const node = expressIdToNode.get(objRef.value)
          if (node) meta(node).typeName = typeName
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no type rels */
  }

  ifcApi.CloseModel(modelID)

  progress('Building scene graph...', 95)

  const totalNodes = Object.keys(nodes).length
  console.log(`[IFC→Pascal] Conversion complete! Generated ${totalNodes} nodes`)
  console.log(`[IFC→Pascal] Node breakdown:`, {
    sites: Object.values(nodes).filter((n) => n.type === 'site').length,
    buildings: Object.values(nodes).filter((n) => n.type === 'building').length,
    levels: Object.values(nodes).filter((n) => n.type === 'level').length,
    walls: Object.values(nodes).filter((n) => n.type === 'wall').length,
    slabs: Object.values(nodes).filter((n) => n.type === 'slab').length,
    doors: Object.values(nodes).filter((n) => n.type === 'door').length,
    windows: Object.values(nodes).filter((n) => n.type === 'window').length,
    stairs: Object.values(nodes).filter((n) => n.type === 'stair').length,
    roofs: Object.values(nodes).filter((n) => n.type === 'roof').length,
    columns: Object.values(nodes).filter((n) => n.type === 'column').length,
    skippedBeams: skippedBeamCount,
    skippedItems: skippedItemCount,
  })

  progress('Complete!', 100)

  return {
    nodes,
    rootNodeIds: rootNodeIds as AnyNodeId[],
  }
}
