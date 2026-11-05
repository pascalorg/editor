import {
  Box3,
  type Camera,
  Color,
  DataTexture,
  FloatType,
  Frustum,
  type Intersection,
  MathUtils,
  Matrix4,
  Mesh,
  NearestFilter,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Raycaster,
  RedFormat,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import {
  abs,
  clamp,
  dot,
  Fn,
  float,
  If,
  int,
  ivec2,
  Loop,
  max,
  normalize,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  vec3,
  vec4,
} from 'three/tsl'

/**
 * "Room-aware" interior light, the game-engine way (ported from the enhanced viewer):
 *
 * - Zone polygons are rasterized per level into a top-down room-id map (10 cm cells). A fragment
 *   finds its room by looking up `p + n·0.18` — a wall face looks *into* the room it faces, so
 *   light never leaks through walls and there are no shadow maps to pay for.
 * - Each room owns its lamps and window "portals": glass rectangles that emit sky (+ ground
 *   bounce) radiance inwards with an analytic rectangle form factor, plus the internally
 *   reflected component (split-flux) and the sky patch on the floor. Enclosed rooms see only
 *   a tenth of the sky environment.
 * - Openings between rooms (doorways, arches, open plan) carry light from the neighbour and
 *   crossfade room-wide terms at the threshold.
 * - At night, lit rooms throw light out through their windows (a gobo of the main lamp + the
 *   pane glow), and lamps outside every room light exterior surfaces analytically.
 *
 * Everything feeds the material lighting through `getGI` / `getAO` contexts: real diffuse
 * irradiance (× albedo, × AO), not a post overlay. Shader inputs are uniforms and data textures,
 * so rebuilding after an edit never recompiles a material.
 */

type N = any
const CELL = 0.1
/** Texels per portal: [center, halfW] [normal, halfH] [radiance, neighbour] [floorY, mainLamp, gain, kind]. */
const PSTRIDE = 4
/** Target average lamp irradiance of a room at night (same units as the ~1.5 sky irradiance of day). */
const LAMP_E_TARGET = 1.1
/** Lamps have a size (shade/diffuser): never evaluate the inverse square closer than ~0.8 m. */
const LAMP_MIN_D2 = 0.64
const DATA_W = 256
const MAX_LEVELS = 8
/** Texels per exterior lamp: [pos, range] [rgb, cosInner] [spot dir, cosOuter]. */
const EXT_STRIDE = 3

export type RoomLamp = {
  position: Vector3
  color: Color
  /** Candela-ish, after the per-room soft cap. */
  intensity: number
  range: number
  itemId?: string
  /** Lit right now (the lamp's own switch). */
  on: boolean
  /** Spotlight cone (exterior lamps keep it; inside, lamps fill their room). */
  spot?: { direction: Vector3; cosOuter: number; cosInner: number }
  /**
   * The light's authored intensity (cd, as the real light shines at it). Exterior lamps light
   * façades and ground with it, as the scene's lights do — `intensity` is a room-metering value,
   * log-compressed from it, and only caps it (layouts with physical-looking 1800 cd stay tame).
   */
  candela?: number
}

export type RoomZone = {
  id: string
  /** World XZ. */
  polygon: [number, number][]
  levelIndex: number
}

export type RoomOpeningRoot = { object: Object3D; kind: 'window' | 'door'; id: string }

/** What the room system needs from a scene (live parametric or baked artifact). */
export type RoomSceneInput = {
  bounds: Box3
  /** World Y of each level, assembled (not exploded), ascending. */
  levelY: number[]
  zones: RoomZone[]
  /** Ceilings, roofs and slabs (enclosure rays) with their kind. */
  covers: { object: Object3D; kind: 'ceiling' | 'roof' | 'slab' }[]
  /** Wall meshes only (openings and their parts excluded), for walkable-opening rays. */
  walls: Object3D[]
  openings: RoomOpeningRoot[]
  lamps: RoomLamp[]
  /** Whether rooms without lamps of their own get their virtual ceiling lamp lit. */
  virtualLampsOn: boolean
  /** Layers the enclosure/opening rays test (batched originals live off layer 0). */
  configureRaycaster?: (raycaster: Raycaster) => void
}

type Portal = {
  center: Vector3
  /** Points into the room. */
  normal: Vector3
  width: number
  height: number
  room: number
  /** 0 window glass · 1 interior opening (neighbour light) · 2 exterior opening. */
  kind: 0 | 1 | 2
  neighbor: number
  doorId?: string
  gain: number
}

type Opening = {
  a: number
  b: number
  center: Vector3
  /** Horizontal, from room a towards b. */
  normal: Vector3
  width: number
  height: number
  doorId?: string
}

type Room = {
  zone: RoomZone
  levelIndex: number
  enclosed: boolean
  area: number
  centroid: Vector3
  ceilingY: number
  /** Height of the topmost cover above the room, and whether it is opaque from above. */
  coverY: number
  coverIsRoof: boolean
  /** Interior surface area (floor + ceiling + walls) — used by the meters. */
  surfaces: number
  /** Average irradiance from lamps at full level (after the soft cap), and from daylight. */
  lampE: number
  dayE: number
  lamps: RoomLamp[]
  portals: Portal[]
}

export type SkySampler = (outward: Vector3) => Color

const _viewProj = new Matrix4()
const _frustum = new Frustum()
const _toCamera = new Vector3()
const _roomsLight = new Color()

export class RoomLighting {
  rooms: Room[] = []
  /** Lamps outside every room (lanterns, garden lights), lit analytically on outside surfaces. */
  exteriorLamps: RoomLamp[] = []
  portals: Portal[] = []
  openings: Opening[] = []
  levelY: number[] = [0]
  private data = new Float32Array(4)
  private map = new Float32Array(1)
  private origin = new Vector2()
  private gridW = 1
  private gridH = 1
  private levels = 1
  private lampTexel = new Map<RoomLamp, number>()
  private lastSky: Parameters<RoomLighting['updateSky']> | null = null

  // ---- runtime controls (the enhanced viewer's daylight preset) -------------------------------
  readonly portalGain = uniform(2.5)
  readonly bounceGain = uniform(1.5)
  readonly lampGain = uniform(1)
  /**
   * Lamp light as drawn, not as metered: eased below 1 while the camera is outside at night, so
   * lit rooms seen from out there keep an indoor-like exposure (the meters ignore it).
   */
  readonly lampView = uniform(1)
  /** Sky-IBL multiplier in enclosed rooms. */
  readonly indoorEnv = uniform(0.1)
  /** Window spill outside at night. */
  readonly spillGain = uniform(1)
  /** Ceiling for lamp irradiance on any surface (soft): ≈3× the room-average target. */
  readonly lampMaxE = uniform(3.2)
  /** Sky patch on the floor (0 on the Low tier). */
  readonly skyPatch = uniform(3)
  /** Light through interior openings + threshold crossfade (off on the Low tier). */
  readonly softRooms = uniform(1)
  readonly cameraY = uniform(0)
  readonly focusedLevel = uniform(-1, 'int')

  // ---- shader inputs that change with the scene ----------------------------------------------
  private readonly u = {
    levelYs: uniformArray(new Array(MAX_LEVELS).fill(1e9), 'float') as N,
    levelOffsets: uniformArray(new Array(MAX_LEVELS).fill(0), 'float') as N,
    levelCount: uniform(1, 'int'),
    origin: uniform(new Vector2()),
    gridW: uniform(1, 'int'),
    gridH: uniform(1, 'int'),
    portalCount: uniform(0, 'int'),
    portalBase: uniform(0, 'int'),
    extLampStart: uniform(0, 'int'),
    extLampCount: uniform(0, 'int'),
    map: texture(emptyTexture(RedFormat)) as N,
    data: texture(emptyTexture(RGBAFormat)) as N,
  }

  /** Rebuild from a scene: rooms, lamps, portals, openings, room-id map. */
  build(input: RoomSceneInput) {
    this.rooms = []
    this.exteriorLamps = []
    this.portals = []
    this.openings = []
    this.lampTexel.clear()
    const b = input.bounds
    if (b.isEmpty()) {
      this.levelY = [0]
      this.gridW = this.gridH = this.levels = 1
      this.map = new Float32Array(1)
      this.uploadMap()
      this.allocateData()
      return
    }
    this.origin.set(b.min.x - 1, b.min.z - 1)
    this.gridW = Math.max(1, Math.ceil((b.max.x - b.min.x + 2) / CELL))
    this.gridH = Math.max(1, Math.ceil((b.max.z - b.min.z + 2) / CELL))
    this.levelY = input.levelY.length ? input.levelY.slice(0, MAX_LEVELS) : [0]
    this.levels = this.levelY.length

    // ---- rooms ---------------------------------------------------------------------------
    const raycaster = new Raycaster()
    input.configureRaycaster?.(raycaster)
    const coverObjects = input.covers.map((c) => c.object)
    const coverKind = new Map<Object3D, string>()
    for (const c of input.covers) c.object.traverse((o) => coverKind.set(o, c.kind))
    const kindOf = (o: Object3D) => {
      for (let x: Object3D | null = o; x; x = x.parent) {
        const k = coverKind.get(x)
        if (k) return k
      }
      return ''
    }
    for (const zone of input.zones) {
      const levelIndex = MathUtils.clamp(zone.levelIndex, 0, this.levels - 1)
      const floorY = this.levelY[levelIndex] ?? 0
      const nextY = this.levelY[levelIndex + 1]
      const area = Math.abs(polygonArea(zone.polygon))
      const c = polygonCentroid(zone.polygon)
      // Enclosed = something overhead (ceiling / roof / slab above). Open terraces get sky light.
      raycaster.set(new Vector3(c.x, floorY + 1.2, c.y), new Vector3(0, 1, 0))
      raycaster.far = 30
      const hits = intersectGeometry(raycaster, coverObjects, true)
      const hit = hits[0]
      const top = hits[hits.length - 1]
      const topKind = top ? kindOf(top.object) : ''
      const ceilingY = hit ? hit.point.y : nextY !== undefined ? nextY : floorY + 2.7
      this.rooms.push({
        zone,
        levelIndex,
        enclosed: !!hit,
        area,
        centroid: new Vector3(c.x, floorY, c.y),
        ceilingY,
        coverY: top ? top.point.y : ceilingY,
        coverIsRoof: topKind === 'roof' || topKind === 'slab',
        surfaces:
          2 * Math.max(area, 2) + polygonPerimeter(zone.polygon) * Math.max(2.2, ceilingY - floorY),
        lampE: 0,
        dayE: 0,
        lamps: [],
        portals: [],
      })
    }

    // ---- room-id map (levels stacked along Y of the texture) -----------------------------
    const map = new Float32Array(this.gridW * this.gridH * this.levels)
    this.rooms.forEach((room, ri) => {
      const poly = room.zone.polygon
      let minX = Number.POSITIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      for (const [x, z] of poly) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      const i0 = Math.max(0, Math.floor((minX - this.origin.x) / CELL))
      const i1 = Math.min(this.gridW - 1, Math.ceil((maxX - this.origin.x) / CELL))
      const j0 = Math.max(0, Math.floor((minZ - this.origin.y) / CELL))
      const j1 = Math.min(this.gridH - 1, Math.ceil((maxZ - this.origin.y) / CELL))
      const rowBase = room.levelIndex * this.gridH
      for (let j = j0; j <= j1; j++) {
        const z = this.origin.y + (j + 0.5) * CELL
        for (let i = i0; i <= i1; i++) {
          const x = this.origin.x + (i + 0.5) * CELL
          if (pointInPolygon(x, z, poly)) map[(rowBase + j) * this.gridW + i] = ri + 1
        }
      }
    })
    // Dilate by 2 cells into empty cells so wall-thickness gaps and polygon slop still resolve.
    for (let pass = 0; pass < 2; pass++) {
      const src = map.slice()
      for (let l = 0; l < this.levels; l++)
        for (let j = 1; j < this.gridH - 1; j++)
          for (let i = 1; i < this.gridW - 1; i++) {
            const k = (l * this.gridH + j) * this.gridW + i
            if (src[k]) continue
            const n = src[k - 1] || src[k + 1] || src[k - this.gridW] || src[k + this.gridW]
            if (n) map[k] = n
          }
    }
    this.map = map
    this.uploadMap()

    // ---- openings between rooms (soft room map) -------------------------------------------
    this.openings = this.detectOpenings(input, raycaster)

    // ---- lamps ---------------------------------------------------------------------------
    for (const lamp of input.lamps) {
      const ri = this.roomAt(lamp.position.clone().add(new Vector3(0, -0.3, 0)))
      const room = ri >= 0 ? this.rooms[ri] : undefined
      if (room?.enclosed) room.lamps.push(lamp)
      else this.exteriorLamps.push(lamp)
    }
    for (const room of this.rooms) {
      if (room.lamps.length || !room.enclosed) continue
      // Virtual lamp: one warm source just under the ceiling, sized to the room (follows the
      // time-of-day lamp default, like lamps nobody switched).
      const diag = Math.sqrt(room.area) * 1.41
      room.lamps.push({
        position: room.centroid.clone().setY(room.ceilingY - 0.35),
        color: kelvin(2900),
        intensity: Math.min(14, 4 + room.area * 0.35),
        range: Math.max(3.5, diag * 0.9),
        on: input.virtualLampsOn,
      })
    }
    // Per-room soft cap: average lamp irradiance ≈ ρ·Σ(4πI)/A_surfaces (+ multi-bounce), compressed
    // with E_t·(1 − e^(−E/E_t)) so a hall with ten chandeliers can't flood while dim rooms stay dim.
    for (const room of this.rooms) {
      const raw =
        (room.lamps.reduce((s, l) => s + 4 * Math.PI * l.intensity, 0) / room.surfaces) * 0.6
      if (raw <= 0) continue
      const soft = LAMP_E_TARGET * (1 - Math.exp(-raw / LAMP_E_TARGET))
      const k = soft / raw
      for (const l of room.lamps) l.intensity *= k
      room.lampE = soft
    }

    // ---- window portals (glass of windows and glazed doors) ---------------------------------
    for (const root of input.openings) {
      const glass: Object3D[] = []
      root.object.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh && o.userData.slotId === 'glass') glass.push(o)
      })
      if (!glass.length) continue
      // Glass box in the opening's local frame → width/height/normal independent of wall angle.
      root.object.updateWorldMatrix(true, true)
      const inv = root.object.matrixWorld.clone().invert()
      const box = new Box3()
      for (const g of glass) {
        const geometry = (
          g as unknown as { geometry: { boundingBox: Box3 | null; computeBoundingBox(): void } }
        ).geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        box.union(geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(g.matrixWorld)))
      }
      if (box.isEmpty()) continue
      const size = box.getSize(new Vector3())
      const thinAxis = size.x < size.z ? 'x' : 'z'
      const localN = new Vector3(thinAxis === 'x' ? 1 : 0, 0, thinAxis === 'z' ? 1 : 0)
      const center = box.getCenter(new Vector3()).applyMatrix4(root.object.matrixWorld)
      const n = localN.transformDirection(root.object.matrixWorld).setY(0)
      if (n.lengthSq() < 1e-6) continue
      n.normalize()
      const width = thinAxis === 'x' ? size.z : size.x
      const height = size.y
      if (width * height < 0.08) continue
      const a = this.roomAt(center.clone().addScaledVector(n, 0.45))
      const bRoom = this.roomAt(center.clone().addScaledVector(n, -0.45))
      const add = (room: number, normal: Vector3) => {
        const r = this.rooms[room]
        if (!r?.enclosed) return
        const p: Portal = { center, normal, width, height, room, kind: 0, neighbor: -1, gain: 1 }
        r.portals.push(p)
        this.portals.push(p)
      }
      if (a >= 0 && bRoom < 0) add(a, n)
      else if (bRoom >= 0 && a < 0) add(bRoom, n.clone().negate())
      else if (a >= 0 && bRoom >= 0 && a !== bRoom) {
        // Interior glazing: borrow light from an unenclosed neighbour only.
        if (!this.rooms[bRoom]!.enclosed) add(a, n)
        else if (!this.rooms[a]!.enclosed) add(bRoom, n.clone().negate())
      }
    }

    // ---- opening portals ---------------------------------------------------------------------
    const glassNear = (room: number, c: Vector3) =>
      this.rooms[room]!.portals.some((p) => p.kind === 0 && p.center.distanceTo(c) < 0.9)
    const addOpening = (
      room: number,
      normal: Vector3,
      op: Opening,
      kind: 1 | 2,
      neighbor: number,
    ) => {
      const r = this.rooms[room]!
      if (!r.enclosed) return
      if (kind === 2 && glassNear(room, op.center)) return // glazed door: already a window portal
      const p: Portal = {
        center: op.center.clone(),
        normal,
        width: op.width,
        height: op.height,
        room,
        kind,
        neighbor,
        doorId: op.doorId,
        gain: 1,
      }
      r.portals.push(p)
      this.portals.push(p)
    }
    for (const op of this.openings) {
      const A = this.rooms[op.a]!
      const B = op.b >= 0 ? this.rooms[op.b]! : null
      if (B && A.enclosed && B.enclosed) {
        addOpening(op.a, op.normal.clone().negate(), op, 1, op.b)
        addOpening(op.b, op.normal.clone(), op, 1, op.a)
      } else if (B && A.enclosed && !B.enclosed)
        addOpening(op.a, op.normal.clone().negate(), op, 2, -1)
      else if (B?.enclosed && !A.enclosed) addOpening(op.b, op.normal.clone(), op, 2, -1)
      else if (!B) addOpening(op.a, op.normal.clone().negate(), op, 2, -1)
    }

    this.allocateData()
    if (this.lastSky) this.updateSky(...this.lastSky)
  }

  /** CPU-side room lookup (same rule as the shader, without the normal offset). */
  roomAt(p: Vector3): number {
    let level = 0
    for (let i = 0; i < this.levelY.length; i++) if (this.levelY[i]! <= p.y - 0.12) level = i
    const i = Math.floor((p.x - this.origin.x) / CELL)
    const j = Math.floor((p.z - this.origin.y) / CELL)
    if (i < 0 || j < 0 || i >= this.gridW || j >= this.gridH) return -1
    const v = this.map[(level * this.gridH + j) * this.gridW + i]
    return v ? v - 1 : -1
  }

  /**
   * Whether each level is on screen. A camera over a level whose upper floors are hidden stands
   * in those floors' rooms by height alone, but it is outdoors: metered and white-balanced as
   * such, not as a lamplit room it cannot see.
   */
  levelShown: boolean[] = []

  /**
   * What the lit rooms in view add to an outside camera's meter: a blend of the exterior reading
   * and the rooms' own irradiance (their indoor meter), weighted by the share of the frame each
   * fills — fully where it is open from above (its level the top one shown), a little where only
   * its windows show — counted twice over, as the eye goes to the lit rooms. Rooms only ever
   * brighten the reading, so daytime views are unchanged. `roomsE` is the rooms' own reading (0
   * with none in view): what they meter at from inside. Given the outdoor illuminant, `illuminant`
   * is the light the eye adapts to: the outdoors shifted towards the rooms' light by their pull.
   */
  viewedMeter(
    camera: Camera,
    exteriorE: number,
    skyE: number,
    outdoor?: Color,
    skyLum = 0,
  ): { sceneE: number; roomsE: number; illuminant: Color | null } {
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_viewProj)
    const ortho = (camera as OrthographicCamera).isOrthographicCamera
    const view = ortho
      ? (() => {
          const c = camera as OrthographicCamera
          return ((c.right - c.left) * (c.top - c.bottom)) / (c.zoom * c.zoom)
        })()
      : (() => {
          const c = camera as PerspectiveCamera
          const t = Math.tan(MathUtils.degToRad(c.fov) / 2)
          return 4 * t * t * c.aspect
        })()
    let topShown = -1
    for (let i = 0; i < this.levelY.length; i++) if (this.levelShown[i] !== false) topShown = i
    let weight = 0
    let weighted = 0
    _roomsLight.setRGB(0, 0, 0)
    this.rooms.forEach((r, index) => {
      if (!r.enclosed || this.levelShown[r.levelIndex] === false) return
      if (!_frustum.containsPoint(r.centroid)) return
      _toCamera.subVectors(camera.position, r.centroid)
      const facing = Math.max(0.2, _toCamera.y / Math.max(_toCamera.length(), 1e-4))
      const reach = ortho ? 1 : Math.max(_toCamera.lengthSq(), 1)
      const open = r.levelIndex === topShown ? 1 : 0.15
      const w = (r.area * facing * open) / reach / view
      const E = this.meter(index, skyE)
      weight += w
      weighted += w * E
      if (!outdoor) return
      const light = this.roomIlluminant(index, outdoor, skyLum)
      const L = light ? luminance(light) : 0
      // Each room's light colour (unit luminance), as much as it outshines the exterior.
      if (light && L > 1e-6)
        _roomsLight.add(light.multiplyScalar((w * Math.max(0, E - exteriorE)) / L))
    })
    if (weight <= 0) return { sceneE: exteriorE, roomsE: 0, illuminant: null }
    const roomsE = weighted / weight
    const share = Math.min(1, weight * 2)
    const sceneE = Math.max(exteriorE, (1 - share) * exteriorE + share * roomsE)
    let illuminant: Color | null = null
    const roomsL = luminance(_roomsLight)
    const outdoorL = outdoor ? luminance(outdoor) : 0
    if (outdoor && roomsL > 1e-6 && outdoorL > 1e-6) {
      // The rooms' pull: their part of the reading above the exterior's.
      const pull = MathUtils.clamp((sceneE - exteriorE) / Math.max(sceneE, 1e-6), 0, 1)
      illuminant = outdoor
        .clone()
        .multiplyScalar(1 / outdoorL)
        .lerp(_roomsLight.multiplyScalar(1 / roomsL), pull)
    }
    return { sceneE, roomsE, illuminant }
  }

  isEnclosedAt(p: Vector3): { room: number; inside: boolean } {
    let level = 0
    for (let i = 0; i < this.levelY.length; i++) if (this.levelY[i]! <= p.y - 0.12) level = i
    if (this.levelShown[level] === false) return { room: -1, inside: false }
    const room = this.roomAt(p)
    const r = room >= 0 ? this.rooms[room] : undefined
    return { room, inside: !!r?.enclosed && p.y < r.ceilingY }
  }

  /** Explode / level motion: live world Y of each level (assembled + offset). */
  setLevelOffsets(offsets: number[]) {
    const ys = this.u.levelYs.array as number[]
    const offs = this.u.levelOffsets.array as number[]
    for (let i = 0; i < MAX_LEVELS; i++) {
      const base = this.levelY[i]
      const off = offsets[i] ?? 0
      ys[i] = base === undefined ? 1e9 : base + off
      offs[i] = off
    }
  }

  /** Re-run the light transfer (after a quality-tier change of the soft room map). */
  refresh() {
    if (this.lastSky) this.updateSky(...this.lastSky)
  }

  /** Lamp switches changed: rewrite lamp texels (+ the light carried through openings). */
  setLampStates(isOn: (lamp: RoomLamp) => boolean): boolean {
    let dirty = false
    for (const l of this.lampTexel.keys()) {
      const on = isOn(l)
      if (on === l.on) continue
      l.on = on
      this.writeLamp(l)
      dirty = true
    }
    if (dirty) {
      this.writeInteriorPortals()
      this.markData()
    }
    return dirty
  }

  /** Door openness (0 closed … 1 open) → portal gain; a closed interior door leaves a crack. */
  updateDoors(openness: (doorId: string) => number) {
    let dirty = false
    this.portals.forEach((p, k) => {
      if (!p.doorId) return
      const open = MathUtils.clamp(openness(p.doorId), 0, 1)
      const gain = p.kind === 1 ? Math.max(0.06, open) : open
      if (Math.abs(gain - p.gain) < 0.01) return
      p.gain = gain
      this.data[(this.portalBase + k * PSTRIDE + 3) * 4 + 2] = gain
      dirty = true
    })
    if (dirty) {
      this.markData()
      if (this.lastSky) this.updateSky(...this.lastSky) // exterior doors feed the bounce too
    }
  }

  /** 0…1: share of the room's lamp power currently lit. */
  lampFraction(room: number) {
    const r = this.rooms[room]
    if (!r) return 0
    let all = 0
    let lit = 0
    for (const l of r.lamps) {
      all += l.intensity
      lit += l.on ? l.intensity : 0
    }
    return all > 0 ? lit / all : 0
  }

  /**
   * Analytic light meter: the average irradiance a camera standing in `room` would see —
   * daylight (portals + bounce, scaled like the shader's gains) + lamps + leftover sky IBL.
   */
  meter(room: number, skyE: number) {
    const r = this.rooms[room]
    if (!r) return skyE
    const portalW = this.portalGain.value as number
    return (
      r.dayE * (0.5 * portalW + 0.5 * (this.bounceGain.value as number)) +
      r.lampE * this.lampFraction(room) * (this.lampGain.value as number) +
      skyE * (this.indoorEnv.value as number)
    )
  }

  /** The illuminant colour inside `room` (daylight through the windows + its lit lamps). */
  roomIlluminant(room: number, outdoor: Color, skyLum: number): Color | null {
    const r = this.rooms[room]
    if (!r) return null
    const lampCol = new Color(0, 0, 0)
    for (const l of r.lamps) if (l.on) lampCol.add(l.color.clone().multiplyScalar(l.intensity))
    const lampLum = luminance(lampCol)
    const lampE = r.lampE * this.lampFraction(room) * (this.lampGain.value as number)
    const dayE = r.dayE * (this.portalGain.value as number)
    const outLum = Math.max(luminance(outdoor), 1e-5)
    return new Color(0, 0, 0)
      .add(
        outdoor.clone().multiplyScalar((dayE + (this.indoorEnv.value as number) * skyLum) / outLum),
      )
      .add(lampLum > 0 ? lampCol.multiplyScalar(lampE / lampLum) : new Color(0, 0, 0))
  }

  /**
   * Per sun/sky change: radiance leaving each portal into the room, and the per-room sun
   * bounce (sun patch on the floor re-radiating — the main thing screen-space GI misses).
   * `skyRadiance(dir)` returns linear sky radiance seen *through* the window (outward dir).
   */
  updateSky(skyRadiance: SkySampler, sunDir: Vector3, sunColor: Color, sunIrradiance: number) {
    this.lastSky = [skyRadiance, sunDir.clone(), sunColor.clone(), sunIrradiance]
    const groundAlbedo = 0.3
    const glassT = 0.8
    const skyUp = skyRadiance(new Vector3(0, 1, 0))
    // Ground seen through the window: sunlit + skylit grass/paving, warm-ish.
    const groundL = sunColor
      .clone()
      .multiplyScalar((sunIrradiance * Math.max(sunDir.y, 0)) / Math.PI)
      .add(skyUp.clone().multiplyScalar(0.8))
      .multiplyScalar(groundAlbedo)
      .multiply(new Color(1.0, 0.95, 0.85))
    const portalL: Color[] = []
    this.portals.forEach((p, k) => {
      if (p.kind === 1) {
        portalL.push(new Color(0, 0, 0)) // filled below from the neighbour's meter
        return
      }
      const out = p.normal.clone().negate()
      const up = skyRadiance(out.clone().setY(0.5).normalize())
      const hz = skyRadiance(out.clone().setY(0.08).normalize())
      // A vertical window sees ~half sky, ~half ground. Open doorways have no glass.
      const rad = up
        .multiplyScalar(0.3)
        .add(hz.multiplyScalar(0.25))
        .add(groundL.clone().multiplyScalar(0.45))
        .multiplyScalar(p.kind === 0 ? glassT : 1)
      portalL.push(rad)
      this.set(this.portalBase + k * PSTRIDE + 2, rad.r, rad.g, rad.b, p.neighbor)
    })
    // BRE split-flux internally reflected component: flux entering through the room's
    // windows (sky + direct sun), spread over all interior surfaces with multi-bounce gain:
    //   E_irc = Φ·ρ / (A_surfaces·(1 − ρ))
    const rho = 0.5
    const interiorTint = new Color(1.0, 0.93, 0.84) // white walls + wood/textile floors
    const soft = this.softRooms.value as number
    this.rooms.forEach((r, i) => {
      const flux = new Color(0, 0, 0)
      for (const p of r.portals) {
        if (p.kind === 1) continue
        const A = p.width * p.height * (p.kind === 2 ? p.gain * soft : 1)
        const k = this.portals.indexOf(p)
        flux.add(portalL[k]!.clone().multiplyScalar(Math.PI * A))
        const cos = Math.max(0, -p.normal.dot(sunDir))
        if (sunDir.y > 0)
          flux.add(
            sunColor.clone().multiplyScalar(sunIrradiance * cos * A * (p.kind === 0 ? glassT : 1)),
          )
      }
      // Daylight meter for this room: direct flux spread over its surfaces + the multi-bounce part.
      r.dayE = ((flux.r + flux.g + flux.b) / 3 / r.surfaces) * (1 + rho / (1 - rho))
      const e = flux.multiplyScalar(rho / (r.surfaces * (1 - rho))).multiply(interiorTint)
      this.set(i * 3 + 1, r.portals.length, e.r, e.g, e.b)
    })
    this.writeInteriorPortals()
    this.markData()
  }

  // ---- data texture --------------------------------------------------------------------------
  // rooms:   [enclosed, lampStart, lampCount, portalStart] [portalCount, bounce.rgb] [coverY, roof, level, 0]
  // lamps:   [pos.xyz, range] [rgb·intensity·on, cosInner] (+ exterior: [spot dir.xyz, cosOuter])
  // portals: [center.xyz, halfW] [normal.xyz, halfH] [radiance.rgb, neighbour] [floorY, mainLamp, gain, kind]
  private portalBase = 0

  private allocateData() {
    const nRoomLamps = this.rooms.reduce((s, r) => s + r.lamps.length, 0)
    const nLamps = nRoomLamps + this.exteriorLamps.length
    const texels =
      this.rooms.length * 3 +
      nLamps * 2 +
      this.exteriorLamps.length +
      this.portals.length * PSTRIDE +
      4
    const rows = Math.max(1, Math.ceil(texels / DATA_W))
    this.data = new Float32Array(DATA_W * rows * 4)
    const lampBase = this.rooms.length * 3
    this.portalBase = lampBase + nLamps * 2 + this.exteriorLamps.length
    let lamp = 0
    this.rooms.forEach((r, i) => {
      this.set(i * 3, r.enclosed ? 1 : 0, lampBase + lamp * 2, r.lamps.length, 0)
      this.set(i * 3 + 1, r.portals.length, 0, 0, 0)
      this.set(i * 3 + 2, r.coverY, r.coverIsRoof ? 1 : 0, r.levelIndex, 0)
      for (const l of r.lamps) {
        this.lampTexel.set(l, lampBase + lamp * 2)
        this.set(lampBase + lamp * 2, l.position.x, l.position.y, l.position.z, l.range)
        this.writeLamp(l)
        lamp++
      }
    })
    // Exterior lamps after the room lamps — evaluated analytically on outside surfaces.
    const extLampStart = lampBase + lamp * 2
    this.exteriorLamps.forEach((l, i) => {
      const texel = extLampStart + i * EXT_STRIDE
      this.lampTexel.set(l, texel)
      this.set(texel, l.position.x, l.position.y, l.position.z, Math.max(6, l.range))
      this.writeLamp(l)
      // Omni lamps: a cone that takes everything (cos ≥ −1 > −2).
      const spot = l.spot
      if (spot)
        this.set(texel + 2, spot.direction.x, spot.direction.y, spot.direction.z, spot.cosOuter)
      else this.set(texel + 2, 0, -1, 0, -2)
    })
    // Every room's portals contiguous.
    this.portals = this.rooms.flatMap((r) => r.portals)
    let ps = 0
    this.rooms.forEach((r, i) => {
      this.data[i * 3 * 4 + 3] = this.portalBase + ps * PSTRIDE
      ps += r.portals.length
    })
    this.portals.forEach((p, k) => {
      const t = this.portalBase + k * PSTRIDE
      this.set(t, p.center.x, p.center.y, p.center.z, p.width / 2)
      this.set(t + 1, p.normal.x, p.normal.y, p.normal.z, p.height / 2)
      const room = this.rooms[p.room]!
      const main = room.lamps.slice().sort((a, b) => b.intensity - a.intensity)[0]
      this.set(t + 2, 0, 0, 0, p.neighbor)
      this.set(
        t + 3,
        this.levelY[room.levelIndex] ?? 0,
        main ? this.lampTexel.get(main)! : -1,
        p.gain,
        p.kind,
      )
    })
    const previous = this.u.data.value as DataTexture
    const tex = new DataTexture(this.data, DATA_W, rows, RGBAFormat, FloatType)
    tex.magFilter = tex.minFilter = NearestFilter
    tex.needsUpdate = true
    this.u.data.value = tex
    previous.dispose()
    this.u.portalCount.value = this.portals.length
    this.u.portalBase.value = this.portalBase
    this.u.extLampStart.value = extLampStart
    this.u.extLampCount.value = this.exteriorLamps.length
  }

  private uploadMap() {
    const previous = this.u.map.value as DataTexture
    const tex = new DataTexture(
      this.map,
      this.gridW,
      this.gridH * this.levels,
      RedFormat,
      FloatType,
    )
    tex.magFilter = tex.minFilter = NearestFilter
    tex.needsUpdate = true
    this.u.map.value = tex
    previous.dispose()
    ;(this.u.origin.value as Vector2).copy(this.origin)
    this.u.gridW.value = this.gridW
    this.u.gridH.value = this.gridH
    this.u.levelCount.value = this.levels
    this.setLevelOffsets([])
  }

  private markData() {
    ;(this.u.data.value as DataTexture).needsUpdate = true
  }

  private writeLamp(l: RoomLamp) {
    const exterior = l.candela !== undefined && this.exteriorLamps.includes(l)
    const k = (l.on ? 1 : 0) * (exterior ? Math.min(l.candela!, l.intensity) : l.intensity)
    const cosInner = l.spot ? l.spot.cosInner : -1
    this.set(this.lampTexel.get(l)! + 1, l.color.r * k, l.color.g * k, l.color.b * k, cosInner)
  }

  /** Interior portals emit the neighbour room's average radiance: L = E_avg·ρ/π (lamps + daylight). */
  private writeInteriorPortals() {
    const lampGain = this.lampGain.value as number
    this.portals.forEach((p, k) => {
      if (p.kind !== 1) return
      const nb = this.rooms[p.neighbor]!
      const lampCol = new Color(0, 0, 0)
      let full = 0
      for (const l of nb.lamps) {
        lampCol.add(l.color.clone().multiplyScalar(l.on ? l.intensity : 0))
        full += l.intensity * ((l.color.r + l.color.g + l.color.b) / 3)
      }
      const L = lampCol.multiplyScalar((nb.lampE * lampGain) / Math.max(1e-4, full))
      L.add(new Color(1.0, 0.95, 0.88).multiplyScalar(nb.dayE))
      L.multiplyScalar(0.5 / Math.PI)
      this.set(this.portalBase + k * PSTRIDE + 2, L.r, L.g, L.b, p.neighbor)
    })
  }

  private set(texel: number, a: number, b: number, c: number, d: number) {
    this.data.set([a, b, c, d], texel * 4)
  }

  /**
   * Walk every boundary between two room cells (or a room and outside) on the room map and cast
   * short horizontal rays against the walls at 0.35 m and 1.6 m: open at both heights = a walkable
   * opening (doorway, arch, open-plan edge). Windows don't count (sills are above 0.35 m).
   */
  private detectOpenings(input: RoomSceneInput, ray: Raycaster): Opening[] {
    const doors = input.openings
      .filter((o) => o.kind === 'door')
      .map((o) => ({ id: o.id, box: new Box3().setFromObject(o.object) }))
    const doorHoles = doors.map((door) => door.box.clone().expandByScalar(0.05))
    ray.far = 0.9
    const samples = new Map<
      string,
      { a: number; b: number; axis: 'x' | 'z'; dir: number; pts: Vector3[]; level: number }
    >()
    const W = this.gridW
    const H = this.gridH
    const map = this.map
    const v = new Vector3()
    const dirV = new Vector3()
    for (let l = 0; l < this.levels; l++) {
      const floorY = this.levelY[l] ?? 0
      for (let j = 0; j < H - 1; j++) {
        for (let i = 0; i < W - 1; i++) {
          const k = (l * H + j) * W + i
          const A = map[k]!
          for (const [di, dj, axis] of [
            [1, 0, 'x'],
            [0, 1, 'z'],
          ] as const) {
            if ((axis === 'x' ? j : i) % 2) continue // sample every 2nd cell along the edge (0.2 m)
            const B = map[k + di + dj * W]!
            if (A === B || (!A && !B)) continue
            const a = A ? A - 1 : -1
            const b = B ? B - 1 : -1
            // Outside openings only from enclosed rooms.
            if (a < 0 && !this.rooms[b]!.enclosed) continue
            if (b < 0 && !this.rooms[a]!.enclosed) continue
            const x = this.origin.x + (i + 0.5 + di * 0.5) * CELL
            const z = this.origin.y + (j + 0.5 + dj * 0.5) * CELL
            dirV.set(di, 0, dj)
            let open = true
            for (const h of [0.35, 1.6]) {
              v.set(x, floorY + h, z).addScaledVector(dirV, -0.45)
              ray.set(v, dirV)
              // A doorway is open whatever wall-attached geometry crosses it (finishes, trims).
              const blocked = intersectGeometry(ray, input.walls, false).some(
                (hit) => !doorHoles.some((hole) => hole.containsPoint(hit.point)),
              )
              if (blocked) {
                open = false
                break
              }
            }
            if (!open) continue
            // Normalise so key/direction are from the lower room id (outside = last).
            const lo = a < 0 ? b : b < 0 ? a : Math.min(a, b)
            const hi = lo === a ? b : a
            const dir = lo === a ? 1 : -1
            const key = `${l}|${lo}|${hi}|${axis}`
            let s = samples.get(key)
            if (!s) {
              s = { a: lo, b: hi, axis, dir, pts: [], level: l }
              samples.set(key, s)
            }
            s.pts.push(new Vector3(x, floorY, z))
          }
        }
      }
    }
    const openings: Opening[] = []
    for (const s of samples.values()) {
      // Cluster along the edge: sort by the coordinate running along the boundary.
      const along = (p: Vector3) => (s.axis === 'x' ? p.z : p.x)
      const across = (p: Vector3) => (s.axis === 'x' ? p.x : p.z)
      s.pts.sort((p, q) => across(p) - across(q) || along(p) - along(q))
      let run: Vector3[] = []
      const flush = () => {
        if (run.length < 3) {
          run = [] // < 0.5 m
          return
        }
        const c = run.reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / run.length)
        const width = along(run[run.length - 1]!) - along(run[0]!) + 0.2
        const normal = new Vector3(s.axis === 'x' ? s.dir : 0, 0, s.axis === 'z' ? s.dir : 0)
        const roomA = this.rooms[s.a]!
        const roomB = s.b >= 0 ? this.rooms[s.b] : undefined
        const floorY = this.levelY[s.level] ?? 0
        // Door in this opening? → its height + state. Otherwise floor to the lower ceiling.
        const door = doors.find((d) =>
          d.box
            .clone()
            .expandByScalar(0.25)
            .containsPoint(c.clone().setY(floorY + 1)),
        )
        const ceil = Math.min(roomA.ceilingY, roomB?.ceilingY ?? roomA.ceilingY)
        const height = door
          ? Math.min(door.box.max.y - floorY, ceil - floorY)
          : Math.max(1.9, ceil - floorY)
        openings.push({
          a: s.a,
          b: s.b,
          center: c.setY(floorY + height / 2),
          normal,
          width: door ? Math.min(width, door.box.getSize(new Vector3()).length()) : width,
          height,
          doorId: door?.id,
        })
        run = []
      }
      for (const p of s.pts) {
        const last = run[run.length - 1]
        if (last && (Math.abs(across(p) - across(last)) > 0.11 || along(p) - along(last) > 0.45))
          flush()
        run.push(p)
      }
      flush()
    }
    return openings
  }

  // ---- TSL ---------------------------------------------------------------------------------

  /** Level index for a world-space height (live, explode-offset level heights). */
  private levelOfNode(y: N) {
    const level = int(0).toVar()
    Loop({ start: int(1), end: this.u.levelCount, type: 'int', condition: '<' }, ({ i }: N) => {
      If(this.u.levelYs.element(i).lessThanEqual(y.sub(0.12)), () => {
        level.assign(i)
      })
    })
    return level
  }

  /** Room index (−1 outside) at a world-space position. */
  roomAtNode = Fn(([p]: [N]) => {
    const u = this.u
    const level = this.levelOfNode(p.y)
    const cell = ivec2(p.xz.sub(u.origin).div(CELL).floor())
    const inside = cell.x
      .greaterThanEqual(0)
      .and(cell.y.greaterThanEqual(0))
      .and(cell.x.lessThan(u.gridW))
      .and(cell.y.lessThan(u.gridH))
    const safe = ivec2(
      (clamp as N)(cell.x, int(0), u.gridW.sub(1)),
      (clamp as N)(cell.y, int(0), u.gridH.sub(1)),
    )
    const id = u.map.load(ivec2(safe.x, safe.y.add(level.mul(u.gridH)))).r
    return select(inside, int(id).sub(1), int(-1))
  })

  /** E' = Emax·(1 − e^(−E/Emax)), on luminance, hue kept — near-field hot spots compress, never blow out. */
  private softClampLamps(e: N): N {
    const L = dot(e, vec3(0.2126, 0.7152, 0.0722)).max(1e-5)
    const Lc = this.lampMaxE.mul(float(1).sub(L.div(this.lampMaxE).negate().exp()))
    return e.mul(Lc.div(L))
  }

  private texel(i: N): N {
    const idx = int(i)
    return this.u.data.load(ivec2(idx.mod(DATA_W), idx.div(DATA_W)))
  }

  /**
   * vec4(irradiance, enclosure):
   *  irradiance — lamp + portal + bounce diffuse irradiance (linear)
   *  enclosure  — multiplier for the sky IBL (1 outdoors, `indoorEnv` in enclosed rooms)
   */
  lightingNode = Fn(() => {
    const probe = positionWorld.add(normalWorld.mul(0.18))
    const room = this.roomAtNode(probe).toVar()
    // Shade in assembled space so exploded floors stay lit exactly as when stacked.
    const assembled = positionWorld.sub(
      vec3(0, this.u.levelOffsets.element(this.levelOfNode(probe.y)), 0),
    )
    const irr = vec3(0).toVar()
    const enclosure = float(1).toVar()
    If(room.greaterThanEqual(0), () => {
      const h0 = this.texel(room.mul(3))
      const h1 = this.texel(room.mul(3).add(1))
      const h2 = this.texel(room.mul(3).add(2))
      // Dollhouse / roofless views: a room whose topmost cover is a ceiling (hidden from above)
      // and the camera is above it — or whose level is focused — is open to the sky.
      const seenFromAbove = h2.y.lessThan(0.5).and(this.cameraY.greaterThan(h2.x))
      const focused = this.focusedLevel.greaterThanEqual(0).and(int(h2.z).equal(this.focusedLevel))
      If(h0.x.greaterThan(0.5).and(seenFromAbove.or(focused).not()), () => {
        enclosure.assign(this.indoorEnv)
      })
      const P = assembled
      const Nw = normalWorld
      // Lamps: smooth windowed inverse-square, wrapped diffuse so the room reads as filled
      // rather than spotlit — stands in for the bounce we don't compute.
      const lampIrr = vec3(0).toVar()
      Loop({ start: int(0), end: int(h0.z), type: 'int', condition: '<' }, ({ i }: N) => {
        const a = this.texel(int(h0.y).add(i.mul(2)))
        const c = this.texel(int(h0.y).add(i.mul(2)).add(1))
        const L = a.xyz.sub(P)
        const d2 = dot(L, L)
        const d = d2.sqrt()
        const win = clamp(float(1).sub(d.div(a.w).pow(4)), 0, 1).pow(2)
        const atten = win.div(max(d2, LAMP_MIN_D2))
        const wrap = max(dot(Nw, L.div(d)).mul(0.6).add(0.4), 0)
        lampIrr.addAssign(c.xyz.mul(atten).mul(wrap))
      })
      lampIrr.assign(this.softClampLamps(lampIrr))
      irr.addAssign(lampIrr.mul(this.lampGain).mul(this.lampView))

      // Window portals: Lambertian rectangle, approximated as a disk of equal area
      // E = L·A·cosθe·cosθr / (π·d² + A) — finite at the glass, physically-shaped falloff.
      const portalIrr = vec3(0).toVar()
      const patchIrr = vec3(0).toVar()
      const fade = vec3(0).toVar()
      const fadeEnc = float(0).toVar()
      Loop({ start: int(0), end: int(h1.x), type: 'int', condition: '<' }, ({ i }: N) => {
        const base = int(h0.w).add(i.mul(PSTRIDE))
        const a = this.texel(base)
        const b = this.texel(base.add(1))
        const c = this.texel(base.add(2))
        const m = this.texel(base.add(3))
        const isWindow = m.w.lessThan(0.5)
        const isInterior = m.w.greaterThan(0.5).and(m.w.lessThan(1.5))
        // Openings (kind 1/2) belong to the soft room map; door state lives in m.z.
        const gain = m.z.mul(select(isWindow, float(1), this.softRooms))
        const toP = P.sub(a.xyz)
        // Clamp the sample point onto the window rectangle → wide windows light wide areas.
        const right = normalize(vec3(b.z.negate(), 0, b.x))
        const along = clamp(dot(toP, right), a.w.negate(), a.w)
        const up = clamp(toP.y, b.w.negate(), b.w)
        const q = a.xyz.add(right.mul(along)).add(vec3(0, up, 0))
        const v = P.sub(q)
        const d2 = max(dot(v, v), 1e-4)
        const dir = v.div(d2.sqrt())
        const cosE = max(dot(b.xyz, dir), 0)
        const cosR = max(dot(Nw, dir.negate()).mul(0.8).add(0.2), 0)
        const A = a.w.mul(b.w).mul(4)
        portalIrr.addAssign(c.xyz.mul(A).mul(cosE).mul(cosR).div(d2.mul(Math.PI).add(A)).mul(gain))
        // Threshold crossfade: within 0.6 m of an interior opening, room-wide terms fade towards
        // the neighbour's — w = ½·(1−t)/(1+t).
        const dp = dot(P.sub(a.xyz), b.xyz)
        const lateral = abs(dot(P.sub(a.xyz), right)).sub(a.w)
        const vertical = abs(P.y.sub(a.y)).sub(b.w)
        const t = clamp(dp.div(0.6), 0, 1)
        const w = float(0.5)
          .mul(float(1).sub(t))
          .div(float(1).add(t))
          .mul(smoothstep(0.3, 0.0, lateral))
          .mul(smoothstep(0.3, 0.0, vertical))
          .mul(float(1).sub(abs(dot(Nw, b.xyz)).mul(0.5)))
          .mul(
            select(
              isInterior.and(dp.greaterThan(-0.05)).and(dp.lessThan(0.6)),
              m.z.mul(this.softRooms),
              float(0),
            ),
          )
        If(w.greaterThan(0.001), () => {
          const nb = int(c.w)
          const g0 = this.texel(nb.mul(3))
          const g1 = this.texel(nb.mul(3).add(1))
          const nbLamps = vec3(0).toVar()
          Loop({ start: int(0), end: int(g0.z), type: 'int', condition: '<' }, ({ i: j }: N) => {
            const la = this.texel(int(g0.y).add(j.mul(2)))
            const lc = this.texel(int(g0.y).add(j.mul(2)).add(1))
            const L = la.xyz.sub(P)
            const ld2 = dot(L, L)
            const ld = ld2.sqrt()
            const lwin = clamp(float(1).sub(ld.div(la.w).pow(4)), 0, 1).pow(2)
            nbLamps.addAssign(
              lc.xyz
                .mul(lwin.div(max(ld2, LAMP_MIN_D2)))
                .mul(max(dot(Nw, L.div(ld)).mul(0.6).add(0.4), 0)),
            )
          })
          const lamps = this.lampGain.mul(this.lampView)
          const mine = lampIrr.mul(lamps).add(h1.yzw.mul(this.bounceGain))
          const theirs = nbLamps.mul(lamps).add(g1.yzw.mul(this.bounceGain))
          fade.addAssign(theirs.sub(mine).mul(w))
          fadeEnc.addAssign(
            select(g0.x.greaterThan(0.5), this.indoorEnv, float(1)).sub(enclosure).mul(w),
          )
        })
        // Sky patch: the window shape projected onto the room from a virtual sky source up and
        // out from the window (wide penumbra) — the soft light rectangle on the floor/wall that
        // shaded façades still get on a bright day.
        const S = a.xyz.sub(b.xyz.mul(2.2)).add(vec3(0, b.w.mul(2).add(1.6), 0))
        const dS = P.sub(S)
        const den = dot(dS, b.xyz)
        const tS = dot(a.xyz.sub(S), b.xyz).div(den)
        const X = S.add(dS.mul(tS))
        const softS = float(0.22)
        const inS = smoothstep(a.w.add(softS), a.w.sub(softS), abs(dot(X.sub(a.xyz), right))).mul(
          smoothstep(b.w.add(softS), b.w.sub(softS), abs(X.y.sub(a.y))),
        )
        const okS = den.greaterThan(0).and(tS.lessThan(1)).and(tS.greaterThan(0))
        const ds2 = max(dot(dS, dS), 0.25)
        const cosS = max(dot(Nw, dS.negate().div(ds2.sqrt())), 0)
        patchIrr.addAssign(
          select(okS.and(isWindow), c.xyz.mul(inS).mul(cosS).mul(A).div(ds2), vec3(0)),
        )
      })
      irr.addAssign(fade)
      enclosure.addAssign(fadeEnc)
      irr.addAssign(patchIrr.mul(this.skyPatch).mul(this.portalGain).mul(Math.PI))
      irr.addAssign(portalIrr.mul(this.portalGain).mul(Math.PI))
      // Internally reflected component: near-uniform fill; ceilings catch a bit more (light
      // arrives mostly from the sunlit floor), floors a bit less.
      irr.addAssign(h1.yzw.mul(this.bounceGain).mul(Nw.y.mul(-0.2).add(1)))
    })
    return vec4(irr, enclosure)
  })

  /**
   * Light thrown *out* of lit rooms through their windows onto exterior surfaces (ground,
   * terraces, balconies, reveals). Two terms per exterior portal:
   *  - gobo: the room's main lamp projected through the window rectangle — the crisp,
   *    window-shaped pool on a lawn at night (exact for an unoccluded point lamp)
   *  - glow: the pane as a soft area emitter (lamp-lit room radiance), for the halo
   * Receivers below the window's storey floor − 0.18 m get nothing, so upper windows can't
   * project through slabs onto the ground.
   */
  exteriorSpillNode = Fn(([P, Nw]: [N, N]) => {
    const total = vec3(0).toVar()
    Loop({ start: int(0), end: this.u.portalCount, type: 'int', condition: '<' }, ({ i }: N) => {
      const base = this.u.portalBase.add(i.mul(PSTRIDE))
      const a = this.texel(base)
      const b = this.texel(base.add(1))
      const m = this.texel(base.add(3))
      const isInterior = m.w.greaterThan(0.5).and(m.w.lessThan(1.5))
      const gain = m.z.mul(select(m.w.lessThan(0.5), float(1), this.softRooms))
      If(
        P.y
          .greaterThan(m.x.sub(0.18))
          .and(m.y.greaterThanEqual(0))
          .and(isInterior.not())
          .and(gain.greaterThan(0.01)),
        () => {
          const lampPos = this.texel(int(m.y)).xyz
          const lampCol = this.texel(int(m.y).add(1)).xyz
          const out = b.xyz.negate()
          const right = normalize(vec3(b.z.negate(), 0, b.x))
          // gobo: intersect lamp→P with the window plane
          const d = P.sub(lampPos)
          const denom = dot(d, out)
          const t = dot(a.xyz.sub(lampPos), out).div(denom)
          const X = lampPos.add(d.mul(t))
          const lx = abs(dot(X.sub(a.xyz), right))
          const ly = abs(X.y.sub(a.y))
          const soft = float(0.06)
          const inRect = smoothstep(a.w.add(soft), a.w.sub(soft), lx).mul(
            smoothstep(b.w.add(soft), b.w.sub(soft), ly),
          )
          const valid = denom.greaterThan(0).and(t.lessThan(1)).and(t.greaterThan(0))
          const d2 = max(dot(d, d), 0.04)
          const cosR = max(dot(Nw, d.negate().div(d2.sqrt())), 0)
          const gobo = select(valid, inRect.mul(cosR).div(d2), float(0))
          // glow: pane as a soft emitter
          const toP = P.sub(a.xyz)
          const q = a.xyz
            .add(right.mul(clamp(dot(toP, right), a.w.negate(), a.w)))
            .add(vec3(0, clamp(toP.y, b.w.negate(), b.w), 0))
          const v = P.sub(q)
          const e2 = max(dot(v, v), 1e-3)
          const dir = v.div(e2.sqrt())
          const A = a.w.mul(b.w).mul(4)
          const glow = max(dot(out, dir), 0)
            .mul(max(dot(Nw, dir.negate()), 0))
            .mul(A)
            .div(e2.mul(Math.PI).add(A))
          total.addAssign(lampCol.mul(gobo.mul(1.4).add(glow.mul(0.35))).mul(gain))
        },
      )
    })
    return total.mul(this.lampGain).mul(this.lampView).mul(this.spillGain)
  })

  /**
   * Exterior lamps (lanterns, bollards, garden lights) as sized sources with the same falloff and
   * soft clamp as room lamps — no hot spots a bollard's height from the paving. Applied to
   * outside surfaces only.
   */
  exteriorLampsNode = Fn(([P, Nw]: [N, N]) => {
    const out = vec3(0).toVar()
    Loop({ start: int(0), end: this.u.extLampCount, type: 'int', condition: '<' }, ({ i }: N) => {
      const base = this.u.extLampStart.add(i.mul(EXT_STRIDE))
      const a = this.texel(base)
      const c = this.texel(base.add(1))
      const s = this.texel(base.add(2))
      const L = a.xyz.sub(P)
      const d2 = dot(L, L)
      const d = d2.sqrt()
      const win = clamp(float(1).sub(d.div(a.w).pow(4)), 0, 1).pow(2)
      // Spotlights keep their cone (soft edge = the penumbra); omni lamps pass everywhere.
      const cone = smoothstep(s.w, c.w, dot(L.div(d).negate(), s.xyz))
      // Spots shade plainly (N·L), as the scene's lights do: a sconce's own wall, edge-on and
      // close, stays nearly dark. Omni lamps keep a little wrap for the bounce they'd bring.
      const wrap = select(s.w.lessThan(-1.5), float(0.25), float(0))
      const facing = dot(Nw, L.div(d)).mul(float(1).sub(wrap)).add(wrap)
      out.addAssign(
        c.xyz
          .mul(win.div(max(d2, LAMP_MIN_D2)))
          .mul(max(facing, 0))
          .mul(cone),
      )
    })
    return this.softClampLamps(out).mul(this.lampGain).mul(this.lampView)
  })

  /** 1 where exterior lights may shine (outside, or rooms open to the sky), 0 inside. */
  exteriorMaskNode = Fn(() => {
    const room = this.roomAtNode(positionWorld.add(normalWorld.mul(0.18))).toVar()
    const mask = float(1).toVar()
    If(room.greaterThanEqual(0), () => {
      const h0 = this.texel(room.mul(3))
      const h2 = this.texel(room.mul(3).add(2))
      const seenFromAbove = h2.y.lessThan(0.5).and(this.cameraY.greaterThan(h2.x))
      const focused = this.focusedLevel.greaterThanEqual(0).and(int(h2.z).equal(this.focusedLevel))
      If(h0.x.greaterThan(0.5).and(seenFromAbove.or(focused).not()), () => {
        mask.assign(0)
      })
    })
    return mask
  })

  /** Linear lamp radiance of a room (its lit lamps) — the night tint of its window panes. */
  roomGlowNode = Fn(([room]: [N]) => {
    const glow = vec3(0).toVar()
    If(room.greaterThanEqual(0), () => {
      const h0 = this.texel(room.mul(3))
      Loop({ start: int(0), end: int(h0.z), type: 'int', condition: '<' }, ({ i }: N) => {
        glow.addAssign(this.texel(int(h0.y).add(i.mul(2)).add(1)).xyz)
      })
    })
    return glow.div(glow.dot(vec3(0.33)).max(1))
  })
}

// ---- helpers -------------------------------------------------------------------------------

/**
 * Ray hits against the meshes' geometry itself, nearest first. Picking overrides (walls hidden
 * by the cutaway, ceiling caps, batched originals) mustn't open rooms to the sky or invent
 * doorways, so the meshes' own `raycast` is bypassed.
 */
function intersectGeometry(ray: Raycaster, objects: Object3D[], recursive: boolean) {
  const hits: Intersection[] = []
  const visit = (object: Object3D) => {
    if ((object as Mesh).isMesh) Mesh.prototype.raycast.call(object as Mesh, ray, hits)
    if (recursive) for (const child of object.children) visit(child)
  }
  for (const object of objects) visit(object)
  return hits.sort((a, b) => a.distance - b.distance)
}

function emptyTexture(format: typeof RedFormat | typeof RGBAFormat): DataTexture {
  const tex = new DataTexture(
    new Float32Array(format === RedFormat ? 1 : 4),
    1,
    1,
    format,
    FloatType,
  )
  tex.magFilter = tex.minFilter = NearestFilter
  tex.needsUpdate = true
  return tex
}

const luminance = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

export function pointInPolygon(x: number, z: number, poly: [number, number][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!
    const [xj, zj] = poly[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function polygonPerimeter(poly: [number, number][]) {
  let p = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    p += Math.hypot(poly[i]![0] - poly[j]![0], poly[i]![1] - poly[j]![1])
  return p
}

export function polygonArea(poly: [number, number][]) {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1])
  return a / 2
}

export function polygonCentroid(poly: [number, number][]) {
  let cx = 0
  let cz = 0
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1]
    cx += (poly[j]![0] + poly[i]![0]) * f
    cz += (poly[j]![1] + poly[i]![1]) * f
    a += f
  }
  if (Math.abs(a) < 1e-9) return new Vector2(poly[0]?.[0] ?? 0, poly[0]?.[1] ?? 0)
  return new Vector2(cx / (3 * a), cz / (3 * a))
}

/** Tanner Helland blackbody fit → linear RGB. */
export function kelvin(k: number) {
  const t = k / 100
  let r: number
  let g: number
  let b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592
    g = 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255
  }
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  return new Color().setRGB(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), SRGBColorSpace)
}

/** The daylight look's room system (one viewer canvas at a time). */
export const daylightRooms = new RoomLighting()
