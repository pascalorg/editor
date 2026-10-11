import { WallNode } from '../../schema'
import { extractRooms } from '../room-graph'

// How room extraction's time grows from 250 to 2,000 isolated walls, printed as JSON. The
// near-linear test runs this in a fresh process: inside the suite, the heap the other test files
// leave behind makes the large run pay for collections the small one doesn't.
const walls = Array.from({ length: 2000 }, (_, i) =>
  WallNode.parse({
    start: [(i % 50) * 3, Math.floor(i / 50) * 3],
    end: [(i % 50) * 3 + 2, Math.floor(i / 50) * 3 + 1],
  }),
)
const smaller = walls.slice(0, 250)
let rooms = 0
const timed = (input: WallNode[]) => {
  Bun.gc(true)
  const started = performance.now()
  rooms += extractRooms(input).length
  return performance.now() - started
}
let small = Number.POSITIVE_INFINITY
let large = Number.POSITIVE_INFINITY
for (let i = 0; i < 8; i++) {
  small = Math.min(small, timed(smaller))
  large = Math.min(large, timed(walls))
}
console.log(JSON.stringify({ ratio: large / small, small, large, rooms }))
