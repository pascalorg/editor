import { type GeometryContext, type RampNode, rampStations } from '@pascal-app/core'
import {
  type ColorPreset,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  type Material,
  Mesh,
} from 'three'

type Station = ReturnType<typeof rampStations>[number]
type Point3 = [number, number, number]
type UV = [number, number]
type Row = { left: Point3; right: Point3; distance: number }
type RibbonWriter = ReturnType<typeof ribbonWriter>

function ribbonWriter() {
  const positions: number[] = []
  const uvs: number[] = []
  const quad = (points: [Point3, Point3, Point3, Point3], texture: [UV, UV, UV, UV]) => {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = points[index]
      const uv = texture[index]
      if (point && uv) {
        positions.push(...point)
        uvs.push(...uv)
      }
    }
  }
  return { positions, uvs, quad }
}

function ribbonRows(stations: Station[], width: number): Row[] {
  let distance = 0
  return stations.map((station, index): Row => {
    const previous = stations[index - 1]
    if (previous)
      distance += Math.hypot(station.distance - previous.distance, station.height - previous.height)
    const [x, z] = station.point
    const [tx, tz] = station.tangent
    return {
      left: [x - (tz * width) / 2, station.height, z + (tx * width) / 2],
      right: [x + (tz * width) / 2, station.height, z - (tx * width) / 2],
      distance,
    }
  })
}

function writeRibbonTop(rows: Row[], width: number, writer: RibbonWriter) {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (!a || !b) continue
    // Forward along the left edge, then across to the right: upward-facing in XZ.
    writer.quad(
      [a.left, b.left, b.right, a.right],
      [
        [a.distance, 0],
        [b.distance, 0],
        [b.distance, width],
        [a.distance, width],
      ],
    )
  }
}

function writeRibbonEdges(rows: Row[], width: number, thickness: number, writer: RibbonWriter) {
  const bottom = (point: Point3): Point3 => [point[0], point[1] - thickness, point[2]]
  const length3 = (a: Point3, b: Point3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  let leftDistance = 0
  let rightDistance = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    if (!a || !b) continue
    const nextLeft = leftDistance + length3(a.left, b.left)
    const nextRight = rightDistance + length3(a.right, b.right)
    writer.quad(
      [bottom(a.left), bottom(a.right), bottom(b.right), bottom(b.left)],
      [
        [a.distance, 0],
        [a.distance, width],
        [b.distance, width],
        [b.distance, 0],
      ],
    )
    writer.quad(
      [a.left, bottom(a.left), bottom(b.left), b.left],
      [
        [leftDistance, 0],
        [leftDistance, thickness],
        [nextLeft, thickness],
        [nextLeft, 0],
      ],
    )
    writer.quad(
      [a.right, b.right, bottom(b.right), bottom(a.right)],
      [
        [rightDistance, 0],
        [nextRight, 0],
        [nextRight, thickness],
        [rightDistance, thickness],
      ],
    )
    leftDistance = nextLeft
    rightDistance = nextRight
  }
  const first = rows[0]
  const last = rows.at(-1)
  if (!first || !last) return
  writer.quad(
    [first.left, first.right, bottom(first.right), bottom(first.left)],
    [
      [0, 0],
      [width, 0],
      [width, thickness],
      [0, thickness],
    ],
  )
  writer.quad(
    [last.left, bottom(last.left), bottom(last.right), last.right],
    [
      [0, 0],
      [0, thickness],
      [width, thickness],
      [width, 0],
    ],
  )
}

/** Separate faces keep top and solid edges crisp; each UV unit is one metre. */
function solidRibbon(stations: Station[], width: number, thickness: number): BufferGeometry {
  const geometry = new BufferGeometry()
  if (stations.length < 2) return geometry
  const rows = ribbonRows(stations, width)
  const writer = ribbonWriter()
  writeRibbonTop(rows, width, writer)
  const edgeStart = writer.positions.length / 3
  writeRibbonEdges(rows, width, thickness, writer)
  geometry.addGroup(0, edgeStart, 0)
  geometry.addGroup(edgeStart, writer.positions.length / 3 - edgeStart, 1)
  geometry.setAttribute('position', new Float32BufferAttribute(writer.positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(writer.uvs, 2))
  geometry.setAttribute('uv2', new Float32BufferAttribute(writer.uvs, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Site-local positions, absolute Site-local top Y, thickness down. */
export function buildRampRibbonGeometry(node: RampNode): BufferGeometry {
  return solidRibbon(rampStations(node), node.width, node.thickness)
}

function addRibbonMeshes(group: Group, ribbon: BufferGeometry, materials: Material[]) {
  for (const [index, slot] of ['surface', 'edge'].entries()) {
    const range = ribbon.groups[index]
    const material = materials[index]
    if (!range || !material) continue
    const geometry = new BufferGeometry()
    for (const key of ['position', 'normal', 'uv', 'uv2']) {
      const attribute = ribbon.getAttribute(key)
      geometry.setAttribute(
        key,
        new Float32BufferAttribute(
          Array.from(attribute.array).slice(
            range.start * attribute.itemSize,
            (range.start + range.count) * attribute.itemSize,
          ),
          attribute.itemSize,
        ),
      )
    }
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const mesh = new Mesh(geometry, material)
    mesh.name = `ramp-${slot}`
    mesh.userData.slotId = slot
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  ribbon.dispose()
}

function addRetainingSides(group: Group, node: RampNode, material: Material) {
  const wallWidth = 0.2
  const stations = rampStations(node)
  for (const side of [-1, 1]) {
    const offset = side * (node.width / 2 + wallWidth / 2)
    const wallStations = stations.map((station) => ({
      ...station,
      height: station.height + node.retainingHeight,
      point: [
        station.point[0] - station.tangent[1] * offset,
        station.point[1] + station.tangent[0] * offset,
      ] as [number, number],
    }))
    // The side retains the cut above the roadway and embeds to its underside.
    const wall = new Mesh(
      solidRibbon(wallStations, wallWidth, node.retainingHeight + node.thickness),
      material,
    )
    wall.name = side > 0 ? 'ramp-retaining-left' : 'ramp-retaining-right'
    wall.userData.slotId = 'retaining'
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
  }
}

export function buildRampGeometry(
  node: RampNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  const material = (slot: string, color: string) => {
    if (!textures) return createSurfaceRoleMaterial('floor', colorPreset, FrontSide, sceneTheme)
    const resolved = resolveMaterialRef(node.slots?.[slot], ctx?.materials, shading)
    if (resolved) return resolved
    return createDefaultMaterial(color, 0.85, shading, FrontSide)
  }
  addRibbonMeshes(group, buildRampRibbonGeometry(node), [
    material('surface', '#aaa69c'),
    material('edge', '#88857e'),
  ])
  if (node.retainingHeight > 0) addRetainingSides(group, node, material('retaining', '#88857e'))
  return group
}
