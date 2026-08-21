import { describe, expect, test } from 'bun:test'
import { createWallRayHitClassifier, type HitOwnerDeps } from './selection-hit-owner'

// Ownership resolution for the hidden-wall nearest-first rule: each hit is
// classified by its NEAREST sceneRegistry-registered ancestor. This is what
// keeps passive geometry — Bones framing InstancedMeshes riding the level
// wrapper's pointer handlers into event.intersections (QA f2 probe6), the
// wall's own render mesh, the grid — from outranking a hidden wall, while
// real selection targets (furniture, devices, openings) still do.

type Obj = { name?: string; parent?: Obj | null }
const node = (parent: Obj | null, name?: string): Obj => ({ name, parent })

/** A tiny fake scene graph + registry, mirroring the live editor's shape. */
function buildFixture() {
  const levelGroup = node(null, 'level-wrapper') // carries pointer handlers live
  const wallRoot = node(levelGroup, 'wall-mesh')
  const wallCollision = node(wallRoot, 'collision-mesh')
  const wallTrim = node(node(wallRoot), 'trim')
  const doorRoot = node(wallRoot, 'door-root')
  const doorPanel = node(node(doorRoot), 'panel')
  const otherWallRoot = node(levelGroup, 'wall-mesh')
  const framingRoot = node(levelGroup, 'framing-root')
  const framingMember = node(node(framingRoot), 'Mesh') // InstancedMesh bucket
  const deviceRoot = node(levelGroup, 'device-root')
  const deviceBox = node(deviceRoot, 'box')
  const bedRoot = node(levelGroup, 'bed-root')
  const bedMesh = node(node(bedRoot), 'bed_015')
  const zoneRoot = node(levelGroup, 'zone-root')
  const gizmo = node(null, 'arrow-handle') // never registered

  const registered: [string, object][] = [
    ['level1', levelGroup],
    ['wallA', wallRoot],
    ['wallB', otherWallRoot],
    ['door1', doorRoot],
    ['framing1', framingRoot],
    ['device1', deviceRoot],
    ['bed1', bedRoot],
    ['zone1', zoneRoot],
  ]
  const kinds: Record<string, string> = {
    level1: 'level',
    wallA: 'wall',
    wallB: 'wall',
    door1: 'door',
    framing1: 'bones:framing',
    device1: 'bones:device',
    bed1: 'item',
    zone1: 'zone',
  }

  let revision = 1
  const deps: HitOwnerDeps = {
    registryRevision: () => revision,
    registeredEntries: () => registered.values(),
    kindOf: (id) => kinds[id],
    // Plugin registry: bones:device declares `selectable`, bones:framing
    // does not (panel-only UI, hidden in 3D).
    isRegistrySelectableKind: (kind) => kind === 'bones:device',
  }

  return {
    deps,
    bumpRevision: (mutate: () => void) => {
      mutate()
      revision += 1
    },
    registered,
    kinds,
    objects: {
      wallCollision,
      wallTrim,
      doorPanel,
      otherWallRoot,
      framingMember,
      deviceBox,
      bedMesh,
      zoneRoot,
      gizmo,
      levelGroup,
    },
  }
}

describe('createWallRayHitClassifier', () => {
  test("own collision / trim meshes are 'self-wall'; another wall is 'other-wall'", () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.wallCollision)).toBe('self-wall')
    expect(classify(objects.wallTrim)).toBe('self-wall')
    expect(classify(objects.otherWallRoot)).toBe('other-wall')
  })

  test('hosted door meshes resolve to the DOOR (registered deeper than the host wall)', () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.doorPanel)).toBe('selectable')
  })

  test("framing members are 'passive' — registered overlay node without the selectable capability", () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.framingMember)).toBe('passive')
  })

  test('plugin device boxes are selectable via the registry capability', () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.deviceBox)).toBe('selectable')
  })

  test('furniture resolves to its item node — selectable', () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.bedMesh)).toBe('selectable')
  })

  test("level wrappers and zones are 'passive' — QA's rule: wrapper-owned hits must not outrank", () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    // A hit whose nearest registered ancestor is the LEVEL wrapper itself.
    expect(classify(objects.levelGroup)).toBe('passive')
    expect(classify(objects.zoneRoot)).toBe('passive')
  })

  test("unregistered ancestry (gizmos, grid) is 'passive'", () => {
    const { deps, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.gizmo)).toBe('passive')
  })

  test("a registered id whose node is gone from the scene is 'passive'", () => {
    const { deps, kinds, objects } = buildFixture()
    delete kinds.bed1
    const classify = createWallRayHitClassifier('wallA', deps)
    expect(classify(objects.bedMesh)).toBe('passive')
  })

  test('the reverse lookup follows registry revisions (late-registering nodes classify)', () => {
    const { deps, bumpRevision, registered, kinds, objects } = buildFixture()
    const classify = createWallRayHitClassifier('wallA', deps)
    // Prime the cache…
    expect(classify(objects.bedMesh)).toBe('selectable')
    // …then a new selectable node registers (plugin load, new furniture).
    const lateRoot: Obj = { name: 'late-root', parent: objects.levelGroup }
    const lateMesh: Obj = { name: 'late-mesh', parent: lateRoot }
    expect(classify(lateMesh)).toBe('passive') // cached map: not registered yet
    bumpRevision(() => {
      registered.push(['late1', lateRoot as object])
      kinds.late1 = 'item'
    })
    expect(classify(lateMesh)).toBe('selectable')
  })
})
