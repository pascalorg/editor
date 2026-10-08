import { describe, expect, test } from 'bun:test'
import {
  DeclutterClock,
  declutterLabels,
  formatRoomArea,
  PillFades,
  pillRect,
  type RoomLabelVisibilityState,
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

  test('overlapping pills keep the nearer one; apart, all stay', () => {
    const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 24 })
    expect(
      declutterLabels([
        { id: 'far', distance: 12, rect: rect(40, 10) },
        { id: 'near', distance: 4, rect: rect(0, 0) },
        { id: 'apart', distance: 20, rect: rect(300, 0) },
        { id: 'behind-far', distance: 30, rect: rect(60, 20) },
      ]),
    ).toEqual(new Set(['far', 'behind-far']))
    expect(
      declutterLabels([
        { id: 'a', distance: 1, rect: rect(0, 0) },
        { id: 'b', distance: 2, rect: rect(0, 40) },
      ]).size,
    ).toBe(0)
  })

  test('a pill is placed centred on where its anchor lands', () => {
    expect(pillRect(100, 50, [80, 20])).toEqual({ left: 60, top: 40, right: 140, bottom: 60 })
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

  test('once per rest, every so often while moving, and at once when the pills change', () => {
    const clock = new DeclutterClock()
    const at = (x: number) => {
      const view = new Float64Array(50)
      view[12] = x
      return view
    }
    expect(clock.shouldRead(at(0), 0)).toBe(true)
    expect(clock.shouldRead(at(0), 0.2)).toBe(true)
    expect(clock.shouldRead(at(0), 0.4)).toBe(false)
    // Moving: a read every 0.3 s, not every frame.
    const moving = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85].map((t) =>
      clock.shouldRead(at(t), t),
    )
    expect(moving.filter(Boolean).length).toBe(2)
    clock.invalidate()
    expect(clock.shouldRead(at(0.85), 0.86)).toBe(true)
  })
})

describe('pill fades', () => {
  function setup() {
    const elements = new Map(
      ['near', 'far'].map((id) => [id, { dataset: {} as Record<string, string> } as HTMLElement]),
    )
    const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
    const changes: ReadonlySet<string>[] = []
    const fades = new PillFades(
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
    return { elements, timers, changes, fades }
  }
  const hidden = (element: HTMLElement | undefined) => 'roomLabelHidden' in element!.dataset

  test('a pill that steps aside fades out without taking the pointer, then leaves the DOM', () => {
    const { elements, timers, changes, fades } = setup()
    fades.apply(new Set(['far']), 180)
    expect(hidden(elements.get('far'))).toBe(true)
    expect(hidden(elements.get('near'))).toBe(false)
    expect(timers.map(({ ms }) => ms)).toEqual([180])
    expect(changes).toEqual([])
    timers[0]!.run()
    expect(changes.at(-1)).toEqual(new Set(['far']))
    expect(fades.gone).toEqual(new Set(['far']))
  })

  test('a pill given room again mounts and fades back in', () => {
    const { elements, timers, fades } = setup()
    fades.apply(new Set(['far']), 180)
    timers[0]!.run()
    elements.delete('far')
    fades.apply(new Set(), 180)
    expect(fades.gone).toEqual(new Set())
  })

  test('a pill given room mid-fade turns back without leaving', () => {
    const { elements, timers, changes, fades } = setup()
    fades.apply(new Set(['far']), 180)
    fades.apply(new Set(), 180)
    expect(timers[0]!.cancelled).toBe(true)
    expect(hidden(elements.get('far'))).toBe(false)
    expect(changes).toEqual([])
  })

  test('the whole layer fades out and back in, except pills still stepping aside', () => {
    const { elements, fades } = setup()
    fades.apply(new Set(['far']), 180)
    fades.showAll(false)
    expect(hidden(elements.get('near'))).toBe(true)
    fades.showAll(true)
    expect(hidden(elements.get('near'))).toBe(false)
    expect(hidden(elements.get('far'))).toBe(true)
  })
})
