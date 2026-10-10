import { describe, expect, test } from 'bun:test'
import { ZoneNode } from '@pascal-app/core/schema'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import {
  DeclutterClock,
  formatRoomArea,
  measureFullPill,
  PILL_DOT_SIZE,
  type PillCandidate,
  type PillPlacement,
  PillPlacer,
  pillRect,
  placePills,
  type RoomLabelVisibilityState,
  roomLabelEntries,
  roomLabelsVisible,
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

  test('a collapsed pill measures its updated full label and stays collapsed', () => {
    const element = { dataset: { roomLabelCollapsed: '' } } as unknown as HTMLElement
    let width = 161.5
    const read = (target: HTMLElement) => ({
      width: 'roomLabelCollapsed' in target.dataset ? '16px' : `${width}px`,
      height: 'roomLabelCollapsed' in target.dataset ? '16px' : '26px',
    })
    expect(measureFullPill(element, read)).toEqual([161.5, 26])
    width = 176.25
    expect(measureFullPill(element, read)).toEqual([176.25, 26])
    expect(element.dataset.roomLabelCollapsed).toBe('')
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
})

describe('pill placement', () => {
  const pill = (id: string, x: number, y: number, area: number, width = 120): PillCandidate => ({
    id,
    x,
    y,
    size: [width, 24],
    area,
  })
  const rectOf = (candidate: PillCandidate, dy: number, dot: boolean) =>
    pillRect(candidate.x, candidate.y + dy, dot ? [PILL_DOT_SIZE, PILL_DOT_SIZE] : candidate.size)
  const apart = (a: ReturnType<typeof pillRect>, b: ReturnType<typeof pillRect>) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top

  test('apart, every pill stays on its room', () => {
    const placements = placePills([pill('a', 100, 100, 20), pill('b', 400, 100, 10)])
    expect([...placements.values()]).toEqual([
      { mode: 'full', dy: 0 },
      { mode: 'full', dy: 0 },
    ])
  })

  test('two overlapping pills: the larger room keeps its place, the other moves the least it can', () => {
    const big = pill('big', 100, 100, 30)
    const small = pill('small', 110, 106, 10)
    const placements = placePills([small, big])
    expect(placements.get('big')).toEqual({ mode: 'full', dy: 0 })
    const moved = placements.get('small')!
    expect(moved.mode).toBe('full')
    expect(Math.abs(moved.dy)).toBeLessThanOrEqual(24)
    expect(apart(rectOf(big, 0, false), rectOf(small, moved.dy, false))).toBe(true)
    // 24 px tall, 6 px apart, 2 px gap: 20 px down is the nearest clear slot (up needs 32).
    expect(moved.dy).toBe(20)
  })

  test('crowded beyond a pill height, a pill collapses to its dot; hidden only if the dot collides too', () => {
    const wide = pill('wide', 200, 100, 40, 300)
    const above = pill('above', 200, 74, 30, 300)
    const below = pill('below', 200, 126, 20, 300)
    const squeezed = pill('squeezed', 120, 100, 10)
    const placements = placePills([squeezed, below, above, wide])
    expect(placements.get('wide')?.mode).toBe('full')
    expect(placements.get('above')?.mode).toBe('full')
    expect(placements.get('below')?.mode).toBe('full')
    // Its dot sits inside the wide pill: nothing left but to hide it.
    expect(placements.get('squeezed')).toEqual({ mode: 'hidden', dy: 0 })

    const nearEdge = pill('near-edge', 30, 100, 10)
    const crowded = placePills([nearEdge, below, above, wide])
    // Its full pill still collides, but its dot at the anchor is clear.
    expect(crowded.get('near-edge')).toEqual({ mode: 'dot', dy: 0 })
  })

  test('a dot with no room at its anchor takes the nearest free slot instead of hiding', () => {
    const big = pill('big', 100, 100, 30)
    const closet = pill('closet', 100, 100, 5)
    const placements = placePills([closet, big])
    // The full pill would need 26 px (past its 24 px budget); its dot clears at 24 px up.
    expect(placements.get('closet')).toEqual({ mode: 'dot', dy: -24 })
    expect(apart(rectOf(big, 0, false), rectOf(closet, -24, true))).toBe(true)
  })

  test('the order is fixed by room size and id, not by input order', () => {
    const candidates = [pill('b', 100, 100, 10), pill('a', 105, 100, 10), pill('c', 110, 100, 10)]
    const first = placePills(candidates)
    const shuffled = placePills([candidates[2]!, candidates[0]!, candidates[1]!])
    expect(shuffled).toEqual(first)
    expect(first.get('a')).toEqual({ mode: 'full', dy: 0 })
  })

  test('no two placed boxes ever overlap', () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      pill(
        `p${i}`,
        100 + ((i * 37) % 220),
        100 + ((i * 53) % 140),
        (i * 7) % 13,
        90 + (i % 5) * 20,
      ),
    )
    const placements = placePills(candidates)
    const boxes = candidates.flatMap((candidate) => {
      const placement = placements.get(candidate.id)!
      return placement.mode === 'hidden'
        ? []
        : [rectOf(candidate, placement.dy, placement.mode === 'dot')]
    })
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) expect(apart(boxes[i]!, boxes[j]!)).toBe(true)
    }
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
    expect(clock.shouldRead(at(0), 0.4)).toBe(false)
    // Moving: pills ride their rooms, nothing is re-placed until it rests.
    const moving = [0.5, 0.55, 0.6, 0.65, 0.7].map((t) => clock.shouldRead(at(t), t))
    expect(moving.some(Boolean)).toBe(false)
    expect(clock.shouldRead(at(0.7), 0.85)).toBe(true)
    clock.invalidate()
    expect(clock.shouldRead(at(0.7), 0.86)).toBe(true)
  })
})

describe('applying placements', () => {
  function setup() {
    const element = () =>
      ({
        dataset: {} as Record<string, string>,
        style: { translate: '' },
      }) as unknown as HTMLElement
    const elements = new Map([
      ['near', element()],
      ['far', element()],
    ])
    const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const changes: ReadonlySet<string>[] = []
    const placer = new PillPlacer(
      elements,
      (gone) => changes.push(gone),
      (run, ms) => {
        const timer = { run, ms, cancelled: false }
        timers.push(timer)
        return timer as unknown as ReturnType<typeof setTimeout>
      },
      (timer) => {
        ;(timer as unknown as { cancelled: boolean }).cancelled = true
      },
    )
    return { elements, timers, changes, placer }
  }
  const has = (element: HTMLElement | undefined, flag: string) => flag in element!.dataset
  const full = (dy = 0) => ({ mode: 'full' as const, dy })

  test('a nudge is a translate, a dot is a collapsed pill, both undone when placed back', () => {
    const { elements, placer } = setup()
    placer.apply(
      new Map<string, PillPlacement>([
        ['near', full(-8)],
        ['far', { mode: 'dot' as const, dy: 0 }],
      ]),
      180,
    )
    expect(elements.get('near')!.style.translate).toBe('0 -8px')
    expect(has(elements.get('far'), 'roomLabelCollapsed')).toBe(true)
    placer.apply(
      new Map<string, PillPlacement>([
        ['near', full()],
        ['far', full()],
      ]),
      180,
    )
    expect(elements.get('near')!.style.translate).toBe('')
    expect(has(elements.get('far'), 'roomLabelCollapsed')).toBe(false)
  })

  test('a hidden pill fades out without taking the pointer, then leaves the DOM', () => {
    const { elements, timers, changes, placer } = setup()
    placer.apply(
      new Map<string, PillPlacement>([
        ['near', full()],
        ['far', { mode: 'hidden' as const, dy: 0 }],
      ]),
      180,
    )
    expect(has(elements.get('far'), 'roomLabelHidden')).toBe(true)
    expect(timers.map(({ ms }) => ms)).toEqual([180])
    expect(changes).toEqual([])
    timers[0]!.run()
    expect(placer.gone).toEqual(new Set(['far']))
  })

  test('a pill given room again mounts in its new place, or turns back mid-fade', () => {
    const { elements, timers, placer } = setup()
    placer.apply(new Map<string, PillPlacement>([['far', { mode: 'hidden' as const, dy: 0 }]]), 180)
    timers[0]!.run()
    const element = elements.get('far')!
    elements.delete('far')
    placer.apply(new Map<string, PillPlacement>([['far', full(12)]]), 180)
    expect(placer.gone).toEqual(new Set())
    placer.mount('far', element)
    expect(element.style.translate).toBe('0 12px')

    const again = setup()
    again.placer.apply(
      new Map<string, PillPlacement>([['far', { mode: 'hidden' as const, dy: 0 }]]),
      180,
    )
    again.placer.apply(new Map<string, PillPlacement>([['far', full()]]), 180)
    expect(again.timers[0]!.cancelled).toBe(true)
    expect(has(again.elements.get('far'), 'roomLabelHidden')).toBe(false)
  })

  test('hidden pills can refresh their text measurements without becoming visible', () => {
    const { elements, timers, placer } = setup()
    placer.apply(new Map<string, PillPlacement>([['far', { mode: 'hidden', dy: 0 }]]), 180)
    timers[0]!.run()
    elements.delete('far')
    placer.remeasure()
    expect(placer.gone.size).toBe(0)
    const fresh = { dataset: {}, style: { translate: '' } } as unknown as HTMLElement
    elements.set('far', fresh)
    placer.mount('far', fresh)
    expect(has(fresh, 'roomLabelHidden')).toBe(true)
    placer.apply(new Map<string, PillPlacement>([['far', full()]]), 180)
    expect(has(fresh, 'roomLabelHidden')).toBe(false)
  })

  test('the whole layer fades out and back in, except pills still hidden', () => {
    const { elements, placer } = setup()
    placer.apply(new Map<string, PillPlacement>([['far', { mode: 'hidden' as const, dy: 0 }]]), 180)
    placer.showAll(false)
    expect(has(elements.get('near'), 'roomLabelHidden')).toBe(true)
    placer.showAll(true)
    expect(has(elements.get('near'), 'roomLabelHidden')).toBe(false)
    expect(has(elements.get('far'), 'roomLabelHidden')).toBe(true)
  })
})
