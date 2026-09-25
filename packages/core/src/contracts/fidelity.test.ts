/**
 * F0 executable examples (plan item A-02, `editor-fidelity-foundations.md` F0).
 *
 * One example per shared contract: end-cut offset, UVs in metres,
 * finished-face contact (with the horizontal frame and the anchor chart),
 * mask alpha, `pascalPart` v1 tags and legacy rendering, plus the frozen O3
 * display precedence, O4 section pinning and the kernel host seam. The
 * reference computations below are the contract: the slice that implements
 * each one (F1, F4, F5a, F6, SI-R2) must reproduce these numbers.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type {
  Anchor,
  DefinitionPin,
  DisplayFamily,
  DisplayMode,
  EndCut,
  FidelityV3,
  MaterialPattern,
  Mount,
  PascalBakeExtras,
  PascalPartTag,
  PortRef,
  ResolvedSectionProfile,
  SceneToolHost,
  SectionLibraryEntry,
  SectionProfile,
  SitePresentation,
  SurfaceAnchor,
  SweepEndSpec,
} from '../index'
import { createSceneApi } from '../registry/scene-api'
import { getScaledDimensions, ItemNode } from '../schema/nodes/item'
import type { AnyNode, AnyNodeId } from '../schema/types'

const close = (actual: number, expected: number, digits = 6) =>
  expect(actual).toBeCloseTo(expected, digits)

type Loose = Record<string, unknown>

type V3 = [number, number, number]
const sub = (a: FidelityV3, b: FidelityV3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: FidelityV3, b: FidelityV3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: FidelityV3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: FidelityV3, b: FidelityV3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: FidelityV3, b: FidelityV3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: FidelityV3): V3 => scale(a, 1 / Math.hypot(...a))

describe('end-cut offset (R §D2 → F1)', () => {
  /** The contract: the end vertex moves by `offset` along the end tangent; the path never moves. */
  function applyEndCut(path: readonly FidelityV3[], cut: EndCut) {
    const end = path[path.length - 1]!
    const tangent = unit(sub(end, path[path.length - 2]!))
    const normal = unit(cut.normal)
    const spec: SweepEndSpec = { cut: { normal } }
    const findings = Math.abs(dot(normal, tangent)) < 0.1 ? ['end-cut-parallel'] : []
    return { vertex: add(end, scale(tangent, cut.offset)), spec, findings }
  }
  /** Where the cut plane meets a section edge running along x at height z (y = 0). */
  const cutX = (vertex: V3, normal: FidelityV3, z: number) =>
    vertex[0] - (normal[2] / normal[0]) * (z - vertex[2])

  const path: FidelityV3[] = [
    [0, 0, 0],
    [3, 0, 0],
  ]

  test('a 45° cut 50 mm beyond the end', () => {
    const { vertex, spec, findings } = applyEndCut(path, { normal: [1, 0, 1], offset: 0.05 })
    expect(vertex).toEqual([3.05, 0, 0])
    close(spec.cut!.normal[0], Math.SQRT1_2)
    close(spec.cut!.normal[2], Math.SQRT1_2)
    // A 0.10 m section: its z = ±0.05 edges end at 3.00 and 3.10.
    close(cutX(vertex, spec.cut!.normal, 0.05), 3.0)
    close(cutX(vertex, spec.cut!.normal, -0.05), 3.1)
    expect(findings).toEqual([])
    expect(path[1]).toEqual([3, 0, 0])
  })

  test('negative offset trims; a square cut is flat; a parallel normal is a finding', () => {
    close(applyEndCut(path, { normal: [1, 0, 1], offset: -0.05 }).vertex[0], 2.95)
    const square = applyEndCut(path, { normal: [2, 0, 0], offset: 0.05 })
    close(cutX(square.vertex, square.spec.cut!.normal, 0.05), 3.05)
    close(cutX(square.vertex, square.spec.cut!.normal, -0.05), 3.05)
    expect(applyEndCut(path, { normal: [0, 0, 1], offset: 0 }).findings).toEqual([
      'end-cut-parallel',
    ])
  })
})

describe('UVs in metres (F1, host-face frames)', () => {
  /** Sweep: u is true arc length along the path; v is distance along the tessellated outline. */
  const roundPerimeter = (radius: number, segments: number) =>
    segments * 2 * radius * Math.sin(Math.PI / segments)
  const bendArc = (radius: number, angle: number) => radius * angle
  /** A texture coordinate is metres × tiles per metre (`repeat`), set on the material. */
  const texcoord = (metres: number, repeat: number) => metres * repeat

  test('straight round run, rectangular duct and a bend', () => {
    close(roundPerimeter(0.03, 12), 0.18635, 5)
    close(2 * (0.1 + 0.2), 0.6)
    // The bend's u is its true arc even when drawn with 15° chords.
    close(bendArc(0.3, Math.PI / 2), 0.471239)
    const chords = 6 * 2 * 0.3 * Math.sin(Math.PI / 24)
    expect(Math.abs(chords - 0.471239)).toBeGreaterThan(0.001)
  })

  test('repeat is tiles per metre', () => {
    close(texcoord(2.5, 0.4), 1)
    close(texcoord(1, 1), 1)
  })

  test('a host face UV is its patch chart in metres', () => {
    // Front patch of a wall from (0,0) to (4,0), 0.2 thick, base at y = 0.1:
    // u metres from the start along the wall, v metres above the base.
    const patch = { origin: [0, 0.1, 0.1] as V3, u: [1, 0, 0] as V3, normal: [0, 0, 1] as V3 }
    const v = cross(patch.normal, patch.u)
    const world: V3 = [1.5, 1.0, 0.1]
    const local = sub(world, patch.origin)
    close(dot(local, patch.u), 1.5)
    close(dot(local, v), 0.9)
  })
})

describe('finished-face contact, horizontal frame and anchor chart (F5a/F6)', () => {
  /** Outward face distance from the wall mid-plane: body face, or a cladding's outer face. */
  const finishedFace = (thickness: number, cladding = 0) => thickness / 2 + cladding
  /** The envelope's vertical extent when `anchor` sits on the mount height. */
  const envelopeY = (mountY: number, anchor: Anchor, height: number) =>
    anchor === 'bottom'
      ? [mountY, mountY + height]
      : anchor === 'top'
        ? [mountY - height, mountY]
        : [mountY - height / 2, mountY + height / 2]

  test('wall mounts sit on the finished face, not the mid-plane', () => {
    close(finishedFace(0.2), 0.1)
    close(finishedFace(0.2, 0.012), 0.112)
    close(finishedFace(0.2, 0.012) + 0.005, 0.117) // offset: proud of the face
    // The device's local +Z is the face normal; its back (z = 0) is on the face.
    const depth = 0.05
    const back = finishedFace(0.2, 0.012) + 0.005
    expect([back, back + depth].map((z) => Number(z.toFixed(3)))).toEqual([0.117, 0.167])
    // height 0.30 above a finished floor at 0.05, anchor center, form 0.114 tall
    const [lo, hi] = envelopeY(0.05 + 0.3, 'center', 0.114)
    close(lo!, 0.293)
    close(hi!, 0.407)
  })

  test('ceiling mounts: the evaluated height at (x, z) elects, the normal only orients', () => {
    // Explicit host: a sloped underside y = 2.4 + 0.5 z; another ceiling below is ignored.
    const host = { heightAt: (_x: number, z: number) => 2.4 + 0.5 * z, normal: unit([0, -1, 0.5]) }
    const other = { heightAt: () => 2.5 }
    const mount: Extract<Mount, { host: 'ceiling' }> = {
      host: 'ceiling',
      ceilingId: 'ceiling_a',
      x: 1,
      z: 0.6,
    }
    const contactFor = (_align: 'normal' | 'plumb'): V3 => [
      mount.x,
      host.heightAt(mount.x, mount.z),
      mount.z,
    ]
    expect(contactFor('normal')).toEqual(contactFor('plumb'))
    close(contactFor('normal')[1], 2.7)
    expect(other.heightAt()).toBeLessThan(contactFor('normal')[1])
    const [lo, hi] = envelopeY(contactFor('plumb')[1], 'top', 0.15)
    close(lo!, 2.55)
    close(hi!, 2.7)
    expect(host.normal[1]).toBeLessThan(0)
  })

  test('SurfaceAnchor chart: [u, v, offset] = frame-local (u, offset, −v)', () => {
    // Wall front patch frame: origin at the wall start on the face base,
    // rotation X +90° maps local +Y (the normal) to world +Z.
    const rotateX = (p: FidelityV3, a: number): V3 => [
      p[0],
      p[1] * Math.cos(a) - p[2] * Math.sin(a),
      p[1] * Math.sin(a) + p[2] * Math.cos(a),
    ]
    const frame = { position: [0, 0.1, 0.1] as V3, rotationX: Math.PI / 2 }
    const anchor: SurfaceAnchor = {
      nodeId: 'wall_a',
      surfaceId: 'front',
      point: [1.5, 0.9, 0.005],
    }
    // The node's `anchor` is the contact enum; the mount carries the SurfaceAnchor.
    const mount: Mount = { host: 'surface', surface: anchor }
    const contact: Anchor = 'center'
    expect(contact).toBe('center')
    const [u, v, offset] = mount.host === 'surface' ? mount.surface.point : anchor.point
    const local: V3 = [u, offset, -v]
    const world = add(frame.position, rotateX(local, frame.rotationX))
    close(world[0], 1.5)
    close(world[1], 1.0)
    close(world[2], 0.105)
    const normal = rotateX([0, 1, 0], frame.rotationX)
    close(normal[2], 1)
    // (u, v, normal) is right-handed; a SurfaceRegion point [x, z] is [u, −v].
    const uAxis = rotateX([1, 0, 0], frame.rotationX)
    const vAxis = cross(normal, uAxis)
    close(vAxis[1], 1)
    const region: [number, number] = [local[0], local[2]]
    expect(region).toEqual([1.5, -0.9])
    expect(anchor.policy ?? 'follow').toBe('follow')
  })
})

describe('mask alpha (SI-R2 patterns)', () => {
  /** Geometric open fraction; opaque types emit no mask. */
  const openFraction = (p: MaterialPattern): number | null => {
    if (p.type === 'grid')
      return (p.unit[0] * p.unit[1]) / ((p.unit[0] + p.joint) * (p.unit[1] + p.joint))
    if (p.type === 'mesh') {
      const wire = p.wire ?? 0
      return ((p.unit[0] - wire) / p.unit[0]) * ((p.unit[1] - wire) / p.unit[1])
    }
    return null
  }
  /** The mask texel at a UV point in metres: 1 in an opening, 0 on a bar or wire. */
  const alphaAt = (p: MaterialPattern, u: number, v: number) => {
    const bar = p.type === 'mesh' ? (p.wire ?? 0) : p.joint
    const period =
      p.type === 'mesh' ? p.unit : ([p.unit[0] + p.joint, p.unit[1] + p.joint] as const)
    const inside = (x: number, size: number) => ((x % size) + size) % size >= bar
    return inside(u, period[0]) && inside(v, period[1]) ? 1 : 0
  }
  const maskMaterial = (p: MaterialPattern) =>
    openFraction(p) === null ? null : { alphaTest: 0.5, transparent: false }

  const grid: MaterialPattern = { v: 1, type: 'grid', unit: [0.1, 0.1], joint: 0.02 }
  const mesh: MaterialPattern = { v: 1, type: 'mesh', unit: [0.002, 0.002], joint: 0, wire: 0.0003 }

  test('open fractions', () => {
    close(openFraction(grid)!, 0.694444)
    close(openFraction(mesh)!, 0.7225)
    expect(openFraction({ v: 1, type: 'running-bond', unit: [0.2, 0.065], joint: 0.01 })).toBeNull()
  })

  test('the rasterised mask passes the alpha test over the same fraction', () => {
    const pixels = 240
    const period = grid.unit[0] + grid.joint
    let open = 0
    for (let i = 0; i < pixels; i++)
      for (let j = 0; j < pixels; j++)
        if (alphaAt(grid, ((i + 0.5) / pixels) * period, ((j + 0.5) / pixels) * period) >= 0.5)
          open++
    expect(Math.abs(open / pixels ** 2 - openFraction(grid)!)).toBeLessThan(2 / pixels)
  })

  test('masks alpha-test, never blend; opaque patterns carry none', () => {
    expect(maskMaterial(grid)).toEqual({ alphaTest: 0.5, transparent: false })
    expect(maskMaterial({ v: 1, type: 'lap', unit: [0.2, 0.2], joint: 0 })).toBeNull()
  })
})

describe('pascalPart v1 tags (F4)', () => {
  const FAMILIES: readonly DisplayFamily[] = [
    'finish',
    'exposed-structure',
    'framing',
    'masonry',
    'sheathing',
    'insulation',
    'membrane',
    'fill',
    'foundation',
    'service-space',
    'device',
    'run',
    'inspection',
  ]
  const FINISH: PascalPartTag = { v: 1, family: 'finish', role: 'finish' }
  /** Validated at live, raw bake, optimised bake and saved viewer. A missing tag reads as finish. */
  function readTag(userData: { pascalPart?: unknown }): PascalPartTag | Error {
    const tag = userData.pascalPart as Partial<PascalPartTag> | undefined
    if (tag === undefined) return FINISH
    if (tag.v !== 1) return new Error(`unsupported pascalPart version ${String(tag.v)}`)
    if (!FAMILIES.includes(tag.family as DisplayFamily)) return new Error('unknown family')
    if (typeof tag.role !== 'string' || tag.role.length === 0) return new Error('missing role')
    if (tag.presentation !== undefined && tag.presentation !== true)
      return new Error('presentation must be true when present')
    return tag as PascalPartTag
  }
  const canonical = (meshes: { pascalPart?: PascalPartTag }[]) =>
    meshes.filter((m) => readTag(m) instanceof Error || !(readTag(m) as PascalPartTag).presentation)
  const category = (tag: PascalPartTag, ownerCategory: string, byRole: Record<string, string>) =>
    tag.source ?? byRole[tag.role] ?? ownerCategory

  test('accepts v1 and rejects other versions and families', () => {
    const stud: PascalPartTag = {
      v: 1,
      family: 'framing',
      role: 'stud',
      owner: 'wall_x',
      key: 'g1/stud/s3',
    }
    expect(readTag({ pascalPart: stud })).toEqual(stud)
    expect(readTag({ pascalPart: { ...stud, v: 2 } })).toBeInstanceOf(Error)
    expect(readTag({ pascalPart: { ...stud, family: 'pipework' } })).toBeInstanceOf(Error)
  })

  test('legacy GLBs: an untagged mesh is finish', () => {
    expect(readTag({})).toEqual(FINISH)
  })

  test('presentation solids never reach the canonical bake; proxies do', () => {
    const occluder = {
      pascalPart: { v: 1, family: 'finish', role: 'core', presentation: true } as const,
    }
    const proxy = { pascalPart: { v: 1, family: 'device', role: 'outlet', proxy: true } as const }
    expect(canonical([occluder, proxy, {}])).toEqual([proxy, {}])
  })

  test('source overrides the benchmark category', () => {
    const tag: PascalPartTag = { v: 1, family: 'finish', role: 'tread', source: 'floor' }
    expect(category(tag, 'stair', { tread: 'stair' })).toBe('floor')
    expect(category({ ...tag, source: undefined }, 'stair', {})).toBe('stair')
  })
})

describe('legacy rendering: absent fields keep today’s pose (F6 §compatibility)', () => {
  const item = (asset: Loose = {}, extra: Loose = {}) =>
    ItemNode.parse({
      asset: { id: 'a', category: 'c', name: 'n', thumbnail: '/t.png', src: '/m.glb', ...asset },
      ...extra,
    })

  test('parsing adds no placement contract fields', () => {
    const parsed = item({ attachTo: 'wall-side' }, { wallT: 0.25 }) as Loose
    for (const field of ['anchor', 'mount', 'size', 'fit']) expect(field in parsed).toBe(false)
    expect(parsed.wallT).toBe(0.25)
  })

  /** `ItemSystem`: a wall-side item's local z is pushed to ± thickness / 2 (absent side = back). */
  const legacyWallSideZ = (thickness: number | undefined, side: 'front' | 'back' | undefined) =>
    ((thickness ?? 0.1) / 2) * (side === 'front' ? 1 : -1)
  /** Ceiling placement: `seatY = recessed ? 0 : −scaled height`, written into `position`. */
  const legacySeatY = (node: ItemNode) => (node.asset.recessed ? 0 : -getScaledDimensions(node)[1])

  test('wall-side and ceiling legacy poses', () => {
    close(legacyWallSideZ(0.2, 'back'), -0.1)
    close(legacyWallSideZ(undefined, undefined), -0.05)
    const hanging = item(
      { attachTo: 'ceiling', dimensions: [0.6, 0.3, 0.6] },
      { scale: [1, 1.5, 1] },
    )
    close(legacySeatY(hanging), -0.45)
    const recessed = item({ attachTo: 'ceiling', recessed: true, dimensions: [0.2, 0.1, 0.2] })
    expect(legacySeatY(recessed)).toBe(0)
  })

  test('adopting the placement contract keeps the world pose', () => {
    const ceilingY = 2.7
    const hanging = item(
      { attachTo: 'ceiling', dimensions: [0.6, 0.3, 0.6] },
      { scale: [1, 1.5, 1] },
    )
    const height = getScaledDimensions(hanging)[1]
    // Legacy: bottom at ceiling + seatY. Adopted: anchor 'top' on the underside.
    const legacyBottom = ceilingY + legacySeatY(hanging)
    close(legacyBottom, ceilingY - height)
    const recessed = item({ attachTo: 'ceiling', recessed: true })
    // Recessed: bottom flush with the ceiling plane = anchor 'bottom'.
    close(ceilingY + legacySeatY(recessed), ceilingY)
  })
})

describe('display state and site.presentation (owner decision O3, frozen)', () => {
  /** Explicit local toggles > site.presentation > theme default; canonical ignores all. */
  const effectiveMode = (
    local: DisplayMode | undefined,
    site: SitePresentation | undefined,
    themeDefault: DisplayMode,
  ) => local ?? site?.display?.mode ?? themeDefault
  const canonicalFamilies = (_local?: DisplayMode, _site?: SitePresentation) => 'all' as const

  test('precedence and canonical independence', () => {
    const site: SitePresentation = { display: { mode: 'construction' } }
    expect(effectiveMode('systems', site, 'finished')).toBe('systems')
    expect(effectiveMode(undefined, site, 'finished')).toBe('construction')
    expect(effectiveMode(undefined, undefined, 'finished')).toBe('finished')
    expect(canonicalFamilies('systems', site)).toBe('all')
  })
})

describe('section library and definition pinning (owner decision O4, frozen)', () => {
  const library: readonly SectionLibraryEntry[] = Object.freeze([
    {
      id: 'lumber/2x6',
      v: 1,
      source: 'core',
      profile: { kind: 'rectangle', width: 0.038, depth: 0.14 },
      ride: [0, 0],
    },
    {
      id: 'casing/colonial',
      v: 1,
      source: 'preset',
      profile: { kind: 'rectangle', width: 0.07, depth: 0.018 },
      ride: [-0.035, 0],
    },
    {
      id: 'casing/colonial',
      v: 2,
      source: 'preset',
      profile: { kind: 'rectangle', width: 0.075, depth: 0.018 },
      ride: [-0.0375, 0],
    },
  ] satisfies SectionLibraryEntry[])

  /** A ref resolves to exactly its pinned version, offline; never to "latest". */
  function resolve(profile: SectionProfile): ResolvedSectionProfile | { diagnostic: string } {
    if (profile.kind !== 'ref') return profile
    const entry = library.find((e) => e.id === profile.id && e.v === profile.v)
    return entry ? entry.profile : { diagnostic: 'section-unresolved' }
  }

  /** Content hash of a resolved definition: sha256 over its canonical JSON. */
  /** RFC 8785 (JCS): sorted keys, no whitespace, ECMAScript numbers and strings. */
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (value !== null && typeof value === 'object')
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
        )
        .join(',')}}`
    return JSON.stringify(value)
  }
  const hashOf = (definition: unknown): `sha256:${string}` =>
    `sha256:${createHash('sha256').update(canonicalJson(definition), 'utf8').digest('hex')}`

  /** Both pin arms resolve offline against pinned entries, never to "latest". */
  function resolvePin(pin: DefinitionPin): ResolvedSectionProfile | { diagnostic: string } {
    let entry: SectionLibraryEntry | undefined
    if ('hash' in pin) entry = library.find((e) => hashOf(e.profile) === pin.hash)
    else if ('id' in pin) entry = library.find((e) => e.id === pin.id && e.v === pin.v)
    else {
      const unreachable: never = pin
      return unreachable
    }
    return entry ? entry.profile : { diagnostic: 'definition-unresolved' }
  }

  test('both DefinitionPin arms resolve: { id, v } and { hash }', () => {
    const byVersion: DefinitionPin = { id: 'casing/colonial', v: 1 }
    const v1 = library[1]!.profile
    const byHash: DefinitionPin = { hash: hashOf(v1) }
    expect(resolvePin(byVersion)).toEqual(v1)
    expect(resolvePin(byHash)).toEqual(v1)
    // The hash names content: v2's correction has a different hash, so a
    // scene pinned to v1's hash keeps v1's geometry.
    expect(hashOf(library[2]!.profile)).not.toBe(byHash.hash)
    expect(resolvePin({ hash: `sha256:${'0'.repeat(64)}` })).toEqual({
      diagnostic: 'definition-unresolved',
    })
    expect(resolvePin({ id: 'casing/colonial', v: 3 })).toEqual({
      diagnostic: 'definition-unresolved',
    })
    // @ts-expect-error a pin is a version or a hash, never both
    const both: DefinitionPin = { id: 'casing/colonial', v: 1, hash: byHash.hash }
    expect(both).toBeDefined()
  })

  test('the hash serialization is canonical (RFC 8785): key order never changes it', () => {
    const polygon = {
      kind: 'polygon',
      outer: [
        [0, 0],
        [0.07, 0],
        [0.07, 0.018],
      ],
    }
    const reordered = {
      outer: [
        [0, 0],
        [0.07, 0],
        [0.07, 0.018],
      ],
      kind: 'polygon',
    }
    expect(canonicalJson(polygon)).toBe('{"kind":"polygon","outer":[[0,0],[0.07,0],[0.07,0.018]]}')
    expect(hashOf(reordered)).toBe(hashOf(polygon))
    expect(hashOf({ ...polygon, outer: [[0, 0]] })).not.toBe(hashOf(polygon))
  })

  test('pins by version; a correction never moves saved geometry', () => {
    expect(resolve({ kind: 'ref', id: 'casing/colonial', v: 1 })).toEqual({
      kind: 'rectangle',
      width: 0.07,
      depth: 0.018,
    })
    expect(resolve({ kind: 'ref', id: 'casing/colonial', v: 3 })).toEqual({
      diagnostic: 'section-unresolved',
    })
    const inline: SectionProfile = { kind: 'round', radius: 0.02 }
    expect(resolve(inline)).toBe(inline)
    expect(Object.isFrozen(library)).toBe(true)
    expect(library.filter((e) => e.source === 'core').map((e) => e.id)).toEqual(['lumber/2x6'])
  })
})

describe('connection ends (F6): declared ports and run-body taps', () => {
  /** A run in level-local metres: three legs. */
  const run: FidelityV3[] = [
    [0, 2.7, 0],
    [4, 2.7, 0],
    [4, 2.7, 3],
  ]
  const ports: Record<string, FidelityV3> = { start: run[0]!, end: run[2]! }

  /** A `tap` end sits `at` metres of arc length from the run's start. */
  function stationPoint(path: readonly FidelityV3[], at: number): V3 | null {
    let remaining = at
    for (let i = 1; i < path.length; i++) {
      const leg = sub(path[i]!, path[i - 1]!)
      const length = Math.hypot(...leg)
      if (remaining <= length) return add(path[i - 1]!, scale(leg, remaining / length))
      remaining -= length
    }
    return null
  }
  function resolveEnd(end: PortRef): V3 | null {
    switch (end.kind) {
      case 'port':
        return ports[end.portId] ? [...ports[end.portId]!] : null
      case 'tap':
        return stationPoint(run, end.at)
    }
  }

  test('a branch tapped midway along a duct resolves to the body station', () => {
    const tap: PortRef = { kind: 'tap', nodeId: 'duct-segment_a' as AnyNodeId, at: 5.5 }
    const port: PortRef = { kind: 'port', nodeId: 'duct-segment_a' as AnyNodeId, portId: 'end' }
    expect(resolveEnd(tap)).toEqual([4, 2.7, 1.5])
    expect(resolveEnd(port)).toEqual([4, 2.7, 3])
    expect(resolveEnd({ ...tap, at: 7.5 })).toBeNull()
  })
})

describe('bake profiles (F4): canonical carries every family and omits nothing', () => {
  const canonical: PascalBakeExtras = { profile: 'canonical', families: 'all' }
  const lightweight: PascalBakeExtras = {
    profile: 'lightweight',
    families: 'all',
    omissions: ['cmu-cores'],
  }
  // @ts-expect-error a canonical artifact cannot declare partial families
  const partial: PascalBakeExtras = { profile: 'canonical', families: ['finish'] }
  // @ts-expect-error a canonical artifact cannot declare omissions
  const omitting: PascalBakeExtras = { profile: 'canonical', families: 'all', omissions: ['x'] }
  // @ts-expect-error a lightweight artifact must declare its omissions
  const undeclared: PascalBakeExtras = { profile: 'lightweight', families: 'all' }

  /** The harness accepts only a complete canonical bake. */
  const harnessAccepts = (extras: PascalBakeExtras) =>
    extras.profile === 'canonical' && extras.families === 'all' && extras.omissions === undefined

  test('the harness accepts canonical and refuses everything else', () => {
    expect(harnessAccepts(canonical)).toBe(true)
    expect(harnessAccepts(lightweight)).toBe(false)
    expect(harnessAccepts({ profile: 'finished', families: ['finish', 'device'] })).toBe(false)
    for (const invalid of [partial, omitting, undeclared])
      expect(harnessAccepts(invalid)).toBe(false)
  })
})

describe('kernel host seam', () => {
  test('wraps the store seam instead of adding a second one', () => {
    const nodes = {} as Record<AnyNodeId, AnyNode>
    const store = {
      getState: () => ({
        nodes,
        rootNodeIds: [] as AnyNodeId[],
        dirtyNodes: new Set<AnyNodeId>(),
        createNode: () => {},
        updateNode: () => {},
        deleteNode: () => {},
        markDirty: () => {},
      }),
      temporal: { getState: () => ({ pause: () => {}, resume: () => {} }) },
    }
    const host: SceneToolHost = { store, getActiveLevelId: () => null }
    expect(createSceneApi(host.store).nodes()).toBe(nodes)
    expect(host.getSelection?.() ?? []).toEqual([])
  })
})
