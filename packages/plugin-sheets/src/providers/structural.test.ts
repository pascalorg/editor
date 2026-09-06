/**
 * The S-series, tested against the PlanCrafters cottage fixture — a 32' × 46'
 * one-storey slab-on-grade house in Tampa, FL (27 walls, 12 doors, 10
 * windows, a 7:12 gable roof).
 *
 * The assertions are deliberately about HONESTY as much as about output: the
 * cottage has no framed floor (it is slab-on-grade) and no wood-framed
 * exterior walls (the Florida jurisdiction default is CMU), so the floor
 * framing and braced-wall sheets must SAY so rather than draw something
 * plausible. A second run with a California X-ray node exercises the paths
 * the Florida run cannot reach — anchor bolts, plate washers, hold-downs and
 * R602.10 braced wall lines.
 *
 * `writeSvg` dumps a viewport to the scratchpad so the drawing can be looked
 * at rather than only counted. It lives here, not in `src/`, because it is a
 * debugging aid and not part of the package.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FloorplanGeometry } from '@pascal-app/core'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { ProviderArgs } from '../drawings'
import type { AnyNodeLike, NodeMap } from '../model'
import { structuralPlans } from '../plans/structural-set'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import { buildStructuralDrawing, STRUCTURAL_SYSTEMS } from './structural'
import { flagsOf, structuralModel } from './structural/model'

const SCRATCH =
  'C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad'

/* -------------------------------------------------------------- scene */

function cottage(): NodeMap {
  const nodes = (fixture as unknown as { graph: { nodes: Record<string, AnyNodeLike> } }).graph
    .nodes
  return { ...nodes }
}

/**
 * The cottage with every wall assembly REMOVED: no assembly means Bones'
 * jurisdiction default decides the construction, and for Florida that is
 * CMU exteriors — the masonry path. The real fixture's walls carry the
 * 2x6 wood siding preset, so on paper the demo house is wood-framed.
 */
function masonryCottage(): NodeMap {
  const nodes = cottage()
  for (const node of Object.values(nodes)) {
    if (node?.type === 'wall' && 'assembly' in node) {
      const { assembly: _assembly, ...rest } = node as AnyNodeLike & { assembly?: unknown }
      nodes[node.id] = rest as AnyNodeLike
    }
  }
  return nodes
}

function levelId(nodes: NodeMap): string {
  const level = Object.values(nodes).find((n) => n?.type === 'level')
  if (!level) throw new Error('fixture has no level')
  return level.id
}

/**
 * The cottage with a SECOND storey stacked on it — the same walls and slab
 * copied onto a level 1. Bones frames a floor for every storey ABOVE the
 * ground (the ground is slab-on-grade), so this is what exercises the joist,
 * rim, girder and beam-tag paths the one-storey fixture cannot reach.
 */
function twoStoreyCottage(): NodeMap {
  const nodes = cottage()
  const ground = Object.values(nodes).find((n) => n?.type === 'level')
  const building = Object.values(nodes).find((n) => n?.type === 'building')
  if (!ground || !building) throw new Error('fixture shape changed')
  const upperId = 'level_upper_test'
  const children: string[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== ground.id) continue
    if (node.type !== 'wall' && node.type !== 'slab') continue
    const id = `${node.id}_up`
    const copy: AnyNodeLike = { ...node, id, parentId: upperId }
    if (node.type === 'wall') {
      // Openings stay on the ground copy: the upper storey only needs its
      // wall lines to carry the floor and the roof.
      copy.children = []
    }
    nodes[id] = copy
    children.push(id)
  }
  nodes[upperId] = {
    object: 'node',
    id: upperId,
    type: 'level',
    name: 'Second floor',
    parentId: building.id,
    visible: true,
    metadata: {},
    level: 1,
    baseElevation: 0,
    height: 2.7432,
    children,
  } as unknown as AnyNodeLike
  const buildingChildren = Array.isArray(building.children) ? [...building.children] : []
  nodes[building.id] = { ...building, children: [...buildingChildren, upperId] }
  return nodes
}

/** The same cottage with a Bones X-ray node forcing a wood-framed state. */
function cottageIn(state: string): NodeMap {
  const nodes = cottage()
  const id = levelId(nodes)
  nodes.bonesframing_test = {
    object: 'node',
    id: 'bonesframing_test',
    type: 'bones:framing',
    name: 'X-Ray',
    parentId: id,
    visible: true,
    metadata: {},
    jurisdiction: state,
  } as unknown as AnyNodeLike
  return nodes
}

function args(system: string, over: Partial<ProviderArgs> = {}): ProviderArgs {
  return {
    layers: { ...DEFAULT_VIEWPORT_LAYERS, framing: true },
    system,
    viewport: { x: 1, y: 1, w: 20, h: 20, scale: 48 },
    ...over,
  }
}

function draw(nodes: NodeMap, system: string, over: Partial<ProviderArgs> = {}) {
  const result = buildStructuralDrawing(nodes, args(system, over))
  if (!result) throw new Error(`no drawing for ${system}`)
  return result
}

/* -------------------------------------------------- geometry queries */

function walk(list: readonly FloorplanGeometry[], visit: (g: FloorplanGeometry) => void): void {
  for (const g of list) {
    visit(g)
    if (g.kind === 'group') walk(g.children, visit)
  }
}

function collect(list: readonly FloorplanGeometry[]): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  walk(list, (g) => out.push(g))
  return out
}

function kinds(list: readonly FloorplanGeometry[]): Record<string, number> {
  const out: Record<string, number> = {}
  walk(list, (g) => {
    out[g.kind] = (out[g.kind] ?? 0) + 1
  })
  return out
}

function textOf(list: readonly FloorplanGeometry[]): string {
  const parts: string[] = []
  walk(list, (g) => {
    if (g.kind === 'text') parts.push(g.text)
  })
  return parts.join('\n')
}

function dashed(list: readonly FloorplanGeometry[]): FloorplanGeometry[] {
  return collect(list).filter(
    (g) => 'strokeDasharray' in g && typeof g.strokeDasharray === 'string' && g.strokeDasharray,
  )
}

/* ------------------------------------------------------- SVG dumping */

/**
 * A tiny serializer so a drawing can be EYEBALLED. Live primitives are world
 * metres; plates are sheet inches — both are just a coordinate space, so the
 * dump takes a viewBox and writes what it is given.
 */
function writeSvg(name: string, list: readonly FloorplanGeometry[], pad = 1): void {
  const xs: number[] = []
  const ys: number[] = []
  const note = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x)
      ys.push(y)
    }
  }
  walk(list, (g) => {
    switch (g.kind) {
      case 'line':
        note(g.x1, g.y1)
        note(g.x2, g.y2)
        break
      case 'rect':
        note(g.x, g.y)
        note(g.x + g.width, g.y + g.height)
        break
      case 'circle':
        note(g.cx - g.r, g.cy - g.r)
        note(g.cx + g.r, g.cy + g.r)
        break
      case 'polygon':
      case 'polyline':
        for (const p of g.points) note(p[0], p[1])
        break
      case 'text': {
        // Text is measured by its WIDTH, not its anchor, so the dump frames
        // the same box the provider's own text-aware bounds return.
        const width = g.text.length * g.fontSize * 0.58
        const left =
          g.textAnchor === 'end' ? g.x - width : g.textAnchor === 'middle' ? g.x - width / 2 : g.x
        note(left, g.y - g.fontSize)
        note(left + width, g.y + g.fontSize * 0.3)
        break
      }
      default:
        break
    }
  })
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)
  const style = (g: Record<string, unknown>) =>
    [
      g.fill !== undefined ? `fill="${String(g.fill)}"` : 'fill="none"',
      g.stroke !== undefined ? `stroke="${String(g.stroke)}"` : '',
      g.strokeWidth !== undefined ? `stroke-width="${String(g.strokeWidth)}"` : '',
      g.strokeDasharray !== undefined ? `stroke-dasharray="${String(g.strokeDasharray)}"` : '',
      g.opacity !== undefined ? `opacity="${String(g.opacity)}"` : '',
    ]
      .filter(Boolean)
      .join(' ')
  const body: string[] = []
  const emit = (g: FloorplanGeometry, transform = '') => {
    const t = transform ? ` transform="${transform}"` : ''
    switch (g.kind) {
      case 'line':
        body.push(`<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" ${style(g)}${t}/>`)
        break
      case 'rect':
        body.push(
          `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" ${style(g)}${t}/>`,
        )
        break
      case 'circle':
        body.push(`<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" ${style(g)}${t}/>`)
        break
      case 'polygon':
        body.push(
          `<polygon points="${g.points.map((p) => p.join(',')).join(' ')}" ${style(g)}${t}/>`,
        )
        break
      case 'polyline':
        body.push(
          `<polyline points="${g.points.map((p) => p.join(',')).join(' ')}" ${style(g)}${t}/>`,
        )
        break
      case 'text':
        body.push(
          `<text x="${g.x}" y="${g.y}" font-size="${g.fontSize}" fill="${g.fill ?? '#000'}" font-weight="${g.fontWeight ?? 400}" text-anchor="${g.textAnchor ?? 'start'}" font-family="Helvetica,Arial,sans-serif"${t}>${esc(g.text)}</text>`,
        )
        break
      case 'group': {
        const parts: string[] = []
        if (g.transform?.translate) {
          parts.push(`translate(${g.transform.translate[0]},${g.transform.translate[1]})`)
        }
        if (g.transform?.rotate) parts.push(`rotate(${(g.transform.rotate * 180) / Math.PI})`)
        const inner = parts.join(' ')
        for (const child of g.children) emit(child, inner)
        break
      }
      default:
        break
    }
  }
  for (const g of list) emit(g)
  mkdirSync(SCRATCH, { recursive: true })
  writeFileSync(
    `${SCRATCH}/structural-${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="1600">\n<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>\n${body.join('\n')}\n</svg>\n`,
  )
}

/* ------------------------------------------------------------- tests */

describe('foundation (S1.0)', () => {
  test('draws a live plan with slab, dashed footings and anchorage', () => {
    const nodes = cottage()
    const result = draw(nodes, 'foundation')
    expect(result.primitives.length).toBeGreaterThan(50)
    expect(result.plate ?? []).toHaveLength(0)
    // Hidden work is dashed — footings below the slab.
    expect(dashed(result.primitives).length).toBeGreaterThan(10)
    // Bounds are real and cover the 32' x 46' footprint (metres).
    const w = result.bounds.maxX - result.bounds.minX
    const h = result.bounds.maxY - result.bounds.minY
    expect(w).toBeGreaterThan(9)
    expect(h).toBeGreaterThan(13)
    // Footing type tags exist and are hexagons (polygons) with FT text.
    expect(textOf(result.primitives)).toContain('FT1')
    expect(result.title).toContain('Foundation')
    writeSvg('s1-foundation-fl', result.primitives, 1.5)
  })

  test('slab callout cites R506 and never invents reinforcement', () => {
    const text = textOf(draw(cottage(), 'foundation').primitives)
    expect(text).toContain('CONC. SLAB ON GRADE (IRC R506.1)')
    expect(text).toContain('R506.2.3')
    expect(text).toContain('REINF. NOT MODELLED (verify R506.2.4)')
  })

  test('the wood-framed cottage draws its sill anchorage (R403.1.6)', () => {
    const nodes = cottage() // 2x6 wood exterior assemblies → framed, even in FL
    const model = structuralModel(nodes, levelId(nodes))
    expect(model?.jurisdiction).toBe('FL')
    expect(model?.members.some((m) => m.role === 'anchor-bolt')).toBe(true)
    const text = textOf(draw(nodes, 'foundation').primitives)
    expect(text).toContain('A.B.')
    expect(text).toContain('R403.1.6')
  })

  test('a masonry jurisdiction states its anchorage instead of drawing bolts', () => {
    const nodes = masonryCottage() // no assemblies: FL -> CMU exterior default
    const model = structuralModel(nodes, levelId(nodes))
    expect(model?.jurisdiction).toBe('FL')
    expect(model?.members.some((m) => m.role === 'anchor-bolt')).toBe(false)
    const text = textOf(draw(nodes, 'foundation').primitives)
    expect(text).toContain('NO SOLE-PLATE ANCHOR BOLTS')
    expect(text).toContain('CMU WALLS — DOWELS IN GROUTED CELLS')
    expect(text).toContain('R606.12')
  })

  test('a framed jurisdiction draws anchor bolts with the R403.1.6 callout', () => {
    const nodes = cottageIn('CA')
    const model = structuralModel(nodes, levelId(nodes))
    expect(model?.jurisdiction).toBe('CA')
    const bolts = model?.members.filter((m) => m.role === 'anchor-bolt') ?? []
    expect(bolts.length).toBeGreaterThan(20)
    const result = draw(nodes, 'foundation')
    const text = textOf(result.primitives)
    expect(text).toContain('A.B. 5/8" DIA. @ 4\'-0" O.C. MAX')
    expect(text).toContain('(IRC R403.1.6)')
    // Hold-downs are filled squares in SDC D — one per braced wall end.
    expect((model?.members ?? []).filter((m) => m.role === 'hold-down').length).toBeGreaterThan(0)
    // …and the framed run DOES get the stemwall vertical grid in its notes.
    const framedNotes = textOf(
      draw(nodes, 'foundation-notes', { viewport: { x: 1, y: 1, w: 11, h: 14, scale: 48 } })
        .plate ?? [],
    )
    // The note block hard-wraps, so compare on the unwrapped text.
    expect(framedNotes.replace(/\s+/g, ' ')).toContain('#4 verticals at 24" o.c.')
    writeSvg('s1-foundation-ca', result.primitives, 1.5)
  })

  test('the footing schedule is built from the engine sizes', () => {
    const result = draw(cottage(), 'foundation-schedules')
    expect(result.primitives).toHaveLength(0)
    const text = textOf(result.plate ?? [])
    expect(text).toContain('FOOTING SCHEDULE')
    expect(text).toContain('FT1')
    expect(text).toContain('CONT. WALL FOOTING')
    // 16" wide x 8" thick perimeter footing, straight out of the FramingSpec.
    expect(text).toContain('16"')
    expect(text).toContain('8"')
    expect(text).toContain('THICKENED SLAB FOOTING')
    expect(text).toContain('#4')
    writeSvg('s1-schedules', result.plate ?? [], 0.4)
  })

  test('the legend only lists symbols the plan actually drew', () => {
    const plate = draw(masonryCottage(), 'foundation-legend').plate ?? []
    writeSvg('s1-legend', plate, 0.4)
    const text = textOf(plate)
    expect(text).toContain('FOUNDATION LEGEND')
    expect(text).toContain('SLAB EDGE')
    expect(text).toContain('(N) FOOTING')
    // No anchor bolts on the masonry run — so no anchor-bolt legend row.
    expect(text).not.toContain('ANCHOR BOLT — SEE ANCHORAGE SCHEDULE')
  })

  test('the notes are cited and mark what is not derived', () => {
    const result = draw(masonryCottage(), 'foundation-notes', {
      viewport: { x: 1, y: 1, w: 11, h: 14, scale: 48 },
    })
    const text = textOf(result.plate ?? [])
    expect(text).toContain('IRC R403.1.4')
    expect(text).toContain('IRC R506.1')
    expect(text).toContain('IRC R318')
    expect(text).toContain('(verify: IRC Table R401.4.1)')
    expect(text).toContain('(verify: IRC R506.2.4)')
    expect(text).toContain('Florida Building Code')
    // The masonry run has NO generic stemwall verticals — the note must not
    // claim steel the engine did not place.
    expect(text.replace(/\s+/g, ' ')).not.toContain('#4 verticals at')
    expect(text.replace(/\s+/g, ' ')).toContain('masonry dowel schedule')
    writeSvg('s1-notes', result.plate ?? [], 0.4)
  })
})

describe('roof framing (S3.0)', () => {
  test('draws rafters, ridge and ties with a spacing callout', () => {
    const result = draw(cottage(), 'roof-framing')
    expect(result.primitives.length).toBeGreaterThan(100)
    const counts = kinds(result.primitives)
    expect(counts.line ?? 0).toBeGreaterThan(80)
    const text = textOf(result.primitives)
    expect(text).toMatch(/2x\d+ RAFTERS @ \d+" O\.C\./)
    expect(result.title).toContain('Roof framing plan')
    writeSvg('s3-roof-fl', result.primitives, 1.5)
  })

  test('the roof beam schedule carries the headers the wall engine sized', () => {
    const result = draw(cottage(), 'roof-schedules')
    const text = textOf(result.plate ?? [])
    expect(text).toContain('ROOF BEAM SCHEDULE')
    expect(text).toContain('RB1')
    expect(text).toMatch(/HEADER OVER (DOOR|WINDOW)|MASONRY LINTEL|RIDGE/)
    expect(text).toContain('SPF #2 (ASSUMED)')
    writeSvg('s3-schedule', result.plate ?? [], 0.4)
  })

  test('roof notes cite the span table and the tie requirement', () => {
    const plate =
      draw(cottage(), 'roof-notes', { viewport: { x: 1, y: 1, w: 11, h: 14, scale: 48 } }).plate ??
      []
    writeSvg('s3-roof-notes', plate, 0.4)
    const text = textOf(plate)
    expect(text).toContain('ROOF FRAMING NOTES')
    expect(text).toContain('IRC Table R802.4.1')
    expect(text).toContain('R802.11')
    expect(text).toContain('IRC R317')
    expect(text).toContain('ROOF LEGEND')
  })

  test('a truss roof prints the deferred-submittal note instead of inventing trusses', () => {
    const nodes = cottage()
    nodes.bonesframing_truss = {
      object: 'node',
      id: 'bonesframing_truss',
      type: 'bones:framing',
      name: 'X-Ray',
      parentId: levelId(nodes),
      visible: true,
      metadata: {},
      jurisdiction: 'FL',
      roofSystem: 'truss',
    } as unknown as AnyNodeLike
    const model = structuralModel(nodes, levelId(nodes))
    expect(model?.members.some((m) => m.role === 'truss-chord')).toBe(true)
    const result = draw(nodes, 'roof-framing')
    expect(result.warnings?.join(' ')).toContain('deferred submittal')
    const text = textOf(
      draw(nodes, 'roof-notes', { viewport: { x: 1, y: 1, w: 11, h: 14, scale: 48 } }).plate ?? [],
    )
    expect(text).toContain('DEFERRED SUBMITTAL')
    expect(text).toContain('R802.10')
    writeSvg('s3-roof-truss', result.primitives, 1.5)
  })
})

describe('floor framing (S2.x)', () => {
  test('a slab-on-grade storey returns a plate that says so — no invented joists', () => {
    const result = draw(cottage(), 'floor-framing')
    expect(result.primitives).toHaveLength(0)
    expect((result.plate ?? []).length).toBeGreaterThan(0)
    const text = textOf(result.plate ?? [])
    expect(text).toContain('slab-on-grade')
    expect(text).toContain('no framed floor')
    expect(text).toContain('has been invented')
    // Nothing that reads like a joist callout.
    expect(text).not.toMatch(/@ \d+" O\.C\./)
  })

  test('the floor beam schedule says it is empty rather than filling itself', () => {
    const text = textOf(draw(cottage(), 'floor-schedules').plate ?? [])
    expect(text).toContain('FLOOR BEAM SCHEDULE')
    expect(text).toContain('No floor girders derived')
  })

  test('a storey with a framed floor draws joists, rims and a spacing callout', () => {
    const nodes = twoStoreyCottage()
    const upper = Object.values(nodes).find((n) => n?.type === 'level' && n.level === 1)
    if (!upper) throw new Error('no upper level')
    const model = structuralModel(nodes, upper.id)
    const joists = model?.members.filter((m) => m.role === 'joist') ?? []
    expect(joists.length).toBeGreaterThan(20)
    const result = draw(nodes, 'floor-framing', { levelId: upper.id })
    expect(result.primitives.length).toBeGreaterThan(30)
    const text = textOf(result.primitives)
    expect(text).toMatch(/2x\d+ FLOOR JOISTS @ \d+" O\.C\./)
    expect(result.title).toContain('Floor framing plan')
    writeSvg('s2-floor-upper', result.primitives, 1.5)

    // …and the beam schedule fills itself from the girders the engine placed.
    const schedule = textOf(draw(nodes, 'floor-schedules', { levelId: upper.id }).plate ?? [])
    expect(schedule).toContain('FLOOR BEAM SCHEDULE')
    expect(schedule).toContain('FB1')
    expect(schedule).toContain('FLUSH GIRDER')
    writeSvg(
      's2-floor-schedule',
      draw(nodes, 'floor-schedules', { levelId: upper.id }).plate ?? [],
      0.4,
    )

    const notes = textOf(
      draw(nodes, 'floor-notes', {
        levelId: upper.id,
        viewport: { x: 1, y: 1, w: 11, h: 14, scale: 48 },
      }).plate ?? [],
    )
    expect(notes).toContain('FLOOR FRAMING NOTES')
    expect(notes).toContain('IRC Table R502.3.1(2)')
    expect(notes).toContain('R502.6')
    expect(notes).toContain('FLOOR LEGEND')
  })

  test('the set plans an S2.x sheet once a framed floor exists', () => {
    const nodes = twoStoreyCottage()
    const plans = structuralPlans({
      nodes,
      frame: { x: 1, y: 1, w: 30, h: 21 },
      gap: 0.5,
      planScale: 48,
      elevationScale: 48,
      levels: Object.values(nodes)
        .filter((n) => n?.type === 'level')
        .sort((a, b) => ((a.level as number) ?? 0) - ((b.level as number) ?? 0)),
      hasBones: false,
      archScales: [],
      civilScales: [],
    } as never)
    expect(plans.map((p) => p.number)).toContain('S2.0')
  })
})

describe('wall bracing (S4.0)', () => {
  test('a masonry house has no R602.10 braced wall lines and the sheet says so', () => {
    const nodes = masonryCottage()
    const model = structuralModel(nodes, levelId(nodes))
    if (!model) throw new Error('no model')
    const result = draw(nodes, 'wall-bracing')
    expect(result.primitives).toHaveLength(0)
    const text = textOf(result.plate ?? [])
    expect(text).toContain('No IRC R602.10 braced wall lines')
    expect(text).toContain('R602.10.3')
  })

  test('a wood-framed house draws the lines the engine identified', () => {
    const nodes = cottageIn('CA')
    const result = draw(nodes, 'wall-bracing')
    expect(result.primitives.length).toBeGreaterThan(4)
    const text = textOf(result.primitives)
    expect(text).toMatch(/BWL [XZ]\d/)
    const schedulePlate = draw(nodes, 'bracing-schedules').plate ?? []
    writeSvg('s4-bracing-schedule', schedulePlate, 0.4)
    const schedule = textOf(schedulePlate)
    expect(schedule).toContain('BRACED WALL LINE SCHEDULE')
    expect(schedule).toContain('CS-WSP')
    expect(schedule).toContain('not verified')
    writeSvg('s4-bracing-ca', result.primitives, 1.5)
  })
})

describe('structural notes (SN1)', () => {
  test('design criteria come from the jurisdiction data with their caveats', () => {
    const result = draw(cottage(), 'notes', {
      viewport: { x: 1, y: 1, w: 33, h: 21, scale: 48 },
    })
    expect(result.primitives).toHaveLength(0)
    const text = textOf(result.plate ?? [])
    expect(text).toContain('DESIGN CRITERIA')
    expect(text).toContain('Florida Building Code, Residential — 8th Edition (2023), 2021 IRC base')
    expect(text).toContain('140 mph')
    expect(text).toContain('B assumed (verify)')
    // The county caveat must ride next to the state wind number.
    expect(text).toContain('HVHZ')
    expect(text).toContain('SPF #2')
    expect(text).toContain('FASTENING SCHEDULE')
    expect(text).toContain('IRC 2021 Table R602.3(1)')
    expect(text).toContain('16d')
    writeSvg('sn1-notes', result.plate ?? [], 0.4)
  })

  test('every engine flag and model warning reaches the paper', () => {
    const nodes = cottage()
    const model = structuralModel(nodes, levelId(nodes))
    if (!model) throw new Error('no model')
    const text = textOf(
      draw(nodes, 'notes', { viewport: { x: 1, y: 1, w: 33, h: 21, scale: 48 } }).plate ?? [],
    )
    // the notes print the STRUCTURAL flags (flagsOf) — a plumbing or HVAC
    // flag belongs on the P / M sheets; since W15 lapped the cottage's
    // ceiling joists its structural flags can be none at all
    const flagged = flagsOf(model.members)
    if (flagged.length > 0) expect(text).toContain('ENGINE FLAG')
    else expect(text).not.toContain('ENGINE FLAG')
    expect(text).toContain('MODEL WARNING')
  })
})

describe('honesty and edge cases', () => {
  test('a scene with no walls returns a plate note and does not throw', () => {
    const nodes: NodeMap = {
      site_x: { object: 'node', id: 'site_x', type: 'site', parentId: null } as never,
      bld_x: { object: 'node', id: 'bld_x', type: 'building', parentId: 'site_x' } as never,
      lvl_x: {
        object: 'node',
        id: 'lvl_x',
        type: 'level',
        parentId: 'bld_x',
        level: 0,
        height: 2.7,
        children: [],
      } as never,
    }
    for (const system of STRUCTURAL_SYSTEMS) {
      const result = buildStructuralDrawing(nodes, args(system))
      expect(result).not.toBeNull()
      expect(result?.primitives).toHaveLength(0)
      expect((result?.plate ?? []).length).toBeGreaterThan(0)
    }
    const text = textOf(buildStructuralDrawing(nodes, args('foundation'))?.plate ?? [])
    expect(text).toContain('NOTHING TO FRAME')
    expect(text).toContain('has been invented')
  })

  test('an empty scene returns a plate note and does not throw', () => {
    const result = buildStructuralDrawing({}, args('foundation'))
    expect(result).not.toBeNull()
    expect(result?.primitives).toHaveLength(0)
    expect(textOf(result?.plate ?? [])).toContain('NO LEVEL IN THIS SCENE')
  })

  test('an unknown system names the ones that exist', () => {
    const text = textOf(buildStructuralDrawing(cottage(), args('nonsense'))?.plate ?? [])
    expect(text).toContain('UNKNOWN SYSTEM')
    expect(text).toContain('roof-framing')
  })

  test('every system runs on the fixture without throwing', () => {
    const nodes = cottage()
    for (const system of STRUCTURAL_SYSTEMS) {
      const result = buildStructuralDrawing(nodes, args(system))
      expect(result).not.toBeNull()
      const total = (result?.primitives.length ?? 0) + (result?.plate?.length ?? 0)
      expect(total).toBeGreaterThan(0)
    }
  })

  test('warnings are surfaced, not swallowed', () => {
    const foundation = draw(cottage(), 'foundation')
    expect((foundation.warnings ?? []).length).toBeGreaterThan(0)
    // …and MEP warnings from the same compute stay off the structural sheet.
    expect((foundation.warnings ?? []).join(' ')).not.toContain('water-pipe bond')
  })

  test('the model reports how the jurisdiction was chosen', () => {
    const nodes = cottage()
    const model = structuralModel(nodes, levelId(nodes))
    expect(model?.jurisdictionSource).toContain('site address state (FL)')
    const withNode = structuralModel(cottageIn('CA'), levelId(nodes))
    expect(withNode?.jurisdictionSource).toContain('Bones X-ray node')
  })
})

describe('the sheet set', () => {
  const ctx = (nodes: NodeMap) => ({
    nodes,
    frame: { x: 1, y: 1, w: 30, h: 21 },
    gap: 0.5,
    planScale: 48,
    elevationScale: 48,
    levels: Object.values(nodes).filter((n) => n?.type === 'level'),
    hasBones: false,
    archScales: [],
    civilScales: [],
  })

  test('plans S1.0, S3.0, S4.0 and SN1 for the wood-framed cottage — and no empty S2.x', () => {
    const plans = structuralPlans(ctx(cottage()) as never)
    const numbers = plans.map((p) => p.number)
    expect(numbers).toContain('S1.0')
    expect(numbers).toContain('S3.0')
    expect(numbers).toContain('SN1')
    // Wood exterior assemblies: the braced wall sheet is planned.
    expect(numbers).toContain('S4.0')
    // Slab-on-grade: no floor framing sheet.
    expect(numbers.some((n) => n.startsWith('S2.'))).toBe(false)
  })

  test('the masonry variant plans no braced wall sheet', () => {
    const plans = structuralPlans(ctx(masonryCottage()) as never)
    expect(plans.map((p) => p.number)).not.toContain('S4.0')
  })

  test('a wood-framed cottage also gets the braced wall sheet', () => {
    const plans = structuralPlans(ctx(cottageIn('CA')) as never)
    expect(plans.map((p) => p.number)).toContain('S4.0')
  })

  test('viewports stay inside the frame and use the structural kind', () => {
    const frame = { x: 1, y: 1, w: 30, h: 21 }
    for (const plan of structuralPlans(ctx(cottage()) as never)) {
      for (const vp of plan.viewports) {
        expect(vp.kind).toBe('structural')
        expect(vp.x ?? 0).toBeGreaterThanOrEqual(frame.x - 0.001)
        expect(vp.y ?? 0).toBeGreaterThanOrEqual(frame.y - 0.001)
        expect((vp.x ?? 0) + (vp.w ?? 0)).toBeLessThanOrEqual(frame.x + frame.w + 0.001)
        expect((vp.y ?? 0) + (vp.h ?? 0)).toBeLessThanOrEqual(frame.y + frame.h + 0.001)
      }
    }
  })

  test('the plate column is about a third of the field', () => {
    const frame = { x: 1, y: 1, w: 30, h: 21 }
    const s1 = structuralPlans(ctx(cottage()) as never).find((p) => p.number === 'S1.0')
    const plan = s1?.viewports[0]
    expect(plan?.system).toBe('foundation')
    const ratio = 1 - (plan?.w ?? 0) / frame.w
    expect(ratio).toBeGreaterThan(0.3)
    expect(ratio).toBeLessThan(0.42)
  })

  test('an empty scene plans nothing rather than empty sheets', () => {
    expect(structuralPlans(ctx({}) as never)).toHaveLength(0)
  })

  /**
   * The layout contract: every viewport the set plans must FIT what the
   * provider draws into it. A plate that silently prints "+7 more note lines"
   * is how an engine flag disappears off the paper, so the sheet set is
   * rendered at its own geometry and every overflow marker is a failure.
   */
  test.each([
    ['as drawn', cottage],
    ['wood-framed', () => cottageIn('CA')],
    ['two storeys', twoStoreyCottage],
  ])('every planned viewport fits its content (%s)', (_label, build) => {
    const nodes = build()
    // The real generator's Arch-D field, not the test's rounder one.
    const frame = { x: 1.25, y: 1.25, w: 30.5, h: 21.5 }
    const plans = structuralPlans({ ...ctx(nodes), frame } as never)
    expect(plans.length).toBeGreaterThan(0)
    const overflows: string[] = []
    for (const plan of plans) {
      for (const vp of plan.viewports) {
        const result = buildStructuralDrawing(nodes, {
          layers: { ...DEFAULT_VIEWPORT_LAYERS },
          system: vp.system,
          levelId: vp.levelId,
          viewport: {
            x: vp.x ?? 0,
            y: vp.y ?? 0,
            w: vp.w ?? 1,
            h: vp.h ?? 1,
            scale: vp.scale ?? 48,
          },
        })
        const text = textOf([...(result?.plate ?? []), ...(result?.primitives ?? [])])
        for (const line of text.split('\n')) {
          if (/more note lines|more legend entries|Not shown here|more — enlarge/.test(line)) {
            overflows.push(`${plan.number}/${vp.system}: ${line}`)
          }
        }
      }
    }
    expect(overflows).toEqual([])
  })
})
