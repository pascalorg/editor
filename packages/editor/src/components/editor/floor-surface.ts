import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER } from '@pascal-app/viewer'
import { Box3, type Intersection, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'

// Drawn by the scene pass or by a merged batch that stands in for the mesh.
const DRAWN_LAYERS_MASK = (1 << SCENE_LAYER) | (1 << BATCHED_LAYER)
// High enough above any level's floor that a raised platform is below it.
const CAST_HEIGHT = 50
const down = new Vector3(0, -1, 0)
const origin = new Vector3()
const reachBox = new Box3()
const lotPoint = new Vector3()

type Lot = { site: Object3D; points: ReadonlyArray<readonly [number, number]> }

function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true
}

function isDrawn(mesh: Mesh) {
  if ((mesh.layers.mask & DRAWN_LAYERS_MASK) === 0) return false
  for (let current: Object3D | null = mesh; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/** Whether world (x, z) lies inside the property line, which is laid out in the site's own plan. */
function insideLot({ site, points }: Lot, x: number, z: number): boolean {
  site.worldToLocal(lotPoint.set(x, 0, z))
  let inside = false
  for (let a = 0, b = points.length - 1; a < points.length; b = a, a += 1) {
    const [ax, az] = points[a]!
    const [bx, bz] = points[b]!
    if (az > lotPoint.z !== bz > lotPoint.z) {
      if (lotPoint.x < ((bx - ax) * (lotPoint.z - az)) / (bz - az) + ax) inside = !inside
    }
  }
  return inside
}

function levelOf(nodes: Record<AnyNodeId, AnyNode>, id: string): AnyNode | null {
  let node: AnyNode | undefined = nodes[id as AnyNodeId]
  while (node) {
    if (node.type === 'level') return node
    node = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  }
  return null
}

/**
 * The walkable surface of the active level: its floor slabs and plates
 * (raised platforms and sunken floors included) and, on the ground level, the
 * site's ground and terrain, the sculpted tiles among it, inside the property
 * line: sculpted ground is drawn to the line only, though its tiles reach past
 * it. Walls, items, ceilings, roofs and other levels are not in it. The mesh
 * list is rebuilt only when the scene, the registry or the level changes;
 * `revision` moves with it and with any geometry or transform change, so
 * callers can cache answers between moves.
 */
export class FloorSurface {
  /** The level whose floors count. */
  levelId: string | null = null
  private readonly raycaster = new Raycaster()
  private readonly hits: Intersection[] = []
  private meshes: Mesh[] = []
  // The site's own ground among them, and the property line it is drawn within.
  private siteGround = new Set<Mesh>()
  private lot: Lot | null = null
  private objects: { object: Object3D; children: Object3D[] }[] = []
  private builtFor: { registry: number; nodes: unknown; levelId: string | null } | null = null
  private meshStates: {
    geometry: Mesh['geometry']
    position: unknown
    positionVersion: number
    index: unknown
    indexVersion: number
    matrix: number[]
    drawn: boolean
  }[] = []
  private version = 0
  private reach: { version: number; y: number | null } | null = null

  get revision() {
    this.refresh()
    return this.version
  }

  /**
   * The highest the surface stands anywhere, world Y, or null with nothing drawn: a hill may
   * stand many metres over the level's floor, and a caller that only looks for a floor near the
   * level's own would fly into it.
   */
  get reachY(): number | null {
    this.refresh()
    if (this.reach?.version !== this.version) {
      let y: number | null = null
      for (const mesh of this.meshes) {
        const position = mesh.geometry.getAttribute('position')
        if (!position || !isDrawn(mesh)) continue
        // Read from the vertices, not the geometry's own box: sculpted ground moves in place.
        reachBox.setFromBufferAttribute(position as never).applyMatrix4(mesh.matrixWorld)
        if (!reachBox.isEmpty() && (y === null || reachBox.max.y > y)) y = reachBox.max.y
      }
      this.reach = { version: this.version, y }
    }
    return this.reach.y
  }

  /** Height of the highest floor surface at `x`/`z`, or null over nothing. */
  topAt(x: number, z: number, levelY: number): number | null {
    origin.set(x, levelY + CAST_HEIGHT, z)
    this.raycaster.set(origin, down)
    this.raycaster.far = Number.POSITIVE_INFINITY
    let top: number | null = null
    const pastLot = this.lot !== null && !insideLot(this.lot, x, z)
    for (const mesh of this.meshes) {
      if (!isDrawn(mesh)) continue
      if (pastLot && this.siteGround.has(mesh)) continue
      this.hits.length = 0
      mesh.raycast(this.raycaster, this.hits)
      for (const hit of this.hits) if (top === null || hit.point.y > top) top = hit.point.y
    }
    this.hits.length = 0
    return top
  }

  private refresh() {
    const nodes = useScene.getState().nodes
    const registry = sceneRegistry.revision
    const built = this.builtFor
    let structureChanged = false
    for (const { object, children } of this.objects) {
      if (object.children.length !== children.length) {
        structureChanged = true
        break
      }
      for (let i = 0; i < children.length; i++) {
        if (object.children[i] === children[i]) continue
        structureChanged = true
        break
      }
      if (structureChanged) break
    }
    if (
      !built ||
      built.registry !== registry ||
      built.nodes !== nodes ||
      built.levelId !== this.levelId ||
      structureChanged
    ) {
      this.builtFor = { registry, nodes, levelId: this.levelId }
      this.meshes = this.collect(nodes)
      this.meshStates = this.meshes.map((mesh) => ({
        geometry: mesh.geometry,
        position: null,
        positionVersion: -1,
        index: null,
        indexVersion: -1,
        matrix: mesh.matrixWorld.elements.slice(),
        drawn: isDrawn(mesh),
      }))
      this.version += 1
    }
    // Geometry is rebuilt after the node change that caused it, in place.
    let changed = false
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!
      const state = this.meshStates[i]!
      const position = mesh.geometry.getAttribute('position')
      const positionVersion = position && 'version' in position ? position.version : 0
      const index = mesh.geometry.index
      const indexVersion = index?.version ?? 0
      const drawn = isDrawn(mesh)
      if (
        state.geometry !== mesh.geometry ||
        state.position !== position ||
        state.positionVersion !== positionVersion ||
        state.index !== index ||
        state.indexVersion !== indexVersion ||
        state.drawn !== drawn
      ) {
        state.geometry = mesh.geometry
        state.position = position
        state.positionVersion = positionVersion
        state.index = index
        state.indexVersion = indexVersion
        state.drawn = drawn
        changed = true
      }
      for (let j = 0; j < 16; j++) {
        const value = mesh.matrixWorld.elements[j]!
        if (state.matrix[j] === value) continue
        state.matrix[j] = value
        changed = true
      }
    }
    if (changed) this.version += 1
  }

  private collect(nodes: Record<AnyNodeId, AnyNode>) {
    const meshes: Mesh[] = []
    this.objects = []
    this.siteGround = new Set()
    this.lot = null
    const level = this.levelId ? nodes[this.levelId as AnyNodeId] : undefined
    if (level?.type !== 'level') return meshes

    const nodeObjects = new Set(sceneRegistry.nodes.values())
    // Sculpted ground is drawn tile by tile, each a node under the site: the site's ground still.
    const groundTiles = new Set<Object3D>()
    for (const id of sceneRegistry.byType['terrain-tile'] ?? []) {
      const tile = sceneRegistry.nodes.get(id)
      if (tile) groundTiles.add(tile)
    }
    const collect = (object: Object3D, root: Object3D) => {
      // A slab's hosted items and a site's buildings are not its surface.
      if (object !== root && nodeObjects.has(object) && !groundTiles.has(object)) return
      this.objects.push({ object, children: object.children.slice() })
      if (isMesh(object)) meshes.push(object)
      for (const child of object.children) collect(child, root)
    }
    for (const id of sceneRegistry.byType.slab ?? []) {
      if (nodes[id as AnyNodeId]?.visible === false) continue
      if (levelOf(nodes, id)?.id !== level.id) continue
      const object = sceneRegistry.nodes.get(id)
      if (object) collect(object, object)
    }
    if (level.level === 0) {
      for (const id of sceneRegistry.byType.site ?? []) {
        const object = sceneRegistry.nodes.get(id)
        if (!object) continue
        const first = meshes.length
        collect(object, object)
        for (const mesh of meshes.slice(first)) this.siteGround.add(mesh)
        const site = nodes[id as AnyNodeId]
        const points = site?.type === 'site' ? site.polygon?.points : undefined
        if (points && points.length >= 3) this.lot = { site: object, points }
      }
    }
    return meshes
  }
}
