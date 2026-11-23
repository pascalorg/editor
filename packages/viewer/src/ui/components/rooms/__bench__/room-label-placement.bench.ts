import type { Polygon } from '@pascal-app/core'
import {
  type PillCandidate,
  placePills,
  type RoomHit,
  type RoomLabelEntry,
  roomAt,
} from '../room-labels'

// One room-label placement pass and one pointer pick, for a 900 × 600 px house of 31, 60 and 120
// rooms (every third an L), printed as JSON medians in ms. Run with `bun run <this file>`.
let seed = 11
const random = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
  return seed / 2 ** 31
}

function house(count: number) {
  const columns = Math.ceil(Math.sqrt(count * 1.5))
  const rows = Math.ceil(count / columns)
  const width = 900 / columns
  const depth = 600 / rows
  return Array.from({ length: count }, (_, i) => {
    const left = 270 + (i % columns) * width
    const top = 150 + Math.floor(i / columns) * depth
    const right = left + width
    const bottom = top + depth
    const outer: [number, number][] =
      i % 3 === 0
        ? [
            [left, top],
            [right, top],
            [right, top + depth / 2],
            [left + width / 2, top + depth / 2],
            [left + width / 2, bottom],
            [left, bottom],
          ]
        : [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
          ]
    const outline: Polygon = { outer, holes: [] }
    const pill = 60 + random() * 110
    const candidate: PillCandidate = {
      id: `room_${i}`,
      x: left + width / 4,
      y: top + depth / 4,
      size: [pill, 24, pill * 0.6],
      area: width * depth * (i % 3 === 0 ? 0.75 : 1),
      outline,
    }
    const entry: RoomLabelEntry = {
      zoneId: candidate.id,
      polygon: outer,
      holes: [],
      area: candidate.area,
    }
    return { candidate, entry }
  })
}

const median = (samples: number[]) => samples.sort((a, b) => a - b)[samples.length >> 1]!

const pane = { width: 1440, height: 900 }
const results: Record<string, unknown> = {}
for (const count of [31, 60, 120]) {
  const rooms = house(count)
  const candidates = rooms.map((room) => room.candidate)
  const entries = rooms.map((room) => room.entry)
  for (let i = 0; i < 20; i++) placePills(candidates, pane)
  const cold: number[] = []
  const warm: number[] = []
  let previous = placePills(candidates, pane)
  for (let i = 0; i < 100; i++) {
    let started = performance.now()
    placePills(candidates, pane)
    cold.push(performance.now() - started)
    started = performance.now()
    previous = placePills(candidates, pane, previous)
    warm.push(performance.now() - started)
  }
  const points = Array.from(
    { length: 1000 },
    (): RoomHit => [270 + random() * 900, 150 + random() * 600, 0],
  )
  for (const point of points) roomAt(entries, () => point)
  const picks: number[] = []
  for (let i = 0; i < 20; i++) {
    const started = performance.now()
    for (const point of points) roomAt(entries, () => point)
    picks.push((performance.now() - started) / points.length)
  }
  const tiers = Object.fromEntries(
    ['full', 'name', 'dot', 'hidden'].map((tier) => [
      tier,
      [...previous.values()].filter((placement) => placement.tier === tier).length,
    ]),
  )
  results[count] = {
    placeMs: median(cold),
    placeWithPreviousMs: median(warm),
    pickMs: median(picks),
    tiers,
  }
}
console.log(JSON.stringify(results, null, 2))
