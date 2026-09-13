/**
 * Florida demo — furnish and site the `plancrafters-cottage` scene.
 *
 *   bun scripts/demo/furnish-cottage.ts            (writes to the local API)
 *   bun scripts/demo/furnish-cottage.ts --dry-run  (prints what it would do)
 *
 * What it does, idempotently (everything it creates carries
 * `metadata.createdBy = 'demo-furnish'` and is replaced on the next run):
 *   1. Sites the house inside the setback envelope of the Tampa lot.
 *   2. Gives every exterior wall a cited 2x6 lap-siding assembly and every
 *      partition the 2x4 drywall assembly (packages/core wall-assembly presets).
 *   3. Detects the rooms from the walls (core `detectSpacesForLevel`) and
 *      creates one ROOM zone per space with a real name, number, finishes and
 *      the 9'-0" ceiling — the room labels and room schedule come from these.
 *   4. Furnishes the house with REAL Pascal library items (the same catalog
 *      the Items panel places, with their 3D models and plan symbols):
 *      kitchen run with sink block / range / fridge / dishwasher / hood /
 *      upper cabinets, dining, living, three bedrooms, two baths, laundry,
 *      walk-in closet, panel, thermostat, condenser.
 *   5. Moves the utility pole to the right-of-way at the front lot line and
 *      lands the overhead service drop on the electric meter on the east
 *      wall by the laundry (the panel is inside that wall).
 *
 * Coordinates: level-local metres, x east, z south (plan y). The building's
 * own placement (`building.position`) puts the level frame on the lot.
 */
import {
  assemblyThickness,
  detectSpacesForLevel,
  generateId,
  getWallAssemblyPreset,
  ItemNode,
  ZoneNode,
} from '@pascal-app/core'
import { CATALOG_ITEMS } from '../../packages/editor/src/components/ui/item-catalog/catalog-items'

const API = process.env.PASCAL_API ?? 'http://localhost:3002'
const SCENE_ID = process.env.PASCAL_SCENE ?? 'plancrafters-cottage'
const DRY_RUN = process.argv.includes('--dry-run')
const TAG = 'demo-furnish'

type Node = Record<string, any>
type Graph = { nodes: Record<string, Node>; rootNodeIds: string[]; [k: string]: unknown }

const SLAB_TOP = 0.05 // slab `elevation` in the scene — items rest on it
const DEG = Math.PI / 180

function main() {
  return (async () => {
    const res = await fetch(`${API}/api/scenes/${SCENE_ID}`)
    if (!res.ok) throw new Error(`GET scene failed: ${res.status}`)
    const scene = (await res.json()) as { version: number; graph: Graph }
    const graph = scene.graph
    const nodes = graph.nodes

    // ── 0. Remove what a previous run created ────────────────────────
    for (const [id, node] of Object.entries(nodes)) {
      if (node.metadata?.createdBy === TAG) {
        delete nodes[id]
        for (const other of Object.values(nodes)) {
          if (Array.isArray(other.children)) {
            other.children = other.children.filter((c: string) => c !== id)
          }
        }
      }
    }

    const site = Object.values(nodes).find((n) => n.type === 'site')!
    const building = Object.values(nodes).find((n) => n.type === 'building')!
    const level = Object.values(nodes).find((n) => n.type === 'level')!
    const walls = Object.values(nodes).filter((n) => n.type === 'wall' && n.parentId === level.id)
    const byName = (name: string) => walls.find((w) => w.name === name)!

    // ── 1. Site the house inside the setback envelope ─────────────────
    // Lot ring (site metres): x ≈ −10.2…21.8, y ≈ 1.3…32.0; front (street) edge
    // is the north edge. Setbacks 25' front / 7' side / 20' rear. Centre the
    // house on the lot's x and hold 26'-6" off the front line.
    building.position = [5.7, 0, 16.5]
    building.rotation = [0, 0, 0]

    // ── 2. Wall assemblies (cited presets) ───────────────────────────
    const exteriorPreset = getWallAssemblyPreset('exterior-2x6-siding')!
    const interiorPreset = getWallAssemblyPreset('interior-2x4-drywall')!
    for (const wall of walls) {
      const exterior = wall.frontSide === 'exterior' || wall.backSide === 'exterior'
      const preset = exterior ? exteriorPreset : interiorPreset
      wall.assembly = structuredClone(preset.assembly)
      wall.thickness = assemblyThickness(preset.assembly)
    }
    const tExt = assemblyThickness(exteriorPreset.assembly)
    const tInt = assemblyThickness(interiorPreset.assembly)
    console.log(`walls: exterior ${(tExt * 39.37).toFixed(2)} in, interior ${(tInt * 39.37).toFixed(2)} in`)

    // ── 3. Rooms → zones ─────────────────────────────────────────────
    const detected = detectSpacesForLevel(level.id, walls as never)
    type RoomSpec = { name: string; number: string; floor: string; at: [number, number] }
    // Identified by a point inside each room (level-local metres).
    const ROOMS: RoomSpec[] = [
      { name: 'BEDROOM 2', number: '101', floor: 'LVP', at: [-3.0, -5.2] },
      { name: 'FOYER', number: '102', floor: 'TILE', at: [0, -5.2] },
      { name: 'BEDROOM 3', number: '103', floor: 'LVP', at: [3.0, -5.2] },
      { name: 'BATH 2', number: '104', floor: 'TILE', at: [-3.6, -2.6] },
      { name: 'HALL', number: '105', floor: 'LVP', at: [0, -2.6] },
      { name: 'LAUNDRY', number: '106', floor: 'TILE', at: [3.6, -2.6] },
      { name: 'GREAT ROOM', number: '107', floor: 'LVP', at: [-2.0, 0.3] },
      { name: 'KITCHEN', number: '108', floor: 'LVP', at: [2.7, 0.3] },
      { name: 'PRIMARY BEDROOM', number: '109', floor: 'LVP', at: [-2.7, 4.7] },
      { name: 'PRIMARY BATH', number: '110', floor: 'TILE', at: [0.6, 3.8] },
      { name: 'WIC', number: '111', floor: 'LVP', at: [0.6, 6.0] },
      { name: 'DINING', number: '112', floor: 'LVP', at: [3.3, 4.7] },
    ]
    const inside = (poly: [number, number][], p: [number, number]) => {
      let ok = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!
        const [xj, yj] = poly[j]!
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ok = !ok
      }
      return ok
    }
    const levelChildren: string[] = Array.isArray(level.children) ? level.children : []
    let zonesMade = 0
    for (const space of detected.spaces) {
      if (space.isExterior) continue
      const spec = ROOMS.find((r) => inside(space.polygon, r.at))
      if (!spec) {
        console.warn('unnamed space at', space.polygon[0])
        continue
      }
      const zone = ZoneNode.parse({
        id: generateId('zone'),
        type: 'zone',
        name: spec.name,
        parentId: level.id,
        polygon: space.polygon,
        autoFromWalls: true,
        boundaryWallIds: space.wallIds,
        spaceRole: 'room',
        roomNumber: spec.number,
        floorFinish: spec.floor,
        wallFinish: 'GWB, PAINT',
        ceilingFinish: 'GWB, PAINT',
        ceilingHeight: 2.7432, // 9'-0"
        enclosureStatus: 'auto',
        color: '#0ea5e9',
        metadata: { createdBy: TAG },
      })
      nodes[zone.id] = zone
      levelChildren.push(zone.id)
      zonesMade++
    }
    level.children = levelChildren
    console.log(`zones: ${zonesMade} of ${ROOMS.length} rooms named`)

    // ── 4. Furniture, cabinets, fixtures — real catalog items ─────────
    const catalog = new Map(CATALOG_ITEMS.map((item) => [item.id, item]))
    const asset = (id: string) => {
      const found = catalog.get(id)
      if (!found) throw new Error(`catalog item ${id} not found`)
      const { tool: _tool, ...rest } = found as typeof found & { tool?: string }
      return rest
    }

    let itemsMade = 0
    /** Floor item at (x, z), yaw in degrees about +Y, optional scale/name/y. */
    const place = (
      id: string,
      x: number,
      z: number,
      yawDeg = 0,
      opts: { scale?: [number, number, number]; name?: string; y?: number } = {},
    ) => {
      const node = ItemNode.parse({
        id: generateId('item'),
        type: 'item',
        name: opts.name ?? asset(id).name,
        parentId: level.id,
        position: [x, opts.y ?? SLAB_TOP, z],
        rotation: [0, yawDeg * DEG, 0],
        scale: opts.scale ?? [1, 1, 1],
        asset: asset(id),
        metadata: { createdBy: TAG },
      })
      nodes[node.id] = node
      levelChildren.push(node.id)
      itemsMade++
      return node
    }
    /**
     * Wall-side item on `wall`, `along` metres from wall.start, `height` to the
     * item's base, on the face that looks at `toward` (a point in the room).
     * Position is WALL-LOCAL: [along, height, ±thickness/2]; the item's local
     * +Z points off the wall, so the back face gets the π flip.
     */
    const mount = (
      id: string,
      wall: Node,
      along: number,
      height: number,
      toward: [number, number],
      opts: { scale?: [number, number, number]; name?: string } = {},
    ) => {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const len = Math.hypot(dx, dz)
      const frontNormal = [-dz / len, dx / len]
      const mid = [wall.start[0] + dx / 2, wall.start[1] + dz / 2]
      const dot = (toward[0] - mid[0]) * frontNormal[0] + (toward[1] - mid[1]) * frontNormal[1]
      const side = dot >= 0 ? 'front' : 'back'
      const node = ItemNode.parse({
        id: generateId('item'),
        type: 'item',
        name: opts.name ?? asset(id).name,
        parentId: wall.id,
        wallId: wall.id,
        wallT: along / len,
        side,
        position: [along, height, (wall.thickness / 2) * (side === 'front' ? 1 : -1)],
        rotation: [0, side === 'back' ? Math.PI : 0, 0],
        scale: opts.scale ?? [1, 1, 1],
        asset: asset(id),
        metadata: { createdBy: TAG },
      })
      nodes[node.id] = node
      wall.children = [...(wall.children ?? []), node.id]
      itemsMade++
      return node
    }

    // Room interiors (metres): exterior faces at ±(4.877 − tExt/2), ±(7.01 − tExt/2);
    // partitions at their centrelines ± tInt/2. Rooms listed above.
    const N_WALL_KITCHEN_EAST = byName('LAUNDRY + KITCHEN') // z = -1.829, x 2.438…4.877
    const N_WALL_KITCHEN_WEST = byName('HALL + KITCHEN') // z = -1.829, x 0.61…2.438
    const EAST_WALL = walls.find((w) => w.name === 'Exterior wall' && w.start[0] > 4 && w.end[0] > 4)!
    const HALL_GREAT = byName('HALL + GREAT ROOM') // z = -1.829, x -2.438…0.61

    // Foyer
    place('coat-rack', -0.85, -6.5)
    place('indoor-plant', 0.85, -6.5)
    place('rectangular-carpet', 0, -5.1, 0, { scale: [0.6, 1, 0.6] })

    // Bedroom 2 (west window at z −5.18, door on the south wall at x −1.83)
    place('double-bed', -3.2, -5.9, 180)
    place('bedside-table', -4.5, -6.65)
    place('closet', -1.58, -5.9, 90)
    place('dresser', -3.9, -3.75, 180)

    // Bedroom 3 (east window at z −5.18, door on the south wall at x 1.83)
    place('double-bed', 3.2, -5.9, 180)
    place('bedside-table', 4.5, -6.65)
    place('closet', 1.58, -5.9, -90)
    place('office-table', 3.95, -3.75, 180)
    place('office-chair', 3.95, -4.45)

    // Bath 2 — 5 × 8: shower west, toilet and vanity on the north wall
    place('shower-square', -4.37, -2.89)
    place('toilet', -3.6, -2.93, 180)
    place('bathroom-sink', -2.95, -3.0, 180, { scale: [0.42, 1, 1], name: 'Vanity' })

    // Hall — thermostat on the great-room wall, hall side
    mount('thermostat', HALL_GREAT, 1.0, 1.45, [-1.4, -2.6])

    // Laundry — washer + dryer on the north wall, panel on the east wall
    place('washing-machine', 3.05, -3.0, 180, { name: 'Washer' })
    place('washing-machine', 3.7, -3.0, 180, { name: 'Dryer' })
    mount('electric-panel', EAST_WALL, 7.01 - 2.45, 1.05, [4.0, -2.6])

    // Great room — TV wall north, sofa facing it, west windows
    const tvStand = place('tv-stand', -3.2, -1.58)
    place('television', -3.2, -1.55, 0, { y: SLAB_TOP + 0.35 })
    void tvStand
    place('sofa', -3.0, 0.9, 180)
    place('coffee-table', -3.0, -0.3)
    place('rectangular-carpet', -3.0, 0.2, 0, { scale: [1.2, 1, 1.2] })
    place('lounge-chair', -0.35, 0.9, -90)
    place('floor-lamp', -0.4, -1.3)
    place('bookshelf', -1.2, 2.2, 180)
    place('indoor-plant', -4.5, 2.1)

    // Kitchen — L: north run (fridge, counter, range) and east run (dishwasher,
    // sink block under the window, counter), hood + uppers over the range.
    place('fridge', 1.05, -1.4)
    place('kitchen-counter', 2.27, -1.457, 0, { scale: [0.87, 1, 1] })
    place('stove', 3.6, -1.44, 0, { name: 'Range' })
    place('microwave', 2.3, -1.5, 0, { y: SLAB_TOP + 0.73 })
    place('dishwasher-movn72ls', 4.47, -1.3, -90)
    place('kitchen', 4.47, 0.28, -90, { name: 'Sink base + counter' })
    place('kitchen-counter', 4.47, 1.92, -90, { scale: [0.46, 1, 1] })
    mount('hood', N_WALL_KITCHEN_EAST, 3.6 - 2.438, 1.55, [3.6, 0])
    mount('kitchen-shelf', N_WALL_KITCHEN_EAST, 1.22, 1.45, [3.6, 0], { name: 'Upper cabinets' })
    mount('kitchen-shelf', N_WALL_KITCHEN_WEST, 0.95, 1.45, [1.5, 0], {
      name: 'Upper cabinets',
      scale: [0.7, 1, 1],
    })

    // Dining — table with four chairs, east windows
    place('dining-table', 3.34, 4.9, 90)
    place('dining-chair', 2.65, 4.35, 90)
    place('dining-chair', 2.65, 5.45, 90)
    place('dining-chair', 4.03, 4.35, -90)
    place('dining-chair', 4.03, 5.45, -90)
    place('indoor-plant', 2.25, 6.6)

    // Primary bedroom — bed on the south wall, dresser on the west wall
    place('double-bed', -2.6, 5.9)
    place('bedside-table', -3.7, 6.65)
    place('bedside-table', -1.5, 6.65)
    place('dresser', -4.45, 3.4, 90)
    place('lounge-chair', -1.2, 3.3, 90)
    place('round-carpet', -2.6, 4.2)

    // Primary bath — shower NE, toilet east, vanity north
    place('shower-square', 1.36, 2.9)
    place('toilet', 1.45, 4.2, -90)
    place('bathroom-sink', 0.1, 2.83, 180, { scale: [0.6, 1, 1], name: 'Vanity' })

    // WIC
    place('closet', 0.61, 6.6, 180)

    // Outside — condenser off the east wall by the laundry
    place('ac-block', 5.7, -2.6, 0, { name: 'AC condenser' })

    level.children = levelChildren
    console.log(`items: ${itemsMade}`)

    // ── 5. Utilities — pole in the right-of-way, drop to the meter ─────
    const pole = Object.values(nodes).find((n) => n.type === 'utility-pole')
    const line = Object.values(nodes).find((n) => n.type === 'utility-line')
    const meter = Object.values(nodes).find((n) => n.type === 'service-point')
    if (pole) {
      pole.position = [18.0, 0, -0.6] // site metres: ~2 m north of the front lot line
      pole.yaw = 0
    }
    if (meter) {
      meter.wallId = EAST_WALL.id
      meter.wallT = (7.01 - 2.45) / 14.0208 // by the laundry, beside the panel
      meter.height = 1.5
      meter.position = [0, 0, 0]
      meter.name = 'Electric meter'
    }
    if (line && pole && meter) {
      line.fromRef = pole.id
      line.toRef = meter.id
      line.routing = 'overhead'
      line.system = 'power'
      // A straight span; both ends are derived from the pole and the meter.
      line.path = [
        [pole.position[0], 0, pole.position[2]],
        [building.position[0] + 4.9, 0, building.position[2] - 2.45],
      ]
    }

    // Site record bits the sheets print
    site.setbacksSource = 'demo — City of Tampa RS-60 style 25/7/20 (verify)'

    // ── Write ────────────────────────────────────────────────────────
    const count = Object.keys(nodes).length
    console.log(`graph: ${count} nodes, version ${scene.version}`)
    if (DRY_RUN) return
    const put = await fetch(`${API}/api/scenes/${SCENE_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph, expectedVersion: scene.version }),
    })
    const body = await put.text()
    if (!put.ok) throw new Error(`PUT failed ${put.status}: ${body.slice(0, 800)}`)
    console.log('saved:', body.slice(0, 200))
  })()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
