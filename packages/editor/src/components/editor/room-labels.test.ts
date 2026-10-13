import { describe, expect, test } from 'bun:test'
import type { Polygon } from '@pascal-app/core'
import { ZoneNode } from '@pascal-app/core/schema'
import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import {
  candidates3D,
  DeclutterClock,
  formatRoomArea,
  type LabelRect,
  LabelReveal,
  measureFullPill,
  PILL_GAP,
  type PillCandidate,
  type PillPlacement,
  PillPlacer,
  type PillSize,
  pillRect,
  placedRect,
  placePills,
  REVEAL_DWELL_MS,
  REVEAL_GRACE_MS,
  RoomAnchors,
  type RoomHit,
  type RoomLabelEntry,
  type RoomLabelVisibilityState,
  roomAt,
  roomLabelEntries,
  roomLabelsVisible,
  suppressedBy,
} from './room-labels'

const resting: RoomLabelVisibilityState = {
  phase: 'building',
  mode: 'select',
  scopeIdle: true,
  room: null,
  selectedTypes: [],
  zoneId: null,
  focusedUnitId: null,
  isCaptureMode: false,
  isThumbnailCapture: false,
}

type Timer = ReturnType<typeof setTimeout>

/** Timers on a clock the test advances by hand. */
function manualClock() {
  let now = 0
  let nextId = 1
  const due = new Map<number, { at: number; run: () => void }>()
  return {
    schedule: (run: () => void, ms: number) => {
      const id = nextId++
      due.set(id, { at: now + ms, run })
      return id as unknown as Timer
    },
    cancel: (timer: Timer) => {
      due.delete(timer as unknown as number)
    },
    pending: () => due.size,
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const [id, timer] = [...due].sort((a, b) => a[1].at - b[1].at)[0] ?? []
        if (id === undefined || !timer || timer.at > end) break
        due.delete(id)
        now = timer.at
        timer.run()
      }
      now = end
    },
  }
}

const square = (cx: number, cy: number, side: number): Polygon => ({
  outer: [
    [cx - side / 2, cy - side / 2],
    [cx + side / 2, cy - side / 2],
    [cx + side / 2, cy + side / 2],
    [cx - side / 2, cy + side / 2],
  ],
  holes: [],
})

describe('room label pills', () => {
  test('show on the resting level, with only the site, building or level picked', () => {
    expect(roomLabelsVisible(resting)).toBe(true)
    for (const type of ['site', 'building', 'level']) {
      expect(roomLabelsVisible({ ...resting, selectedTypes: [type] })).toBe(true)
    }
  })

  test('step back for any other selection, a room, a zone, a unit, a tool, a gesture or site', () => {
    for (const change of [
      { selectedTypes: ['wall'] },
      { selectedTypes: ['level', 'item'] },
      { selectedTypes: [undefined] },
      { room: { levelId: 'level_1', zoneId: 'zone_1' } },
      { zoneId: 'zone_1' },
      { focusedUnitId: 'unit_1' },
      { mode: 'build' },
      { scopeIdle: false },
      { phase: 'site' },
      { isCaptureMode: true },
      { isThumbnailCapture: true },
    ] satisfies Partial<RoomLabelVisibilityState>[]) {
      expect(roomLabelsVisible({ ...resting, ...change })).toBe(false)
    }
  })

  test('read the area in the active unit system', () => {
    expect(formatRoomArea(33, 'metric')).toBe('33.0 m²')
    expect(formatRoomArea(10, 'imperial')).toBe('107.6 ft²')
  })

  test('a pill is placed centred on where its anchor lands', () => {
    expect(pillRect(100, 50, [80, 20])).toEqual({ left: 60, top: 40, right: 140, bottom: 60 })
  })

  test('a pill showing less measures its whole label, and its width with the name alone', () => {
    const areaLabel = {}
    const element = {
      dataset: { roomLabelTier: 'dot' },
      querySelector: () => areaLabel,
    } as unknown as HTMLElement
    let width = 161.5
    const read = (target: Element) => {
      if (target === areaLabel) return { width: '40px', height: '16px', columnGap: 'normal' }
      const dot = 'roomLabelTier' in (target as HTMLElement).dataset
      return {
        width: dot ? '16px' : `${width}px`,
        height: dot ? '16px' : '26px',
        columnGap: '6px',
      }
    }
    expect(measureFullPill(element, read)).toEqual([161.5, 26, 115.5])
    width = 176.25
    expect(measureFullPill(element, read)).toEqual([176.25, 26, 130.25])
    expect(element.dataset.roomLabelTier).toBe('dot')
  })

  test('invisible rooms and drawn zones do not reserve space for a pill', () => {
    const polygon: [number, number][] = [
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
    ]
    const room = {
      zoneId: 'zone_room',
      polygon,
      holes: [],
      area: 9,
    } as unknown as RoomSelectionRecord
    const zones = [
      ZoneNode.parse({ id: 'zone_room', name: 'Room', polygon, visible: false }),
      ZoneNode.parse({ id: 'zone_hidden', name: 'Hidden', polygon, visible: false }),
      ZoneNode.parse({ id: 'zone_visible', name: 'Visible', polygon }),
    ]
    expect(roomLabelEntries([room], zones).map((entry) => entry.zoneId)).toEqual(['zone_visible'])
    expect(roomLabelEntries([room], [{ ...zones[0]!, visible: true }])[0]).toEqual({
      zoneId: room.zoneId,
      polygon,
      holes: [],
      area: 9,
    })
  })

  test('a zone drawn inside a room is a hole in it, so their labels and the pointer agree', () => {
    const living = square(5, 5, 10)
    const nook = square(7, 7, 3)
    const entries = roomLabelEntries(
      [],
      [
        ZoneNode.parse({ id: 'zone_living', name: 'Living room', polygon: living.outer }),
        ZoneNode.parse({ id: 'zone_nook', name: 'Reading nook', polygon: nook.outer }),
        ZoneNode.parse({ id: 'zone_hall', name: 'Hall', polygon: square(15, 5, 10).outer }),
      ],
    )
    const [livingEntry, nookEntry, hallEntry] = entries
    expect(livingEntry!.holes).toEqual([nook.outer])
    expect(livingEntry!.area).toBe(100)
    expect(nookEntry!.holes).toEqual([])
    expect(hallEntry!.holes).toEqual([])
    // At 40 px per metre, the living room's label next to the nook moves off it.
    const onScreen = (zoneId: string, x: number, y: number): PillCandidate => {
      const entry = entries.find((candidate) => candidate.zoneId === zoneId)!
      const scale = ([px, py]: [number, number]): [number, number] => [px * 40, py * 40]
      return {
        id: zoneId,
        x: x * 40,
        y: y * 40,
        size: [80, 24, 50],
        area: entry.area,
        outline: { outer: entry.polygon.map(scale), holes: entry.holes.map((h) => h.map(scale)) },
      }
    }
    const placements = placePills([onScreen('zone_living', 7, 8.7), onScreen('zone_nook', 7, 7)], {
      width: 1000,
      height: 1000,
    })
    expect(placements.get('zone_living')).toEqual({ tier: 'full', dy: 8 })
    expect(placements.get('zone_nook')).toEqual({ tier: 'full', dy: 0 })
    expect(roomAt(entries, () => [7, 7, 0])).toBe('zone_nook')
    expect(roomAt(entries, () => [2, 2, 0])).toBe('zone_living')
  })
})

describe('pill placement', () => {
  const pane = { width: 1000, height: 1000 }
  const everywhere = square(0, 0, 1e5)
  const pill = (
    id: string,
    x: number,
    y: number,
    area: number,
    size: PillSize = [120, 24, 70],
    outline: Polygon = everywhere,
  ): PillCandidate => ({ id, x, y, size, area, outline })
  const near = (a: LabelRect, b: LabelRect) =>
    a.left < b.right + PILL_GAP &&
    b.left < a.right + PILL_GAP &&
    a.top < b.bottom + PILL_GAP &&
    b.top < a.bottom + PILL_GAP

  test('apart, every pill shows in full at its anchor', () => {
    const placements = placePills([pill('a', 100, 100, 20), pill('b', 400, 100, 10)], pane)
    expect([...placements.values()]).toEqual([
      { tier: 'full', dy: 0 },
      { tier: 'full', dy: 0 },
    ])
  })

  test('two overlapping pills: the larger room keeps its place, the other moves the least it can', () => {
    const big = pill('big', 100, 100, 30)
    const small = pill('small', 110, 106, 10)
    const placements = placePills([small, big], pane)
    expect(placements.get('big')).toEqual({ tier: 'full', dy: 0 })
    // 24 px tall, 6 px apart, 4 px gap: 24 px down is the nearest clear slot (up needs 34).
    expect(placements.get('small')).toEqual({ tier: 'full', dy: 24 })
  })

  test('how much of a label shows follows how large its room is on screen', () => {
    // A 4 m square room at 40, 25, 10 and 3 px per metre.
    const tiers = [40, 25, 10, 3].map(
      (scale) =>
        placePills(
          [pill('room', 500, 500, 16, [120, 24, 70], square(500, 500, 4 * scale))],
          pane,
        ).get('room')!.tier,
    )
    expect(tiers).toEqual(['full', 'name', 'dot', 'hidden'])
  })

  test('a thin room at an angle gets its dot, however large its bounding box', () => {
    // A 1.2 m corridor 8 m long at 45°, at 40 px per metre.
    const along = [160 / Math.SQRT2, 160 / Math.SQRT2]
    const across = [-24 / Math.SQRT2, 24 / Math.SQRT2]
    const corner = (a: number, b: number): [number, number] => [
      500 + a * along[0]! + b * across[0]!,
      500 + a * along[1]! + b * across[1]!,
    ]
    const corridor = {
      outer: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
      holes: [],
    }
    expect(
      placePills([pill('hall', 500, 500, 9.6, [120, 24, 70], corridor)], pane).get('hall'),
    ).toEqual({ tier: 'dot', dy: 0 })
  })

  test('a label next to a hole in its room moves clear of the hole', () => {
    const atrium = { ...square(200, 200, 200), holes: [square(200, 200, 80).outer] }
    // At its anchor the pill's bottom edge crosses the hole's top edge (y 160).
    expect(
      placePills([pill('room', 200, 150, 34, [120, 24, 70], atrium)], pane).get('room'),
    ).toEqual({
      tier: 'full',
      dy: -4,
    })
  })

  test('a label never leaves the pane: near its edge it shows less', () => {
    const placements = placePills([pill('a', 50, 500, 10), pill('b', 5, 500, 10)], pane)
    expect(placements.get('a')).toEqual({ tier: 'name', dy: 0 })
    expect(placements.get('b')).toEqual({ tier: 'hidden', dy: 0 })
  })

  test('a pill that has to move keeps to the side it took last time; one with room goes back', () => {
    const bar = pill('bar', 100, 100, 30, [120, 8, 60])
    const moved = pill('moved', 100, 100, 10)
    expect(placePills([bar, moved], pane).get('moved')).toEqual({ tier: 'full', dy: -20 })
    const previous = new Map<string, PillPlacement>([['moved', { tier: 'full', dy: 20 }]])
    expect(placePills([bar, moved], pane, previous).get('moved')).toEqual({ tier: 'full', dy: 20 })
    expect(placePills([moved], pane, previous).get('moved')).toEqual({ tier: 'full', dy: 0 })
  })

  test('the order is fixed by room size and id, not by input order', () => {
    const candidates = [pill('b', 100, 100, 10), pill('a', 105, 100, 10), pill('c', 110, 100, 10)]
    const first = placePills(candidates, pane)
    const shuffled = placePills([candidates[2]!, candidates[0]!, candidates[1]!], pane)
    expect(shuffled).toEqual(first)
    expect(first.get('a')).toEqual({ tier: 'full', dy: 0 })
  })

  test('placed labels never come within the gap of each other, and each stays in its room', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
      return seed / 2 ** 31
    }
    // A plan of 8 × 5 rooms of random widths and depths, filling the pane.
    const cuts = (count: number, length: number) => {
      const weights = Array.from({ length: count }, () => 0.2 + random())
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      let at = 0
      return [0, ...weights.map((weight) => (at += (weight / total) * length))]
    }
    const xs = cuts(8, 1200)
    const ys = cuts(5, 800)
    const rooms = xs.slice(1).flatMap((right, i) =>
      ys.slice(1).map((bottom, j) => {
        const left = xs[i]!
        const top = ys[j]!
        const outline: Polygon = {
          outer: [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
          ],
          holes: [],
        }
        const width = 40 + random() * 140
        return {
          box: { left, top, right, bottom },
          candidate: pill(
            `r${i}-${j}`,
            left + (right - left) * (0.3 + random() * 0.4),
            top + (bottom - top) * (0.3 + random() * 0.4),
            (right - left) * (bottom - top),
            [width, 24, width * 0.6],
            outline,
          ),
        }
      }),
    )
    const placements = placePills(
      rooms.map((room) => room.candidate),
      { width: 1200, height: 800 },
    )
    const placed = rooms.flatMap(({ box, candidate }) => {
      const rect = placedRect(candidate, placements.get(candidate.id)!)
      return rect ? [{ box, rect }] : []
    })
    expect(placed.length).toBeGreaterThan(30)
    for (const { box, rect } of placed) {
      expect(rect.left).toBeGreaterThanOrEqual(box.left)
      expect(rect.right).toBeLessThanOrEqual(box.right)
      expect(rect.top).toBeGreaterThanOrEqual(box.top)
      expect(rect.bottom).toBeLessThanOrEqual(box.bottom)
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = 0; j < i; j++) expect(near(placed[i]!.rect, placed[j]!.rect)).toBe(false)
    }
  })
})

describe('the room under the pointer', () => {
  const room = (zoneId: string, polygon: Polygon, area: number): RoomLabelEntry => ({
    zoneId,
    polygon: polygon.outer,
    holes: polygon.holes,
    area,
  })
  const hall = room('hall', square(5, 5, 10), 100)
  const nook = room('nook', square(2, 2, 3), 9)
  const atrium = room('atrium', { ...square(25, 5, 10), holes: [square(25, 5, 4).outer] }, 84)

  test('is the smallest room holding the point: a zone drawn inside the room it stands in', () => {
    const at = (x: number, y: number) => roomAt([hall, nook, atrium], () => [x, y, 0])
    expect(at(2, 2)).toBe('nook')
    expect(at(8, 8)).toBe('hall')
    expect(at(22, 2)).toBe('atrium')
  })

  test('is no room outside every room or inside a hole', () => {
    expect(roomAt([hall, atrium], () => [15, 5, 0])).toBeNull()
    expect(roomAt([hall, atrium], () => [25, 5, 0])).toBeNull()
  })

  test('only tests a room where the pointer meets its own plane', () => {
    expect(roomAt([hall, nook], (entry) => (entry === nook ? null : [2, 2, 0]))).toBe('hall')
  })

  test('is the floor the pointer reaches first, before a smaller one further down', () => {
    // A raised floor over the whole hall, and a small room on the floor below it.
    const raised = room('raised', square(5, 5, 10), 100)
    const below = room('below', square(5, 5, 2), 4)
    const hits = new Map<RoomLabelEntry, RoomHit>([
      [raised, [5, 5, 3]],
      [below, [5, 5, 6]],
    ])
    expect(roomAt([raised, below], (entry) => hits.get(entry) ?? null)).toBe('raised')
    // Met at the same distance, they are one floor: the smaller wins.
    hits.set(raised, [5, 5, 6 + 1e-4])
    expect(roomAt([raised, below], (entry) => hits.get(entry) ?? null)).toBe('below')
  })
})

describe('pills in 3D', () => {
  test('a corridor running behind the camera still holds its pill to its width', () => {
    // 0.3 m wide and 20 m long, half of it behind a camera standing in it.
    const corridor: RoomLabelEntry = {
      zoneId: 'corridor',
      polygon: [
        [-0.15, -10],
        [0.15, -10],
        [0.15, 10],
        [-0.15, 10],
      ],
      holes: [],
      area: 6,
    }
    const camera = new PerspectiveCamera(50, 1440 / 900, 0.1, 1000)
    camera.position.set(0, 1.6, 0)
    camera.updateMatrixWorld()
    const level = new Object3D()
    level.updateMatrixWorld()
    const size = { width: 1440, height: 900 }
    const [candidate] = candidates3D(
      [corridor],
      new Map([['corridor', new Vector3(0, 1.25, -5)]]),
      new Map<string, PillSize>([['corridor', [120, 24, 70]]]),
      camera,
      level,
      size,
    )
    expect(
      candidate!.outline.outer.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
    ).toBe(true)
    // About 58 px wide where the pill would sit: only its dot fits.
    expect(placePills([candidate!], size).get('corridor')).toEqual({ tier: 'dot', dy: 0 })
  })
})

describe('when pills re-read their overlaps', () => {
  // Camera damping after a zoom: each frame moves the camera by a shrinking
  // fraction of a millimetre for a second or more after it visibly stops.
  const settling = (frame: number) => {
    const view = new Float64Array(50)
    view[12] = 30 + 1e-5 * 0.8 ** frame
    view[48] = 1500
    view[49] = 900
    return view
  }

  test('once the camera has visibly stopped, not once damping stops nudging it', () => {
    const clock = new DeclutterClock()
    const frame = 1 / 60
    let firstRead = -1
    for (let i = 0; i < 120; i++) {
      if (clock.shouldRead(settling(i), i * frame) && i > 0) {
        firstRead = i
        break
      }
    }
    // Within the rest delay (0.12 s ≈ 7 frames at 60 fps), not two seconds later.
    expect(firstRead).toBeGreaterThan(0)
    expect(firstRead * frame).toBeLessThan(0.2)
  })

  test('once per rest, not while moving, and again when the pills change at rest', () => {
    const clock = new DeclutterClock()
    const at = (x: number) => {
      const view = new Float64Array(50)
      view[12] = x
      return view
    }
    expect(clock.shouldRead(at(0), 0)).toBe(false)
    expect(clock.shouldRead(at(0), 0.2)).toBe(true)
    expect(clock.atRest).toBe(true)
    expect(clock.shouldRead(at(0), 0.4)).toBe(false)
    // Moving: pills ride their rooms, nothing is re-placed until it rests.
    const moving = [0.5, 0.55, 0.6, 0.65, 0.7].map((t) => clock.shouldRead(at(t), t))
    expect(moving.some(Boolean)).toBe(false)
    expect(clock.atRest).toBe(false)
    expect(clock.shouldRead(at(0.7), 0.85)).toBe(true)
    clock.invalidate()
    expect(clock.shouldRead(at(0.7), 0.86)).toBe(true)
  })

  test('a room whose anchor moves has the pills placed again', () => {
    const anchors = new RoomAnchors()
    let moves = 0
    anchors.onMove = () => moves++
    anchors.set('kitchen', new Vector3(1, 1.25, 2))
    anchors.set('kitchen', new Vector3(1, 1.25, 2))
    expect(moves).toBe(1)
    anchors.set('kitchen', new Vector3(1, 1.75, 2))
    expect(moves).toBe(2)
  })
})

describe('applying placements', () => {
  const element = () =>
    ({
      dataset: {} as Record<string, string>,
      style: { translate: '' },
    }) as unknown as HTMLElement
  function setup() {
    const elements = new Map([
      ['near', element()],
      ['far', element()],
    ])
    const clock = manualClock()
    const changes: ReadonlySet<string>[] = []
    const placer = new PillPlacer(
      elements,
      (gone) => changes.push(gone),
      clock.schedule,
      clock.cancel,
    )
    return { elements, clock, changes, placer }
  }
  const has = (element: HTMLElement | undefined, flag: string) => flag in element!.dataset
  const full = (dy = 0): PillPlacement => ({ tier: 'full', dy })
  const hidden: PillPlacement = { tier: 'hidden', dy: 0 }
  const placements = (entries: [string, PillPlacement][]) => new Map(entries)

  test('a nudge is a translate, a tier is a flag, both undone when placed back', () => {
    const { elements, placer } = setup()
    placer.apply(
      placements([
        ['near', full(-8)],
        ['far', { tier: 'dot', dy: 0 }],
      ]),
      180,
    )
    expect(elements.get('near')!.style.translate).toBe('0 -8px')
    expect(elements.get('far')!.dataset.roomLabelTier).toBe('dot')
    placer.apply(
      placements([
        ['near', full()],
        ['far', { tier: 'name', dy: 0 }],
      ]),
      180,
    )
    expect(elements.get('near')!.style.translate).toBe('')
    expect(elements.get('far')!.dataset.roomLabelTier).toBe('name')
    placer.apply(
      placements([
        ['near', full()],
        ['far', full()],
      ]),
      180,
    )
    expect(has(elements.get('far'), 'roomLabelTier')).toBe(false)
  })

  test('a hidden pill fades out without taking the pointer, then leaves the DOM', () => {
    const { elements, clock, changes, placer } = setup()
    placer.apply(
      placements([
        ['near', full()],
        ['far', hidden],
      ]),
      180,
    )
    expect(has(elements.get('far'), 'roomLabelHidden')).toBe(true)
    clock.advance(179)
    expect(changes).toEqual([])
    clock.advance(1)
    expect(placer.gone).toEqual(new Set(['far']))
  })

  test('a pill given room again mounts in its new place, or turns back mid-fade', () => {
    const { elements, clock, placer } = setup()
    placer.apply(placements([['far', hidden]]), 180)
    clock.advance(180)
    const far = elements.get('far')!
    elements.delete('far')
    placer.apply(placements([['far', full(12)]]), 180)
    expect(placer.gone).toEqual(new Set())
    placer.mount('far', far)
    expect(far.style.translate).toBe('0 12px')
    expect(has(far, 'roomLabelHidden')).toBe(false)

    const again = setup()
    again.placer.apply(placements([['far', hidden]]), 180)
    again.placer.apply(placements([['far', full()]]), 180)
    again.clock.advance(500)
    expect(again.placer.gone).toEqual(new Set())
    expect(has(again.elements.get('far'), 'roomLabelHidden')).toBe(false)
  })

  test('a pill no pass has placed waits hidden, still mounted, until one places it', () => {
    const { elements, clock, placer } = setup()
    const near = elements.get('near')!
    placer.mount('near', near)
    expect(has(near, 'roomLabelHidden')).toBe(true)
    // Not measured yet, so not a candidate: it stays hidden and is not removed.
    placer.apply(placements([['far', full()]]), 180)
    expect(has(near, 'roomLabelHidden')).toBe(true)
    expect(clock.pending()).toBe(0)
    placer.apply(
      placements([
        ['near', full()],
        ['far', full()],
      ]),
      180,
    )
    expect(has(near, 'roomLabelHidden')).toBe(false)
    // Its anchor leaves the screen: hidden again, and still mounted.
    placer.apply(placements([['far', full()]]), 180)
    expect(has(near, 'roomLabelHidden')).toBe(true)
    clock.advance(500)
    expect(placer.gone).toEqual(new Set())
  })

  test('hidden pills can refresh their text measurements without becoming visible', () => {
    const { elements, clock, placer } = setup()
    placer.apply(placements([['far', hidden]]), 180)
    clock.advance(180)
    elements.delete('far')
    placer.remeasure()
    expect(placer.gone.size).toBe(0)
    const fresh = element()
    elements.set('far', fresh)
    placer.mount('far', fresh)
    expect(has(fresh, 'roomLabelHidden')).toBe(true)
    placer.apply(placements([['far', full()]]), 180)
    expect(has(fresh, 'roomLabelHidden')).toBe(false)
  })

  test('the whole layer fades out and back in, except pills still hidden', () => {
    const { elements, placer } = setup()
    placer.apply(
      placements([
        ['near', full()],
        ['far', hidden],
      ]),
      180,
    )
    placer.showAll(false)
    expect(has(elements.get('near'), 'roomLabelHidden')).toBe(true)
    placer.showAll(true)
    expect(has(elements.get('near'), 'roomLabelHidden')).toBe(false)
    expect(has(elements.get('far'), 'roomLabelHidden')).toBe(true)
  })

  test('the pills under the detail chip fade out of its way, and come back', () => {
    const { elements, placer } = setup()
    placer.suppress(new Set(['near', 'far']), 'far')
    expect(has(elements.get('near'), 'roomLabelSuppressed')).toBe(true)
    // The open room's own pill fades under its chip but stays the control.
    expect(has(elements.get('far'), 'roomLabelSuppressed')).toBe(false)
    expect(has(elements.get('far'), 'roomLabelOpen')).toBe(true)
    const remounted = element()
    placer.mount('near', remounted)
    expect(has(remounted, 'roomLabelSuppressed')).toBe(true)
    placer.suppress(new Set(), null)
    expect(has(elements.get('near'), 'roomLabelSuppressed')).toBe(false)
    expect(has(elements.get('far'), 'roomLabelOpen')).toBe(false)
  })

  test('with the default timers, a pill hiding never stops the pills after it', () => {
    // Browser timers throw when called as a method of anything but the window.
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    const clock = manualClock()
    function strictSetTimeout(this: unknown, run: () => void, ms: number) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return clock.schedule(run, ms)
    }
    function strictClearTimeout(this: unknown, timer: Timer) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      clock.cancel(timer)
    }
    globalThis.setTimeout = strictSetTimeout as unknown as typeof setTimeout
    globalThis.clearTimeout = strictClearTimeout as unknown as typeof clearTimeout
    try {
      const elements = new Map([
        ['a', element()],
        ['b', element()],
      ])
      const placer = new PillPlacer(elements, () => {})
      placer.apply(
        placements([
          ['a', hidden],
          ['b', full(8)],
        ]),
        180,
      )
      expect(elements.get('b')!.style.translate).toBe('0 8px')
      clock.advance(180)
      expect(placer.gone).toEqual(new Set(['a']))

      placer.apply(placements([['b', hidden]]), 180)
      placer.apply(placements([['b', full()]]), 180)
      clock.advance(180)
      expect(placer.gone).toEqual(new Set(['a']))
      expect(has(elements.get('b'), 'roomLabelHidden')).toBe(false)

      const reveal = new LabelReveal(() => {})
      reveal.pick('b')
      reveal.pick('a')
      reveal.clear()
      expect(clock.pending()).toBe(0)
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    }
  })
})

describe("a room's detail", () => {
  function setup() {
    const clock = manualClock()
    const changes: (string | null)[] = []
    const focused: boolean[] = []
    const reveal = new LabelReveal(
      (id, isFocused) => {
        changes.push(id)
        focused.push(isFocused)
      },
      clock.schedule,
      clock.cancel,
    )
    return { clock, changes, focused, reveal }
  }

  test('opens at once for a pill under the pointer, after a short rest for a room under it', () => {
    const { clock, changes, reveal } = setup()
    reveal.hover('closet')
    expect(changes).toEqual(['closet'])
    reveal.hover(null)
    clock.advance(REVEAL_GRACE_MS)
    expect(changes).toEqual(['closet', null])
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS - 1)
    expect(reveal.active).toBeNull()
    clock.advance(1)
    expect(reveal.active).toBe('bath')
  })

  test('hands over from room to room with one detail open, and opens nothing for a room passed over', () => {
    const { clock, changes, reveal } = setup()
    reveal.pick('hall')
    clock.advance(REVEAL_DWELL_MS)
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS - 1)
    expect(reveal.active).toBe('hall')
    clock.advance(1)
    reveal.pick('closet')
    clock.advance(REVEAL_DWELL_MS / 2)
    reveal.pick('bedroom')
    clock.advance(REVEAL_DWELL_MS / 2)
    expect(reveal.active).toBe('bath')
    clock.advance(REVEAL_DWELL_MS / 2)
    expect(changes).toEqual(['hall', 'bath', 'bedroom'])
  })

  test('stays a moment after the pointer leaves its room, and stays if it comes back', () => {
    const { clock, changes, reveal } = setup()
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS)
    reveal.pick(null)
    clock.advance(REVEAL_GRACE_MS - 1)
    reveal.pick('bath')
    clock.advance(1000)
    expect(changes).toEqual(['bath'])
    reveal.pick(null)
    clock.advance(REVEAL_GRACE_MS)
    expect(changes).toEqual(['bath', null])
  })

  test('opens at once for keyboard focus, and says so while that pill keeps it', () => {
    const { clock, changes, focused, reveal } = setup()
    reveal.focus('kitchen')
    reveal.hover('kitchen')
    reveal.hover(null)
    reveal.focus(null)
    clock.advance(REVEAL_GRACE_MS)
    expect(changes).toEqual(['kitchen', null])
    expect(focused).toEqual([true, false])
  })

  test('with the pointer on one pill and focus on another, the one that moved last wins', () => {
    const { changes, focused, reveal } = setup()
    reveal.hover('kitchen')
    reveal.focus('bath')
    expect(reveal.active).toBe('bath')
    reveal.hover('kitchen')
    expect(reveal.active).toBe('bath')
    reveal.hover('closet')
    reveal.focus('hall')
    reveal.hover(null)
    expect(changes).toEqual(['kitchen', 'bath', 'closet', 'hall'])
    expect(focused).toEqual([false, true, false, true])
  })

  test('Escape closes it until the pointer or focus moves on to another room', () => {
    const { clock, changes, reveal } = setup()
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS)
    reveal.dismiss()
    reveal.pick('bath')
    clock.advance(1000)
    reveal.hover('bath')
    expect(changes).toEqual(['bath', null])
    reveal.hover(null)
    reveal.pick('closet')
    clock.advance(REVEAL_DWELL_MS)
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS)
    expect(changes).toEqual(['bath', null, 'closet', 'bath'])
  })

  test('a focused pill opens again once the view rests', () => {
    const { changes, reveal } = setup()
    reveal.focus('kitchen')
    reveal.clear()
    reveal.pick(null)
    expect(changes).toEqual(['kitchen', null, 'kitchen'])
  })

  test('closes at once when the view moves, and forgets the pointer', () => {
    const { clock, reveal } = setup()
    reveal.pick('bath')
    clock.advance(REVEAL_DWELL_MS)
    reveal.clear()
    expect(reveal.active).toBeNull()
    clock.advance(1000)
    expect(reveal.active).toBeNull()
    expect(clock.pending()).toBe(0)
  })

  test('fades out exactly the pills within the gap of its chip', () => {
    const chip = { left: 0, top: 0, right: 100, bottom: 24 }
    const rects = new Map([
      ['under', { left: 50, top: 10, right: 80, bottom: 30 }],
      ['touching', { left: 100 + PILL_GAP - 1, top: 0, right: 140, bottom: 20 }],
      ['clear', { left: 100 + PILL_GAP, top: 0, right: 140, bottom: 20 }],
      ['far', { left: 400, top: 400, right: 450, bottom: 420 }],
    ])
    expect(suppressedBy(chip, rects)).toEqual(new Set(['under', 'touching']))
  })
})
