// Only one index may observe a scene, and observed objects must own their Layers.
// Insertions without childadded are not observed: call register(subtree) afterward.
// Replaced Layers are repaired for known members during prepare(); other objects
// need register(object), since discovering them would require a full-scene scan.
import { type Camera, type Material, Object3D, type Scene, Vector2 } from 'three'
import { type NodeFrame, PassNode } from 'three/webgpu'

const maskObserver = Symbol('LayerPassIndex.maskObserver')

function maskOwner(object: Object3D) {
  const get = Object.getOwnPropertyDescriptor(object.layers, 'mask')?.get as
    | ((() => number) & { [maskObserver]?: Object3D })
    | undefined
  return get?.[maskObserver]
}

type RenderObject = Object3D & {
  material?: Material | Material[]
  isLight?: boolean
  castShadow: boolean
}

// Observe mask writes as well as child events: R3F's numeric `layers` prop calls
// Layers.set(), while imperative producers also use enable() and direct masks.
// Nothing on Object3D/Layers.prototype is patched, and detach restores the field.
export class LayerPassIndex {
  private readonly members = new Map<number, Set<Object3D>>()
  private readonly cleanups = new Map<Object3D, () => void>()

  constructor(
    readonly source: Scene,
    layers: number[],
  ) {
    for (const layer of layers) this.members.set(1 << layer, new Set())
    try {
      this.attach(source)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  register(subtree: Object3D) {
    this.detach(subtree)
    for (let object: Object3D | null = subtree; object; object = object.parent) {
      if (object === this.source) {
        this.attach(subtree)
        return
      }
    }
  }

  private attach = (object: Object3D) => {
    if (this.cleanups.has(object)) return
    const layers = object.layers
    if (maskOwner(object)) {
      throw new Error('LayerPassIndex requires one index per scene and unshared Layers')
    }
    let mask = layers.mask
    const sync = () => {
      for (const [bit, members] of this.members) {
        if ((mask & bit) !== 0 && object !== this.source) members.add(object)
        else members.delete(object)
      }
    }
    const getMask = Object.assign(() => mask, { [maskObserver]: object })
    Object.defineProperty(layers, 'mask', {
      configurable: true,
      enumerable: true,
      get: getMask,
      set: (value: number) => {
        if (mask === value) return
        mask = value
        sync()
      },
    })
    const added = ({ child }: { child: Object3D }) => this.attach(child)
    const removed = ({ child }: { child: Object3D }) => this.detach(child)
    object.addEventListener('childadded', added)
    object.addEventListener('childremoved', removed)
    this.cleanups.set(object, () => {
      object.removeEventListener('childadded', added)
      object.removeEventListener('childremoved', removed)
      if (Object.getOwnPropertyDescriptor(layers, 'mask')?.get === getMask) {
        Object.defineProperty(layers, 'mask', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: mask,
        })
      }
      for (const members of this.members.values()) members.delete(object)
    })
    sync()
    for (const child of object.children) this.attach(child)
  }

  private detach(object: Object3D) {
    for (const child of object.children) this.detach(child)
    this.cleanups.get(object)?.()
    this.cleanups.delete(object)
  }

  prepare(layer: number, roots: Object3D[]) {
    roots.length = 0
    const members = this.members.get(1 << layer)!
    // Repairs can change membership, so finish them before choosing nested roots.
    for (const tracked of this.members.values()) {
      for (const object of [...tracked]) {
        let root = object
        while (root.parent && root !== this.source) root = root.parent
        if (root !== this.source) this.detach(root)
        else if (maskOwner(object) !== object) this.register(object)
      }
    }
    let drawable = false
    let shadowLight = false
    for (const object of members) {
      let visible = object.visible
      let nested = false
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (!parent.visible) visible = false
        if (members.has(parent)) nested = true
      }
      if (!visible) continue
      const { material, isLight, castShadow } = object as RenderObject
      if (material) {
        drawable ||= Array.isArray(material) ? material.some((m) => m.visible) : material.visible
      }
      shadowLight ||= isLight === true && castShadow
      if (!nested) roots.push(object)
    }
    // Keep source traversal order even when a producer switches layers after
    // mounting. Ancestors on this layer remain intact, retaining group order,
    // clipping and LOD behavior; layers do not inherit through other ancestors.
    roots.sort(compareSceneOrder)
    return { drawable, shadowLight }
  }

  dispose() {
    for (const cleanup of this.cleanups.values()) cleanup()
    this.cleanups.clear()
  }
}

function compareSceneOrder(a: Object3D, b: Object3D): number {
  const pathA: Object3D[] = []
  const pathB: Object3D[] = []
  for (let object: Object3D | null = a; object; object = object.parent) pathA.push(object)
  for (let object: Object3D | null = b; object; object = object.parent) pathB.push(object)
  let i = pathA.length - 1
  let j = pathB.length - 1
  while (i >= 0 && j >= 0 && pathA[i] === pathB[j]) {
    i--
    j--
  }
  const siblings = pathA[i + 1]!.children
  return siblings.indexOf(pathA[i]!) - siblings.indexOf(pathB[j]!)
}

export class LayerPassNode extends PassNode {
  private readonly roots: Object3D[] = []
  private readonly size = new Vector2()
  private needsClear = true

  constructor(
    private readonly index: LayerPassIndex,
    camera: Camera,
    private readonly layer: number,
    private readonly mainPass: PassNode,
  ) {
    super(PassNode.COLOR, index.source, camera)
    // A scene view, not cloned meshes: callbacks, environment, fog, materials,
    // skeletons and world matrices retain their original owners and values.
    this.scene = new Proxy(index.source, {
      get: (source, key) => {
        if (key === 'children') return this.roots
        if (key === 'matrixWorldAutoUpdate') return false
        return Reflect.get(source, key, source)
      },
    })
  }

  override dispose() {
    this.roots.length = 0
    super.dispose()
  }

  override updateBefore(frame: NodeFrame): undefined {
    // NodeFrame deduplicates FRAME updates. Make the dependency explicit rather
    // than relying on which composite expression the TSL builder visits first.
    frame.updateBeforeNode(this.mainPass)
    const { drawable, shadowLight } = this.index.prepare(this.layer, this.roots)
    const renderer = frame.renderer!
    const source = this.index.source
    const hasBackground =
      source.background !== null || ('backgroundNode' in source && source.backgroundNode != null)
    const hasSceneCallbacks =
      source.onBeforeRender !== Object3D.prototype.onBeforeRender ||
      source.onAfterRender !== Object3D.prototype.onAfterRender
    if (drawable || hasBackground || hasSceneCallbacks) {
      this.needsClear = true
      // Shadows need all source casters; custom callbacks need the original
      // scene receiver and graph, including when they enable an empty layer.
      const root = this.scene
      if (shadowLight || hasSceneCallbacks) this.scene = source
      try {
        if (this.scene !== source) {
          const updatedAncestors = new Set<Object3D>()
          const updateAncestor = (object: Object3D | null) => {
            if (!object || updatedAncestors.has(object)) return
            updateAncestor(object.parent)
            // Force world refreshes even when a manual local matrix is clean.
            object.matrixWorldNeedsUpdate = true
            object.updateWorldMatrix(false, false)
            updatedAncestors.add(object)
          }
          for (const root of this.roots) {
            updateAncestor(root.parent)
            root.updateMatrixWorld(true)
          }
        }
        super.updateBefore(frame)
      } finally {
        this.scene = root
      }
      return
    }

    const outputTarget = renderer.getOutputRenderTarget()
    if (outputTarget && 'isXRRenderTarget' in outputTarget && outputTarget.isXRRenderTarget)
      this.size.set(outputTarget.width, outputTarget.height)
    else renderer.getDrawingBufferSize(this.size)
    const width = this.renderTarget.width
    const height = this.renderTarget.height
    this.setSize(this.size.x, this.size.y)
    if (width !== this.renderTarget.width || height !== this.renderTarget.height)
      this.needsClear = true
    if (!this.needsClear) return

    const target = renderer.getRenderTarget()
    const mrt = renderer.getMRT()
    try {
      renderer.setRenderTarget(this.renderTarget)
      renderer.setMRT(null)
      renderer.clear(true, true, true)
      this.needsClear = false
    } finally {
      renderer.setRenderTarget(target)
      renderer.setMRT(mrt)
    }
  }
}
