import type { AnyNode, RoofCovering, RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { float, max, mix, normalMap, smoothstep, step, uniform, uv, vec2, vec3 } from 'three/tsl'
import { MeshStandardNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { createRoofCoveringCapGeometry } from './covering-caps'

const TOP_SLOT = 3
const TEXTURE_WIDTH = 256
const TEXTURE_HEIGHT = 512
const ATLAS_COLUMNS = 4
const ATLAS_ROWS = 8

export function supportsRoofCovering(segment: RoofSegmentNode): boolean {
  return (
    ['gable', 'hip', 'shed', 'gambrel', 'dutch', 'mansard'].includes(segment.roofType) &&
    segment.roofSystem !== 'glazed' &&
    !segment.arc
  )
}

/**
 * Keep the authored albedo UVs. The detail has a separate, orthonormal metre frame, including
 * on shallow slopes whose legacy UVs project in XZ. Explicit tangents are necessary: Three's
 * node-material derivative fallback uses uv0, not the normal texture's selected UV channel.
 */
export function createRoofCoveringGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const detailUv = new Float32Array(position.count * 2)
  const tangents = new Float32Array(position.count * 4)
  const top = new Uint8Array(position.count)
  for (const group of geometry.groups) {
    if (group.materialIndex === TOP_SLOT) top.fill(1, group.start, group.start + group.count)
  }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const down = new THREE.Vector3()
  const across = new THREE.Vector3()
  const bitangent = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const point = new THREE.Vector3()
  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    edge1.subVectors(b, a)
    edge2.subVectors(c, a)
    // Other slots retain the tangent frame of their existing maps.
    const du1 = uv ? uv.getX(i + 1) - uv.getX(i) : 1
    const dv1 = uv ? uv.getY(i + 1) - uv.getY(i) : 0
    const du2 = uv ? uv.getX(i + 2) - uv.getX(i) : 0
    const dv2 = uv ? uv.getY(i + 2) - uv.getY(i) : 1
    const det = du1 * dv2 - du2 * dv1
    tangent.copy(edge1).multiplyScalar(dv2).addScaledVector(edge2, -dv1)
    bitangent.copy(edge2).multiplyScalar(du1).addScaledVector(edge1, -du2)
    if (Math.abs(det) > 1e-10) {
      tangent.divideScalar(det)
      bitangent.divideScalar(det)
    }
    for (let j = i; j < i + 3; j++) {
      n.fromBufferAttribute(normal, j).normalize()
      if (top[j] && n.y > 0) {
        down.set(0, -1, 0).projectOnPlane(n)
        if (down.lengthSq() < 1e-10) down.set(0, 0, 1).projectOnPlane(n)
        down.normalize()
        across.crossVectors(down, n).normalize()
        point.fromBufferAttribute(position, j)
        detailUv[j * 2] = point.dot(across)
        detailUv[j * 2 + 1] = point.dot(down)
        tangents.set([across.x, across.y, across.z, 1], j * 4)
      } else {
        across.copy(tangent).projectOnPlane(n).normalize()
        if (across.lengthSq() < 1e-10) {
          down.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0)
          across.crossVectors(down, n).normalize()
        }
        const sign = down.crossVectors(n, across).dot(bitangent) < 0 ? -1 : 1
        tangents.set([across.x, across.y, across.z, sign], j * 4)
      }
    }
  }
  geometry.setAttribute('uv3', new THREE.BufferAttribute(detailUv, 2))
  geometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function profileShape(covering: RoofCovering) {
  const slate = covering.profile === 'slate'
  const clay = covering.profile === 'clay'
  return {
    crown: clay ? 0.65 : slate ? 0 : 0.06,
    lap: slate ? 0.3 : clay ? 0.35 : 0.55,
    scallop: clay ? 0.16 : 0,
    lipStart: clay ? 0.84 : 0.96,
    jointShade: slate ? 0.18 : 0.12,
    lapShade: slate ? 0.42 : 0.34,
  }
}

function courseAt(u: number, v: number, scallop: number) {
  const boundary = (row: number) =>
    scallop ? row + scallop * (0.5 + 0.5 * Math.cos(2 * Math.PI * (u + row * 0.5))) : row
  let row = Math.floor(v)
  if (v < boundary(row)) row--
  const top = boundary(row)
  const along = (v - top) / (boundary(row + 1) - top)
  const shifted = u + (row - 2 * Math.floor(row / 2)) * 0.5
  const column = Math.floor(shifted)
  return { row, column, across: shifted - column, along }
}

function heightAt(
  u: number,
  v: number,
  covering: RoofCovering,
  shape: ReturnType<typeof profileShape>,
): number {
  const { along, across } = courseAt(u, v, shape.scallop)
  const joint = smooth(0, 0.025, Math.min(across, 1 - across))
  const head = smooth(0, 0.08, along)
  const lip = 1 - smooth(shape.lipStart, 1, along)
  const crown = 0.5 - 0.5 * Math.cos(2 * Math.PI * across)
  return covering.relief * joint * head * lip * (crown * shape.crown + along * shape.lap)
}

/** Portable albedo bake of the same course contact and tile tint used by the node material. */
function shadeAt(
  u: number,
  v: number,
  covering: RoofCovering,
  shape: ReturnType<typeof profileShape>,
): number {
  const { row, column, across, along } = courseAt(u, v, shape.scallop)
  const fract = (value: number) => value - Math.floor(value)
  const blurU = (ATLAS_COLUMNS / TEXTURE_WIDTH) * 0.5
  const blurV =
    (ATLAS_ROWS / TEXTURE_HEIGHT + (ATLAS_COLUMNS / TEXTURE_WIDTH) * shape.scallop * Math.PI) * 0.5
  const sideJoint =
    (1 - smooth(-blurU, 0.035 + blurU, Math.min(across, 1 - across))) * (0.035 / (0.035 + blurU))
  const lapDistance = Math.abs(fract(along - 0.025 + 0.5) - 0.5)
  const underLap = (1 - smooth(-blurV, 0.06 + blurV, lapDistance)) * (0.06 / (0.06 + blurV))
  let seed =
    fract(column / ATLAS_COLUMNS) * ATLAS_COLUMNS * 0.1031 +
    fract(row / ATLAS_ROWS) * ATLAS_ROWS * 0.11369
  seed = fract(seed)
  seed *= seed + 33.33
  const tone = 0.94 + 0.06 * fract(2 * seed * seed)
  const shade = tone * (1 - shape.jointShade * sideJoint) * (1 - shape.lapShade * underLap)
  return 1 + (shade - 1) * Math.min(1, covering.relief / 0.008)
}

/**
 * Fragment-stage height field: courses run downhill in uv3 metres, not the albedo UV frame.
 * The baked maps below carry the finish through exporters that cannot serialize TSL.
 */
function coveringNodes(
  covering: RoofCovering,
  strength: UniformNode<'float'>,
  baseColor: THREE.Color,
) {
  const shape = profileShape(covering)
  const p = uv(3).div(vec2(covering.width, covering.course))
  const coordinates = (u: Node<'float'>, v: Node<'float'>) => {
    let row = v.floor()
    let along = v.fract()
    if (shape.scallop) {
      // The preceding tile's rounded nose is this course's top boundary. Alternating
      // boundaries keep each scallop centred on its own half-offset tile, without gaps.
      const boundary = (r: Node<'float'>) =>
        u
          .add(r.mul(0.5))
          .mul(Math.PI * 2)
          .cos()
          .mul(0.5)
          .add(0.5)
          .mul(shape.scallop)
          .add(r)
      row = row.add(step(boundary(row), v)).sub(1)
      const top = boundary(row)
      along = v.sub(top).div(boundary(row.add(1)).sub(top))
    }
    const shifted = u.add(row.mul(0.5).fract())
    const across = shifted.fract()
    return {
      row,
      column: shifted.floor(),
      along,
      across,
      edge: across.min(across.oneMinus()),
    }
  }
  const height = (u: Node<'float'>, v: Node<'float'>) => {
    const { along, across, edge } = coordinates(u, v)
    const joint = smoothstep(0, 0.025, edge)
    // A rounded crown must rise continuously from the preceding lip's zero height.
    // Otherwise row changes introduce a step whose finite difference spikes at grazing views.
    const head = smoothstep(0, 0.08, along)
    const lip = smoothstep(shape.lipStart, 1, along).oneMinus()
    const crown = across
      .mul(Math.PI * 2)
      .cos()
      .mul(-0.5)
      .add(0.5)
    return crown
      .mul(shape.crown)
      .add(along.mul(shape.lap))
      .mul(joint)
      .mul(head)
      .mul(lip)
      .mul(covering.relief)
  }
  // Average the height slope over at least a pixel footprint: millimetre-only samples
  // hit or miss a subpixel lip and produce dotted, sparkling edges at grazing angles.
  const pixelU = p.x.fwidth()
  const pixelV = p.y.fwidth()
  const du = max(0.001 / covering.width, pixelU.mul(0.5))
  const dv = max(0.001 / covering.course, pixelV.mul(0.5))
  const dx = height(p.x.add(du), p.y)
    .sub(height(p.x.sub(du), p.y))
    .div(du.mul(2 * covering.width))
  const dy = height(p.x, p.y.add(dv))
    .sub(height(p.x, p.y.sub(dv)))
    .div(dv.mul(2 * covering.course))
  // Fade subpixel courses before they can shimmer; distance fade also returns the exact base.
  const footprint = max(pixelU, pixelV)
  const fade = strength.mul(smoothstep(0.15, 0.5, footprint).oneMinus())
  const normal = vec3(dx.negate().mul(fade), dy.negate().mul(fade), 1).normalize()
  const { row, column, along, edge } = coordinates(p.x, p.y)
  let seed = column
    .div(ATLAS_COLUMNS)
    .fract()
    .mul(ATLAS_COLUMNS * 0.1031)
    .add(
      row
        .div(ATLAS_ROWS)
        .fract()
        .mul(ATLAS_ROWS * 0.11369),
    )
    .fract()
  seed = seed.mul(seed.add(33.33))
  const tone = seed.mul(seed).mul(2).fract().mul(0.06).add(0.94)
  const blurU = pixelU.mul(0.5)
  const blurV = pixelV.add(pixelU.mul(shape.scallop * Math.PI)).mul(0.5)
  const sideJoint = smoothstep(blurU.negate(), blurU.add(0.035), edge)
    .oneMinus()
    .mul(float(0.035).div(blurU.add(0.035)))
  // Periodic distance also filters the sharp upstream side of the lap shadow.
  const lapDistance = along.sub(0.025).add(0.5).fract().sub(0.5).abs()
  const underLap = smoothstep(blurV.negate(), blurV.add(0.06), lapDistance)
    .oneMinus()
    .mul(float(0.06).div(blurV.add(0.06)))
  const shade = tone
    .mul(sideJoint.mul(shape.jointShade).oneMinus())
    .mul(underLap.mul(shape.lapShade).oneMinus())
  return {
    normal: normalMap(normal.mul(0.5).add(0.5)),
    // materialColor includes map; use the bare colour to avoid double-applying the export bake.
    color: uniform(baseColor).mul(
      mix(float(1), shade, fade.mul(Math.min(1, covering.relief / 0.008))),
    ),
  }
}

export function createRoofCoveringMaterial(
  source: THREE.Material,
  covering: RoofCovering,
): {
  material: THREE.Material
  texture: THREE.Texture
  strength: UniformNode<'float'>
  dispose(): void
} | null {
  const standard = source as THREE.MeshStandardMaterial
  // A generated course grid cannot truthfully follow arbitrary library albedo/normal courses.
  // The opt-in is for a plain authored top colour, never a modification of a catalog texture.
  if (!standard.normalScale || standard.map || standard.normalMap || standard.bumpMap) return null
  // Procedural finishes own their colour/normal pattern just as library maps do.
  if (
    ('colorNode' in source && source.colorNode != null) ||
    ('normalNode' in source && source.normalNode != null)
  )
    return null
  const pixels = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4)
  const contact = new Uint8Array(pixels.length)
  const shape = profileShape(covering)
  const du = ATLAS_COLUMNS / TEXTURE_WIDTH
  const dv = ATLAS_ROWS / TEXTURE_HEIGHT
  const deltaU = Math.max(0.001 / covering.width, du * 0.5)
  const deltaV = Math.max(0.001 / covering.course, dv * 0.5)
  for (let y = 0; y < TEXTURE_HEIGHT; y++) {
    for (let x = 0; x < TEXTURE_WIDTH; x++) {
      const u = (x + 0.5) * du
      const v = (y + 0.5) * dv
      const nx =
        -(heightAt(u + deltaU, v, covering, shape) - heightAt(u - deltaU, v, covering, shape)) /
        (2 * deltaU * covering.width)
      const ny =
        -(heightAt(u, v + deltaV, covering, shape) - heightAt(u, v - deltaV, covering, shape)) /
        (2 * deltaV * covering.course)
      const length = Math.hypot(nx, ny, 1)
      const offset = (y * TEXTURE_WIDTH + x) * 4
      pixels[offset] = Math.round((nx / length + 1) * 127.5)
      pixels[offset + 1] = Math.round((ny / length + 1) * 127.5)
      pixels[offset + 2] = Math.round((1 / length + 1) * 127.5)
      pixels[offset + 3] = 255
      const shade = shadeAt(u, v, covering, shape)
      const encoded = Math.min(255, Math.round(255 * (1.055 * shade ** (1 / 2.4) - 0.055)))
      contact[offset] = contact[offset + 1] = contact[offset + 2] = encoded
      contact[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(pixels, TEXTURE_WIDTH, TEXTURE_HEIGHT)
  texture.name = `Roof ${covering.profile} normal`
  texture.channel = 3
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.repeat.set(1 / (ATLAS_COLUMNS * covering.width), 1 / (ATLAS_ROWS * covering.course))
  texture.needsUpdate = true
  const material = new MeshStandardNodeMaterial()
  // NodeMaterial.copy preserves both standard properties and shader nodes (e.g. glass opacity).
  material.copy(source)
  material.name = `Roof ${covering.profile} detail`
  material.normalMap = texture
  material.normalScale.set(1, 1)
  const contactTexture = new THREE.DataTexture(contact, TEXTURE_WIDTH, TEXTURE_HEIGHT)
  contactTexture.name = `Roof ${covering.profile} course contact`
  contactTexture.colorSpace = THREE.SRGBColorSpace
  contactTexture.channel = texture.channel
  contactTexture.wrapS = contactTexture.wrapT = THREE.RepeatWrapping
  contactTexture.magFilter = texture.magFilter
  contactTexture.minFilter = texture.minFilter
  contactTexture.generateMipmaps = true
  contactTexture.repeat.copy(texture.repeat)
  contactTexture.needsUpdate = true
  material.map = contactTexture
  const strength = uniform(1)
  const nodes = coveringNodes(covering, strength, material.color)
  material.normalNode = nodes.normal
  material.colorNode = nodes.color
  // This variant is owned by the roof instance, not the material resolver's shared cache.
  delete material.userData.__pascalCachedMaterial
  material.needsUpdate = true
  return {
    material,
    texture,
    strength,
    dispose() {
      material.dispose()
      texture.dispose()
      contactTexture.dispose()
    },
  }
}

/**
 * Renderer-owned near detail. The shell system may replace/dispose the shown geometry; a
 * replacement invalidates only this shell's detail, never the shared material cache.
 * Far uses the exact original materials and geometry, with no extra draw or texture sample.
 */
export class RoofCoveringDetail {
  private sourceGeometry: THREE.BufferGeometry | null = null
  private geometry: THREE.BufferGeometry | null = null
  private caps: THREE.Mesh | null = null
  private capsBuilt = false
  private sourceDisposed = false
  private near = false
  private variant: ReturnType<typeof createRoofCoveringMaterial> = null
  private shown: THREE.Material[] | null = null
  private sourceVersion = -1
  private readonly bounds = new THREE.Box3()
  private readonly eye = new THREE.Vector3()
  private readonly sourceDisposal = () => {
    this.sourceDisposed = true
  }

  constructor(
    private readonly mesh: THREE.Mesh,
    private readonly materials: THREE.Material[],
    private readonly covering: RoofCovering,
    private readonly capContext?: {
      segment: RoofSegmentNode
      roofSpace?: boolean
      nodes?: Readonly<Record<string, AnyNode>>
    },
  ) {}

  /** Let the roof veil see the real base before it chooses its own material for this frame. */
  suspend(): void {
    if (this.caps) this.caps.visible = false
    if (this.mesh.material !== this.shown) return
    this.mesh.material = this.materials
    if (this.mesh.geometry === this.geometry && this.sourceGeometry && !this.sourceDisposed)
      this.mesh.geometry = this.sourceGeometry
  }

  /** A snapshot/export is static: its finish must not depend on the live viewport's LOD. */
  beginCapture(camera: THREE.Camera): () => void {
    const geometry = this.mesh.geometry
    const material = this.mesh.material
    const detailed = material === this.shown
    const near = this.near
    const strength = this.variant?.strength.value ?? 1
    const capsVisible = this.caps?.visible ?? false
    // The roof capture owner has lifted its veil. Ignore other temporary presentation
    // materials inside this scope too, without mutating or disposing any borrowed material.
    this.mesh.material = this.materials
    this.update(camera, true, true)
    return () => {
      this.mesh.material = detailed ? (this.shown ?? this.materials) : material
      this.mesh.geometry = detailed ? (this.geometry ?? geometry) : geometry
      this.near = near
      if (this.variant) this.variant.strength.value = strength
      if (this.caps) this.caps.visible = capsVisible
    }
  }

  private releaseGeometry() {
    if (this.caps) {
      this.mesh.remove(this.caps)
      this.caps.geometry.dispose()
      this.caps = null
    }
    this.capsBuilt = false
    const source = this.sourceGeometry
    if (this.mesh.geometry === this.geometry && source && !this.sourceDisposed)
      this.mesh.geometry = source
    if (source) {
      source.removeEventListener('dispose', this.sourceDisposal)
      // When the shell system replaced our near clone, its original is no longer mounted.
      if (this.mesh.geometry !== source && !this.sourceDisposed) source.dispose()
    }
    this.geometry?.dispose()
    this.geometry = null
    this.sourceGeometry = null
  }

  update(camera: THREE.Camera, enabled = true, force = false): void {
    const mesh = this.mesh
    if (this.caps) this.caps.visible = false
    if (mesh.geometry !== this.geometry && mesh.geometry !== this.sourceGeometry) {
      this.releaseGeometry()
      this.sourceGeometry = mesh.geometry
      this.sourceDisposed = false
      this.sourceGeometry.addEventListener('dispose', this.sourceDisposal)
    }
    const source = this.sourceGeometry
    if (!source || this.sourceDisposed || source.userData.placeholder) return
    const material = this.materials[TOP_SLOT]
    if (!material) return
    if (material.version !== this.sourceVersion) {
      if (mesh.material === this.shown) mesh.material = this.materials
      this.variant?.dispose()
      this.variant = null
      this.shown = null
      this.sourceVersion = material.version
    }
    // Cutaway, reveal and selection own their material variants. Do not overwrite them.
    const ownsMaterial = mesh.material === this.materials || mesh.material === this.shown
    if (!source.boundingBox) source.computeBoundingBox()
    mesh.updateWorldMatrix(true, false)
    this.bounds.copy(source.boundingBox!).applyMatrix4(mesh.matrixWorld)
    camera.getWorldPosition(this.eye)
    const distance = this.bounds.distanceToPoint(this.eye)
    const threshold = this.covering.distance * (this.near ? 1.1 : 1)
    this.near =
      enabled &&
      ownsMaterial &&
      (this.covering.relief > 0 || Boolean(this.covering.caps && this.capContext)) &&
      (force || distance <= threshold)
    if (this.near && this.covering.relief > 0 && !this.variant) {
      this.variant = createRoofCoveringMaterial(material, this.covering)
      if (this.variant) {
        this.shown = this.materials.slice()
        this.shown[TOP_SLOT] = this.variant.material
      }
    }
    if (this.near && this.shown) {
      if (this.variant)
        this.variant.strength.value = force
          ? 1
          : 1 - smooth(this.covering.distance * 0.6, this.covering.distance, distance)
      this.geometry ??= createRoofCoveringGeometry(source)
      mesh.geometry = this.geometry
      mesh.material = this.shown
    } else {
      if (ownsMaterial && mesh.geometry === this.geometry) mesh.geometry = source
      if (mesh.material === this.shown) mesh.material = this.materials
    }
    const plain = material as THREE.MeshStandardMaterial
    if (
      this.near &&
      this.covering.caps &&
      this.capContext &&
      plain.normalScale &&
      !plain.map &&
      !plain.normalMap &&
      !plain.bumpMap
    ) {
      if (!this.capsBuilt) {
        this.capsBuilt = true
        const { segment, roofSpace, nodes } = this.capContext
        const geometry = createRoofCoveringCapGeometry(segment, this.covering, nodes)
        if (geometry) {
          if (roofSpace) {
            geometry.rotateY(segment.rotation)
            geometry.translate(...segment.position)
          }
          this.caps = new THREE.Mesh(geometry, material)
          this.caps.name = 'roof-covering-caps'
          this.caps.castShadow = true
          this.caps.receiveShadow = true
          // Visual finish only: hosting and picking keep using the structural roof surface.
          this.caps.raycast = () => {}
          mesh.add(this.caps)
        }
      }
      if (this.caps) {
        this.caps.material = material
        this.caps.visible = true
      }
    }
  }

  dispose(): void {
    if (this.mesh.material === this.shown) this.mesh.material = this.materials
    this.releaseGeometry()
    this.variant?.dispose()
    this.variant = null
    this.shown = null
  }
}
