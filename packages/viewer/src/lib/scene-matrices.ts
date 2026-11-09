import { type Light, type LightShadow, type Matrix4, Object3D } from 'three'
import { getLayoutRevision, isLayoutObserved } from './layer-pass'
import { BATCHED_LAYER, SHADOW_ONLY_LAYER } from './layers'

/**
 * The frame's one walk over the scene graph before it renders: matrices, recomputing only what
 * changed, and the subtrees no pass of this frame can draw.
 *
 * three's `updateMatrixWorld` recomposes every object's local matrix and multiplies every world
 * matrix each time it runs, and every `renderer.render` of the scene runs it again (prepass,
 * scene pass, layer passes, shadows). Editor scenes hold ~10k objects, almost all static, so that
 * was ~13 ms a frame. Here each object remembers the inputs its matrices were last built from —
 * position, quaternion, scale and pivot (or the local matrix itself when `matrixAutoUpdate` is
 * off) and its parent — and is rebuilt only when one differs, or when its parent's world matrix
 * was. The results are the same as three's: a write to `position` is seen the same frame.
 *
 * Every pass also walks the whole graph to find what to draw, and most of an editor scene is not
 * drawable by the color passes: batched originals live on the batched layer, a soloed level's
 * objects on the shadow-only layer. The same walk finds the top-most subtrees with nothing a pass
 * can draw this frame, and they are hidden for the render alone, so three never enters them.
 * Shadow-only content counts as drawable when a light's shadow map renders this frame. Picking,
 * outlines and bounds run outside the render and see the scene unchanged.
 *
 * Those set-aside subtrees are not walked again while nothing could change what they hold: no
 * observed mask write or child insertion or removal anywhere (LayerPassIndex's revision), no move
 * of their parent, and at least every {@link FULL_WALK_FRAMES} frames regardless. Their matrices
 * (picking reads them) are brought up to date on the next full walk.
 *
 * Objects that override `updateMatrixWorld` (cameras, skinned meshes, audio, some helpers) are
 * handed to their own method, which brings their subtree up to date the way three would; they and
 * their subtrees always count as drawable.
 */

const BASE_UPDATE_MATRIX_WORLD = Object3D.prototype.updateMatrixWorld
const MATRIX = 16
const FULL_WALK_FRAMES = 30

/** Layers some pass of the frame may draw: everything but the batched originals'. */
const COLOR_LAYERS = ~((1 << BATCHED_LAYER) | (1 << SHADOW_ONLY_LAYER))
const SHADOW_LAYERS = 1 << SHADOW_ONLY_LAYER

/** Bit 1: holds something a color pass draws. Bit 2: something only a shadow pass draws. */
const COLOR = 1
const SHADOW = 2

/**
 * `holds`: what the subtree held at its last walk; `idle`: whether it was set aside then;
 * `drawn`: whether the object itself is drawn ({@link isDrawn}); `custom`: whether it overrides
 * `updateMatrixWorld`. Both are fixed by its class.
 */
type Memo = {
  local: Float64Array
  parent: Object3D | null
  holds: number
  idle: boolean
  drawn: boolean
  custom: boolean
}
type Memoized = Object3D & { [MEMO]?: Memo }

const MEMO = Symbol('pascal:scene-matrices')

type ShadowLight = Light & { shadow?: LightShadow }

function memoOf(object: Memoized): Memo {
  let memo = object[MEMO]
  if (!memo) {
    memo = {
      local: new Float64Array(MATRIX).fill(Number.NaN),
      parent: undefined as never,
      holds: 0,
      idle: false,
      drawn: isDrawn(object as Drawn),
      custom: object.updateMatrixWorld !== BASE_UPDATE_MATRIX_WORLD,
    }
    object[MEMO] = memo
  }
  return memo
}

/** Whether `object`'s TRS (and pivot) differ from what its matrix was last composed from. */
function trsChanged(object: Object3D, local: Float64Array): boolean {
  const { position: p, quaternion: q, scale: s } = object
  const pivot = (object as { pivot?: { x: number; y: number; z: number } | null }).pivot ?? null
  const px = pivot ? pivot.x : Number.NaN
  const py = pivot ? pivot.y : Number.NaN
  const pz = pivot ? pivot.z : Number.NaN
  if (
    local[0] === p.x &&
    local[1] === p.y &&
    local[2] === p.z &&
    local[3] === q.x &&
    local[4] === q.y &&
    local[5] === q.z &&
    local[6] === q.w &&
    local[7] === s.x &&
    local[8] === s.y &&
    local[9] === s.z &&
    // NaN marks "no pivot"; Object.is matches it to itself.
    Object.is(local[10], px) &&
    Object.is(local[11], py) &&
    Object.is(local[12], pz)
  ) {
    return false
  }
  local[0] = p.x
  local[1] = p.y
  local[2] = p.z
  local[3] = q.x
  local[4] = q.y
  local[5] = q.z
  local[6] = q.w
  local[7] = s.x
  local[8] = s.y
  local[9] = s.z
  local[10] = px
  local[11] = py
  local[12] = pz
  return true
}

/** Whether a hand-set local matrix differs from the one the world matrix was last built from. */
function matrixChanged(matrix: Matrix4, local: Float64Array): boolean {
  const e = matrix.elements
  let changed = false
  for (let i = 0; i < MATRIX; i++) {
    if (local[i] !== e[i]) {
      local[i] = e[i]!
      changed = true
    }
  }
  return changed
}

type Drawn = {
  isMesh?: boolean
  isLine?: boolean
  isPoints?: boolean
  isSprite?: boolean
  isLight?: boolean
  isLOD?: boolean
  isClippingGroup?: boolean
  isBundleGroup?: boolean
}

/** Objects a pass draws or collects itself; groups and plain nodes only hold them. */
function isDrawn(o: Drawn): boolean {
  return (
    o.isMesh === true ||
    o.isLine === true ||
    o.isPoints === true ||
    o.isSprite === true ||
    o.isLight === true ||
    o.isLOD === true ||
    o.isClippingGroup === true ||
    o.isBundleGroup === true
  )
}

/** Top-most subtrees with nothing to draw: for color passes alone, and with shadow-only content. */
type Walk = {
  colorIdle: Object3D[]
  shadowIdle: Object3D[]
  shadowPending: boolean
  /** Subtrees set aside last time may be skipped. */
  skipIdle: boolean
  /** Shadow-casting lights met on the way. */
  shadowLights: ShadowLight[]
}

function update(object: Object3D, force: boolean, walk: Walk): number {
  const memo = memoOf(object)
  if (memo.custom) {
    object.updateMatrixWorld(force)
    memo.holds = COLOR | SHADOW
    return memo.holds
  }
  // What this walk compares decides, not `matrixWorldNeedsUpdate`: other code's
  // `updateWorldMatrix(true, …)` raises that flag up whole ancestor chains every frame while
  // recomputing the same values, and honouring it forced the entire graph each frame.
  let changed = force
  if (posed.size > 0 && posed.has(object)) {
    object.updateMatrix()
    changed = true
  } else if (object.matrixAutoUpdate) {
    // A matrix kept by hand earlier left 16 numbers here; TRS uses the first 13.
    if (trsChanged(object, memo.local)) {
      object.updateMatrix()
      changed = true
    }
  } else if (matrixChanged(object.matrix, memo.local)) {
    changed = true
  }
  // A set-aside subtree that has not itself moved holds what it held; what is inside changes
  // drawability only through a mask or child event, which forces a full walk.
  if (walk.skipIdle && memo.idle && !changed && memo.parent === object.parent) return memo.holds
  if (memo.parent !== object.parent) {
    memo.parent = object.parent
    changed = true
  }
  if (changed) {
    if (object.matrixWorldAutoUpdate === true) {
      if (object.parent === null) object.matrixWorld.copy(object.matrix)
      else object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix)
    }
    force = true
  }
  object.matrixWorldNeedsUpdate = false

  let all = 0
  if (memo.drawn) {
    const mask = object.layers.mask
    if (mask & COLOR_LAYERS) all |= COLOR
    if (mask & SHADOW_LAYERS) all |= SHADOW
    const light = object as ShadowLight
    if (light.isLight && light.castShadow && light.shadow) {
      walk.shadowLights.push(light)
      if (light.shadow.autoUpdate || light.shadow.needsUpdate) walk.shadowPending = true
    }
  }
  const children = object.children
  for (let i = 0; i < children.length; i++) all |= update(children[i]!, force, walk)
  // Children's results decide which of them to set aside: those with nothing, under a parent
  // that holds something (the parent's own parent sets the parent aside otherwise).
  if (all !== 0) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Memoized
      const childMemo = child[MEMO]
      if (!childMemo) continue
      const held = childMemo.holds
      const aside = all & COLOR ? !(held & COLOR) : !(held & SHADOW)
      childMemo.idle = aside
      if (!aside) continue
      if (!(held & SHADOW)) walk.shadowIdle.push(child)
      if (all & COLOR) walk.colorIdle.push(child)
    }
  }
  memo.holds = all
  return all
}

/**
 * Objects whose `updateMatrix` composes a pose that moves on its own (a construction reveal, an
 * agent's glide: reveal-pose.ts) — their TRS stays put, so they recompose every frame.
 */
const posed = new Set<Object3D>()

/** Marks `object` as composing its matrix from more than its TRS, or no longer (`false`). */
export function setMatrixPosed(object: Object3D, on: boolean): void {
  if (on) {
    posed.add(object)
    return
  }
  posed.delete(object)
  // Its last posed matrix is not what its TRS gives: rebuild on the next walk.
  const memo = (object as Memoized)[MEMO]
  if (memo) memo.local[0] = Number.NaN
}

let lastRevision = -1
let framesSinceFull = 0

/**
 * Brings every matrix under `root` up to date, rebuilding only those whose inputs changed.
 * Returns what it found: the subtrees nothing of this frame draws, and the shadow casting lights.
 */
function updateSceneMatrices(root: Object3D): Walk {
  const skipIdle =
    isLayoutObserved(root) &&
    getLayoutRevision() === lastRevision &&
    framesSinceFull < FULL_WALK_FRAMES
  framesSinceFull = skipIdle ? framesSinceFull + 1 : 0
  const walk: Walk = {
    colorIdle: [],
    shadowIdle: [],
    shadowPending: false,
    skipIdle,
    shadowLights: [],
  }
  update(root, false, walk)
  lastRevision = getLayoutRevision()
  if (walk.shadowPending && skipIdle) {
    // Shadow-only content skipped while color-idle must be current before a shadow pass draws it.
    framesSinceFull = FULL_WALK_FRAMES
    return updateSceneMatrices(root)
  }
  return walk
}

/** The shadow map each light had after the last render. */
const shadowMaps = new WeakMap<ShadowLight, unknown>()

const hidden = new Set<Object3D>()

/** Whether `object` is hidden only because this render set it aside (outline proxies read this). */
export function isSetAsideForRender(object: Object3D): boolean {
  return hidden.has(object)
}

/**
 * Runs `render` with the scene's matrices updated once beforehand, three's per-render update off,
 * and the subtrees no pass draws set aside, so every pass sees the same, already current, matrices
 * and walks only what it can draw.
 */
export function renderWithSceneMatrices<T>(scene: Object3D, render: () => T): T {
  const walk = updateSceneMatrices(scene)
  const idle = walk.shadowPending ? walk.shadowIdle : walk.colorIdle
  hidden.clear()
  for (const object of idle) {
    if (!object.visible) continue
    object.visible = false
    hidden.add(object)
  }
  const auto = scene.matrixWorldAutoUpdate
  scene.matrixWorldAutoUpdate = false
  try {
    return render()
  } finally {
    scene.matrixWorldAutoUpdate = auto
    for (const object of hidden) object.visible = true
    hidden.clear()
    // A light whose shadow map was (re)built during the render drew it without what this frame
    // set aside (a shadow node rebuilt with the pipeline): draw it whole next frame.
    for (const light of walk.shadowLights) {
      const map = light.shadow!.map
      if (shadowMaps.get(light) === map) continue
      shadowMaps.set(light, map)
      if (map) light.shadow!.needsUpdate = true
    }
  }
}
