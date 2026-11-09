import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER } from '@pascal-app/viewer'
import { type Intersection, type Mesh, type Object3D, Raycaster, Vector3 } from 'three'

// Drawn by the scene pass or by a merged batch that stands in for the mesh.
const DRAWN_LAYERS_MASK = (1 << SCENE_LAYER) | (1 << BATCHED_LAYER)
// High enough above any level's floor that a raised platform is below it.
const CAST_HEIGHT = 50
const down = new Vector3(0, -1, 0)
const origin = new Vector3()

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
 * site's ground and terrain. Walls, items, ceilings, roofs and other levels
 * are not in it. The mesh list is rebuilt only when the scene, the registry
 * or the level changes; `revision` moves with it and with any geometry or
 * transform change, so callers can cache answers between moves.
 */
export class FloorSurface {
  /** The level whose floors count. */
  levelId: string | null = null
  private readonly raycaster = new Raycaster()
  private readonly hits: Intersection[] = []
  private meshes: Mesh[] = []
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

  get revision() {
    this.refresh()
    return this.version
  }

  /** Height of the highest floor surface at `x`/`z`, or null over nothing. */
  topAt(x: number, z: number, levelY: number): number | null {
    origin.set(x, levelY + CAST_HEIGHT, z)
    this.raycaster.set(origin, down)
    this.raycaster.far = Number.POSITIVE_INFINITY
    let top: number | null = null
    for (const mesh of this.meshes) {
      if (!isDrawn(mesh)) continue
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
    const level = this.levelId ? nodes[this.levelId as AnyNodeId] : undefined
    if (level?.type !== 'level') return meshes

    const nodeObjects = new Set(sceneRegistry.nodes.values())
    const collect = (object: Object3D, root: Object3D) => {
      // A slab's hosted items and a site's buildings are not its surface.
      if (object !== root && nodeObjects.has(object)) return
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
        if (object) collect(object, object)
      }
    }
    return meshes
  }
}
