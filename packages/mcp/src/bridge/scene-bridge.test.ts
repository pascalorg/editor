import { beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SiteNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from './scene-bridge'

function tick() {
  return new Promise((r) => setTimeout(r, 5))
}

describe('SceneBridge', () => {
  let bridge: SceneBridge

  beforeEach(() => {
    bridge = new SceneBridge()
    // Ensure a clean slate even if a prior test left store state around
    // (the core store is a module-singleton).
    bridge.setScene({}, [])
    bridge.clearHistory()
    bridge.loadDefault()
    bridge.clearHistory()
    bridge.flushDirty()
  })

  describe('loadDefault / getters', () => {
    test('creates default Site → Building → Level', () => {
      const nodes = bridge.getNodes()
      const types = Object.values(nodes)
        .map((n) => n.type)
        .sort()
      expect(types).toEqual(['building', 'level', 'site'])
      expect(bridge.getRootNodeIds().length).toBe(1)
    })

    test('loadDefault is idempotent when scene already loaded', () => {
      const before = Object.keys(bridge.getNodes()).length
      bridge.loadDefault()
      const after = Object.keys(bridge.getNodes()).length
      expect(after).toBe(before)
    })

    test('getNode returns the node by id', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const fetched = bridge.getNode(level.id)
      expect(fetched?.id).toBe(level.id)
    })

    test('getNode returns null for unknown id', () => {
      expect(bridge.getNode('wall_does_not_exist')).toBeNull()
    })
  })

  describe('createNode', () => {
    test('creates a wall attached to a level', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
      const id = bridge.createNode(wall, level.id)
      expect(id).toBe(wall.id)
      expect(bridge.getNode(wall.id)).not.toBeNull()
      // Level should list the wall as a child.
      const freshLevel = bridge.getNode(level.id) as any
      expect(freshLevel.children).toContain(wall.id)
    })

    test('created wall has the correct parentId', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const w = bridge.getNode(wall.id)!
      expect(w.parentId).toBe(level.id)
    })
  })

  describe('updateNode', () => {
    test('merges new fields on existing node', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
      bridge.createNode(wall, level.id)
      bridge.updateNode(wall.id, { thickness: 0.25, height: 3 } as any)
      await tick()
      const w = bridge.getNode(wall.id) as any
      expect(w.thickness).toBe(0.25)
      expect(w.height).toBe(3)
    })

    test('throws on unknown id', () => {
      expect(() => bridge.updateNode('wall_missing' as any, { height: 3 } as any)).toThrow(
        /node not found/,
      )
    })
  })

  describe('deleteNode', () => {
    test('deletes a leaf node', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const removed = bridge.deleteNode(wall.id)
      expect(removed).toContain(wall.id)
      expect(bridge.getNode(wall.id)).toBeNull()
    })

    test('cascade=false throws if node has children', () => {
      // Level (with a child wall) — deleting non-cascaded must throw.
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      expect(() => bridge.deleteNode(level.id, false)).toThrow(/descendant/)
      // Node still exists.
      expect(bridge.getNode(level.id)).not.toBeNull()
      expect(bridge.getNode(wall.id)).not.toBeNull()
    })

    test('cascade=true removes node and all descendants', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall1 = WallNode.parse({ start: [0, 0], end: [1, 0] })
      const wall2 = WallNode.parse({ start: [1, 0], end: [1, 1] })
      bridge.createNode(wall1, level.id)
      bridge.createNode(wall2, level.id)
      const removed = bridge.deleteNode(level.id, true)
      expect(removed).toContain(level.id)
      expect(removed).toContain(wall1.id)
      expect(removed).toContain(wall2.id)
      expect(bridge.getNode(level.id)).toBeNull()
      expect(bridge.getNode(wall1.id)).toBeNull()
    })

    test('throws on unknown id', () => {
      expect(() => bridge.deleteNode('wall_nope' as any, false)).toThrow(/node not found/)
    })
  })

  describe('undo / redo', () => {
    test('round-trips create + update', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
      bridge.createNode(wall, level.id)
      await tick()
      bridge.updateNode(wall.id, { thickness: 0.25 } as any)
      await tick()

      // Undo update
      const u1 = bridge.undo()
      await tick()
      expect(u1).toBe(1)
      const w1 = bridge.getNode(wall.id) as any
      expect(w1).not.toBeNull()
      expect(w1.thickness).not.toBe(0.25)

      // Undo create — wall should be gone
      const u2 = bridge.undo()
      await tick()
      expect(u2).toBe(1)
      expect(bridge.getNode(wall.id)).toBeNull()

      // Redo both
      const r = bridge.redo(2)
      await tick()
      expect(r).toBe(2)
      const w3 = bridge.getNode(wall.id) as any
      expect(w3).not.toBeNull()
      expect(w3.thickness).toBe(0.25)
    })

    test('getHistory tracks pointers', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      await tick()
      let h = bridge.getHistory()
      expect(h.pastCount).toBe(1)
      expect(h.futureCount).toBe(0)
      bridge.undo()
      await tick()
      h = bridge.getHistory()
      expect(h.pastCount).toBe(0)
      expect(h.futureCount).toBe(1)
    })

    test('clearHistory wipes past/future', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      bridge.createNode(WallNode.parse({ start: [0, 0], end: [1, 0] }), level.id)
      await tick()
      bridge.clearHistory()
      const h = bridge.getHistory()
      expect(h.pastCount).toBe(0)
      expect(h.futureCount).toBe(0)
    })

    test('undo/redo without history returns 0', () => {
      bridge.clearHistory()
      expect(bridge.undo()).toBe(0)
      expect(bridge.redo()).toBe(0)
    })
  })

  describe('applyPatch', () => {
    test('applies mixed create/update/delete atomically', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wallA = WallNode.parse({ start: [0, 0], end: [2, 0] })
      const wallB = WallNode.parse({ start: [2, 0], end: [2, 2] })
      // pre-seed one wall, then exercise update + delete
      bridge.createNode(wallA, level.id)
      await tick()

      const res = bridge.applyPatch([
        { op: 'create', node: wallB, parentId: level.id },
        { op: 'update', id: wallA.id, data: { thickness: 0.3 } as any },
        { op: 'delete', id: wallA.id },
      ])
      await tick()

      expect(res.appliedOps).toBe(3)
      expect(res.createdIds).toContain(wallB.id)
      expect(res.deletedIds).toContain(wallA.id)
      expect(bridge.getNode(wallA.id)).toBeNull()
      expect(bridge.getNode(wallB.id)).not.toBeNull()
    })

    test('is all-or-nothing: invalid op rolls back no changes', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const pre = Object.keys(bridge.getNodes()).length
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      expect(() =>
        bridge.applyPatch([
          { op: 'create', node: wall, parentId: level.id },
          // This op is invalid — id does not exist.
          { op: 'update', id: 'wall_missing' as any, data: { thickness: 0.1 } as any },
        ]),
      ).toThrow(/invalid patch/)
      // The wall must NOT have been created.
      expect(bridge.getNode(wall.id)).toBeNull()
      // Node count is unchanged.
      expect(Object.keys(bridge.getNodes()).length).toBe(pre)
    })

    test('rejects create with non-existent parentId', () => {
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      expect(() =>
        bridge.applyPatch([{ op: 'create', node: wall, parentId: 'level_nope' as any }]),
      ).toThrow(/invalid patch/)
    })

    test('rejects delete of unknown id', () => {
      expect(() => bridge.applyPatch([{ op: 'delete', id: 'wall_nope' as any }])).toThrow(
        /invalid patch/,
      )
    })

    test('rejects delete with cascade=false on a node with children', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      bridge.createNode(WallNode.parse({ start: [0, 0], end: [1, 0] }), level.id)
      await tick()
      expect(() => bridge.applyPatch([{ op: 'delete', id: level.id, cascade: false }])).toThrow(
        /invalid patch/,
      )
    })

    test('accepts delete with cascade=true on a node with children', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      await tick()
      const res = bridge.applyPatch([{ op: 'delete', id: level.id, cascade: true }])
      expect(res.deletedIds).toContain(level.id)
      expect(res.deletedIds).toContain(wall.id)
    })

    test('rejects create with schema-invalid node', () => {
      // Bypass .parse so we can feed an invalid node through the union.
      const bogus = {
        object: 'node',
        id: 'wall_bogus',
        type: 'wall',
        // missing start/end
      } as any
      expect(() => bridge.applyPatch([{ op: 'create', node: bogus }])).toThrow(/invalid patch/)
    })

    test('rejects unknown op', () => {
      expect(() => bridge.applyPatch([{ op: 'wat', id: 'x' } as any])).toThrow(/invalid patch/)
    })

    test('rejects update with non-object data', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      expect(() => bridge.applyPatch([{ op: 'update', id: level.id, data: null as any }])).toThrow(
        /invalid patch/,
      )
    })

    test('rejects undefined patch entry', () => {
      expect(() => bridge.applyPatch([undefined as any])).toThrow(/invalid patch/)
    })
  })

  describe('validateScene', () => {
    test('returns valid for default scene', () => {
      const res = bridge.validateScene()
      expect(res.valid).toBe(true)
      expect(res.errors).toEqual([])
    })

    test('flags bad nodes fed in via setScene', () => {
      const site = SiteNode.parse({})
      // Bypass the schema by constructing a bogus wall object directly.
      const bogus = {
        object: 'node',
        id: 'wall_bogus',
        type: 'wall',
        parentId: site.id,
        // missing required `start`/`end`
      } as any
      bridge.setScene({ [site.id]: site, [bogus.id]: bogus }, [site.id])
      const res = bridge.validateScene()
      expect(res.valid).toBe(false)
      expect(res.errors.some((e) => e.nodeId === 'wall_bogus')).toBe(true)
    })
  })

  describe('traversal: site quirk & generic helpers', () => {
    test('getChildren uses the flat dict (handles site children-as-objects)', () => {
      const site = bridge.findNodes({ type: 'site' })[0]!
      const children = bridge.getChildren(site.id)
      // Building is the expected child of site via parentId.
      const types = children.map((c) => c.type).sort()
      expect(types).toContain('building')
    })

    test('getChildren works for level (children-as-ids)', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const children = bridge.getChildren(level.id)
      expect(children.map((c) => c.id)).toContain(wall.id)
    })

    test('getAncestry walks to root', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const ancestry = bridge.getAncestry(wall.id)
      const types = ancestry.map((n) => n.type)
      expect(types[0]).toBe('wall')
      expect(types).toContain('level')
      expect(types).toContain('building')
      expect(types).toContain('site')
    })

    test('getAncestry returns [] for unknown id', () => {
      expect(bridge.getAncestry('wall_nope' as any)).toEqual([])
    })

    test('resolveLevelId returns the enclosing level', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      expect(bridge.resolveLevelId(wall.id)).toBe(level.id)
    })

    test('resolveLevelId returns null if no level ancestor', () => {
      // Site itself has no level ancestor.
      const site = bridge.findNodes({ type: 'site' })[0]!
      expect(bridge.resolveLevelId(site.id)).toBeNull()
    })

    test('findNodes filters by type', () => {
      const levels = bridge.findNodes({ type: 'level' })
      expect(levels.length).toBe(1)
      expect(levels[0]?.type).toBe('level')
    })

    test('findNodes filters by parentId', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const childrenOfLevel = bridge.findNodes({ parentId: level.id })
      expect(childrenOfLevel.map((n) => n.id)).toContain(wall.id)
    })

    test('findNodes filters by levelId (via ancestry)', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      const door = DoorNode.parse({ wallId: wall.id })
      bridge.createNode(door, wall.id)
      // Door lives under wall→level; findNodes with levelId should match.
      const filtered = bridge.findNodes({ type: 'door', levelId: level.id })
      expect(filtered.map((n) => n.id)).toContain(door.id)
    })

    test('findNodes with parentId: null finds roots', () => {
      const roots = bridge.findNodes({ parentId: null })
      expect(roots.map((n) => n.type)).toContain('site')
    })
  })

  describe('setScene / exportJSON / loadJSON', () => {
    test('exportJSON returns the scene shape', () => {
      const exp = bridge.exportJSON()
      expect(typeof exp.nodes).toBe('object')
      expect(Array.isArray(exp.rootNodeIds)).toBe(true)
      expect(exp.rootNodeIds.length).toBe(1)
    })

    test('exportJSON deep-clones (mutation does not leak back)', () => {
      const exp = bridge.exportJSON()
      const someId = Object.keys(exp.nodes)[0]!
      ;(exp.nodes as any)[someId] = 'tampered'
      // Store is unchanged.
      expect(typeof bridge.getNodes()[someId]).toBe('object')
    })

    test('loadJSON accepts a parsed object', () => {
      const snap = bridge.exportJSON()
      // Unload first so loadJSON does the heavy lift.
      bridge.setScene({}, [])
      bridge.loadJSON(snap)
      expect(Object.keys(bridge.getNodes()).length).toBe(Object.keys(snap.nodes).length)
    })

    test('loadJSON accepts a JSON string', () => {
      const snap = bridge.exportJSON()
      const str = JSON.stringify(snap)
      bridge.setScene({}, [])
      bridge.loadJSON(str)
      expect(Object.keys(bridge.getNodes()).length).toBe(Object.keys(snap.nodes).length)
    })

    test('loadJSON throws on malformed JSON string', () => {
      expect(() => bridge.loadJSON('not json')).toThrow(/invalid JSON/)
    })

    test('loadJSON throws when parsed JSON is not an object', () => {
      expect(() => bridge.loadJSON('null')).toThrow(/expected object/)
      expect(() => bridge.loadJSON(null as any)).toThrow(/expected object/)
    })

    test('loadJSON throws on wrong top-level shape', () => {
      expect(() => bridge.loadJSON({} as any)).toThrow(/invalid scene/)
      expect(() => bridge.loadJSON({ nodes: 1, rootNodeIds: [] } as any)).toThrow(/invalid scene/)
      expect(() => bridge.loadJSON({ nodes: {}, rootNodeIds: 'nope' } as any)).toThrow(
        /invalid scene/,
      )
    })

    test('loadJSON rejects prototype-polluting keys in string form', () => {
      const bad = '{"nodes": {"__proto__": {"polluted": true}}, "rootNodeIds": []}'
      expect(() => bridge.loadJSON(bad)).toThrow(/forbidden key/)
    })

    test('loadJSON rejects prototype-polluting keys in object form', () => {
      // Build object so the key is an actual own-property (not a prototype
      // assignment).
      const nodes: Record<string, unknown> = {}
      Object.defineProperty(nodes, '__proto__', {
        enumerable: true,
        configurable: true,
        writable: true,
        value: { polluted: true },
      })
      const bad = { nodes, rootNodeIds: [] }
      expect(() => bridge.loadJSON(bad as any)).toThrow(/forbidden key/)
    })

    test('setScene round-trip preserves node count', () => {
      const pre = Object.keys(bridge.getNodes()).length
      const snap = bridge.exportJSON()
      bridge.setScene({}, [])
      bridge.setScene(snap.nodes as any, snap.rootNodeIds as any)
      expect(Object.keys(bridge.getNodes()).length).toBe(pre)
    })
  })

  describe('flushDirty', () => {
    test('drains the dirty set', async () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
      bridge.createNode(wall, level.id)
      await tick()
      const drained = bridge.flushDirty()
      // Wall was just created, should have dirty-marked itself + parent.
      expect(drained.length).toBeGreaterThan(0)
      // Calling again drains nothing new.
      const again = bridge.flushDirty()
      expect(again.length).toBe(0)
    })
  })

  describe('composite nodes', () => {
    test('can build a small scene via LevelNode/BuildingNode helpers', () => {
      // Construct a second site via explicit schema parse to exercise
      // exportJSON/setScene on custom shapes.
      const level = LevelNode.parse({ level: 0, children: [] })
      const building = BuildingNode.parse({ children: [level.id] })
      const site = SiteNode.parse({ children: [] })
      bridge.setScene(
        {
          [site.id]: { ...site, children: [] } as any,
          [building.id]: { ...building, parentId: site.id } as any,
          [level.id]: { ...level, parentId: building.id } as any,
        },
        [site.id],
      )
      expect(bridge.getNodes()[site.id]).toBeDefined()
      expect(bridge.resolveLevelId(level.id)).toBe(level.id)
    })

    test('zone and item nodes are creatable and discoverable', () => {
      const level = bridge.findNodes({ type: 'level' })[0]!
      const zone = ZoneNode.parse({
        name: 'Zone A',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      })
      bridge.createNode(zone, level.id)

      const item = ItemNode.parse({
        asset: {
          id: 'asset_test',
          category: 'test',
          name: 'Test Asset',
          thumbnail: 'data:image/png;base64,',
          src: 'data:model/gltf-binary;base64,',
        },
      })
      // Place item directly on level — ItemNode supports arbitrary parents in the model.
      bridge.createNode(item, level.id)

      const zones = bridge.findNodes({ type: 'zone' })
      const items = bridge.findNodes({ type: 'item' })
      expect(zones.map((n) => n.id)).toContain(zone.id)
      expect(items.map((n) => n.id)).toContain(item.id)
    })
  })
})
