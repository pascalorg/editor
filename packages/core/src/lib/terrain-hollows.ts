/**
 * Closed hollows of a ground: places water cannot leave by running downhill. The ground is read on
 * a square grid over a rectangle and flooded from its border inward, lowest first (a priority
 * flood): each cell's water level is the lowest height it must rise to before it spills toward
 * the border. A cell whose water level stands over its ground is in a hollow, by that depth.
 *
 * `blocked` cells neither hold nor pass water (a house): a pocket between a house and a bank is a
 * hollow unless the ground leads round the house.
 */
export type Hollow = {
  /** The deepest water would stand, metres, and where. */
  depthM: number
  at: [number, number]
  /** Ground under more than `minDepthM` of standing water. */
  areaM2: number
}

export type HollowScan = {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  /** Grid step; widened so the scan holds at most `MAX_HOLLOW_CELLS` cells. */
  stepM?: number
  /** Standing water shallower than this is the grid's own noise. */
  minDepthM?: number
  blocked?: (x: number, z: number) => boolean
  /** Only hollows a cell of which lies here are reported (near a house). */
  within?: (x: number, z: number) => boolean
}

export const MAX_HOLLOW_CELLS = 160_000

/** The hollows of `ground` over a rectangle: each connected patch of standing water, deepest first. */
export function closedHollows(
  ground: (x: number, z: number) => number,
  { bounds, stepM = 0.25, minDepthM = 0.03, blocked, within }: HollowScan,
): Hollow[] {
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  if (!(width > 0 && depth > 0) || !Number.isFinite(width * depth)) return []
  const step = Math.max(stepM, Math.sqrt((width * depth) / MAX_HOLLOW_CELLS))
  const cols = Math.max(2, Math.floor(width / step) + 1)
  const rows = Math.max(2, Math.floor(depth / step) + 1)
  const count = cols * rows
  const height = new Float64Array(count)
  const wall = new Uint8Array(count)
  const xOf = (index: number) => bounds.minX + (index % cols) * step
  const zOf = (index: number) => bounds.minZ + Math.floor(index / cols) * step
  for (let index = 0; index < count; index++) {
    const x = xOf(index)
    const z = zOf(index)
    if (blocked?.(x, z)) wall[index] = 1
    else height[index] = ground(x, z)
  }
  // A binary heap of cell indices, lowest water level first.
  const level = new Float64Array(count).fill(Number.NaN)
  const heap: number[] = []
  const push = (index: number) => {
    heap.push(index)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((level[heap[parent] as number] as number) <= (level[heap[i] as number] as number)) break
      ;[heap[parent], heap[i]] = [heap[i] as number, heap[parent] as number]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0] as number
    const last = heap.pop() as number
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let least = i
        if (
          left < heap.length &&
          (level[heap[left] as number] as number) < (level[heap[least] as number] as number)
        )
          least = left
        if (
          right < heap.length &&
          (level[heap[right] as number] as number) < (level[heap[least] as number] as number)
        )
          least = right
        if (least === i) break
        ;[heap[least], heap[i]] = [heap[i] as number, heap[least] as number]
        i = least
      }
    }
    return top
  }
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    if (wall[index] || (col > 0 && col < cols - 1 && row > 0 && row < rows - 1)) continue
    level[index] = height[index] as number
    push(index)
  }
  while (heap.length) {
    const index = pop()
    const col = index % cols
    const row = Math.floor(index / cols)
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const c = col + dc
      const r = row + dr
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue
      const next = r * cols + c
      if (wall[next] || !Number.isNaN(level[next] as number)) continue
      level[next] = Math.max(height[next] as number, level[index] as number)
      push(next)
    }
  }
  // Patches of standing water, by flood fill over the cells deeper than the floor of noise.
  const seen = new Uint8Array(count)
  const hollows: Hollow[] = []
  const wet = (index: number) =>
    !wall[index] &&
    !Number.isNaN(level[index] as number) &&
    (level[index] as number) - (height[index] as number) > minDepthM
  for (let start = 0; start < count; start++) {
    if (seen[start] || !wet(start)) continue
    const stack = [start]
    seen[start] = 1
    let deepest = 0
    let at = start
    let cells = 0
    let near = !within
    while (stack.length) {
      const index = stack.pop() as number
      cells++
      const depthHere = (level[index] as number) - (height[index] as number)
      if (depthHere > deepest) {
        deepest = depthHere
        at = index
      }
      if (!near && within?.(xOf(index), zOf(index))) near = true
      const col = index % cols
      const row = Math.floor(index / cols)
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const c = col + dc
        const r = row + dr
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue
        const next = r * cols + c
        if (seen[next] || !wet(next)) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    if (near) hollows.push({ depthM: deepest, at: [xOf(at), zOf(at)], areaM2: cells * step * step })
  }
  return hollows.sort((a, b) => b.depthM - a.depthM)
}
