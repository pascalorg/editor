import type { LawnBuild } from '@pascal-app/core'
import { type Group, MeshStandardMaterial } from 'three'
import { addLawnBakeMesh } from './bake-mesh'
import { cutoutAlpha, lawnBakeMaterial, pictureSampler, srgbByte } from './bake-textures'
import { corollaMap } from './flower-material'

const SIZE = 1024
const PAD = 2

type Flowers = LawnBuild['flowers']
type Recipe = {
  width: number
  height: number
  minU: number
  minV: number
  spanU: number
  spanV: number
  uv: number[]
  colors: number[]
  clover: boolean
}
type Stamp = Recipe & { x: number; y: number }
type Page = {
  stamps: Stamp[]
  faces: { triangle: number; stamp: Stamp; uv: number[] }[]
  x: number
  y: number
  row: number
}

function newPage(): Page {
  return { stamps: [], faces: [], x: 0, y: 0, row: 0 }
}

function flowerRecipe(flowers: Flowers, triangle: number) {
  const corners = [0, 1, 2].map((i) => flowers.indices[triangle + i] ?? 0)
  const rawUV = corners.flatMap((i) => [flowers.uv[i * 2] ?? 0, flowers.uv[i * 2 + 1] ?? 0])
  // Match the packed linear vertex pigments used by the live flower mesh.
  const colors = corners.flatMap((i) =>
    Array.from(flowers.colors.subarray(i * 3, i * 3 + 3), (c) => Math.round(c * 255) / 255),
  )
  const uv = rawUV.map((value) => value / 65535)
  let minU = Math.min(uv[0] ?? 0, uv[2] ?? 0, uv[4] ?? 0),
    minV = Math.min(uv[1] ?? 0, uv[3] ?? 0, uv[5] ?? 0)
  let spanU = Math.max(uv[0] ?? 0, uv[2] ?? 0, uv[4] ?? 0) - minU,
    spanV = Math.max(uv[1] ?? 0, uv[3] ?? 0, uv[5] ?? 0) - minV
  const clover = minU > 0.5 && minV + spanV < 0.5
  const uniform = colors.every((color, i) => color === colors[i % 3])
  // Most heads have a uniform species pigment. Share the full tinted picture,
  // including rotated yarrow UVs, instead of making another stamp per blossom.
  if (uniform) {
    minU = minV = 0
    spanU = spanV = 1
  }
  const width = Math.max(1, Math.ceil(spanU * 256)) + PAD * 2,
    height = Math.max(1, Math.ceil(spanV * 256)) + PAD * 2
  const key = uniform
    ? `${colors.slice(0, 3).join(',')};${clover}`
    : `${rawUV.join(',')};${colors.join(',')}`
  return { key, uv, recipe: { width, height, minU, minV, spanU, spanV, uv, colors, clover } }
}

function placeStamp(pages: Page[], recipe: Recipe) {
  let page = pages[pages.length - 1]
  if (!page) throw new Error('Lawn flower atlas has no page for its stamp.')
  if (page.x + recipe.width > SIZE) {
    page.x = 0
    page.y += page.row
    page.row = 0
  }
  if (page.y + recipe.height > SIZE) {
    page = newPage()
    pages.push(page)
  }
  const stamp = { ...recipe, x: page.x, y: page.y }
  page.x += recipe.width
  page.row = Math.max(page.row, recipe.height)
  page.stamps.push(stamp)
  return { page, stamp }
}

function collectPages(flowers: Flowers) {
  const pages: Page[] = [newPage()]
  const stamps = new Map<string, { page: Page; stamp: Stamp }>()
  for (let triangle = 0; triangle < flowers.indices.length; triangle += 3) {
    const { key, recipe, uv } = flowerRecipe(flowers, triangle)
    let entry = stamps.get(key)
    if (!entry) {
      entry = placeStamp(pages, recipe)
      stamps.set(key, entry)
    }
    entry.page.faces.push({ triangle, stamp: entry.stamp, uv })
  }
  return pages
}

function paintStamp(stamp: Stamp, pixels: Uint8Array, sample: ReturnType<typeof pictureSampler>) {
  const [au = 0, av = 0, bu = 0, bv = 0, cu = 0, cv = 0] = stamp.uv
  const determinant = (bv - cv) * (au - cu) + (cu - bu) * (av - cv)
  // Standard materials cannot add the live clover's view-dependent front-face
  // coverage. Keep its rounded head solid; the atlas still supplies every floret.
  const clover = stamp.clover
  for (let y = 0; y < stamp.height; y++)
    for (let x = 0; x < stamp.width; x++) {
      const u = stamp.minU + ((x + 0.5 - PAD) / (stamp.width - PAD * 2)) * stamp.spanU,
        v = stamp.minV + ((y + 0.5 - PAD) / (stamp.height - PAD * 2)) * stamp.spanV
      let a = determinant ? ((bv - cv) * (u - cu) + (cu - bu) * (v - cv)) / determinant : 1,
        b = determinant ? ((cv - av) * (u - cu) + (au - cu) * (v - cv)) / determinant : 0,
        c = 1 - a - b
      // Extend edge pigments through the padding, rather than extrapolating HDR colours.
      a = Math.max(0, a)
      b = Math.max(0, b)
      c = Math.max(0, c)
      const total = a + b + c
      const output = ((stamp.y + y) * SIZE + stamp.x + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const tint =
          ((stamp.colors[channel] ?? 0) * a +
            (stamp.colors[channel + 3] ?? 0) * b +
            (stamp.colors[channel + 6] ?? 0) * c) /
          total
        pixels[output + channel] = srgbByte(tint * sample(u, v, channel))
      }
      pixels[output + 3] = cutoutAlpha(clover ? 1 : sample(u, v, 3))
    }
}

function pageGeometry(flowers: Flowers, page: Page, height: number) {
  const count = page.faces.length * 3
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    indices = new Uint32Array(count)
  for (const [face, { triangle, stamp, uv: sourceUV }] of page.faces.entries()) {
    for (let corner = 0; corner < 3; corner++) {
      const source = flowers.indices[triangle + corner] ?? 0,
        target = face * 3 + corner
      positions.set(flowers.positions.subarray(source * 3, source * 3 + 3), target * 3)
      for (let channel = 0; channel < 3; channel++)
        normals[target * 3 + channel] =
          Math.round((flowers.normals[source * 3 + channel] ?? 0) * 127) / 127
      const u = sourceUV[corner * 2] ?? 0,
        v = sourceUV[corner * 2 + 1] ?? 0
      uv[target * 2] =
        (stamp.x +
          PAD +
          (stamp.spanU ? (u - stamp.minU) / stamp.spanU : 0.5) * (stamp.width - PAD * 2)) /
        SIZE
      uv[target * 2 + 1] =
        (stamp.y +
          PAD +
          (stamp.spanV ? (v - stamp.minV) / stamp.spanV : 0.5) * (stamp.height - PAD * 2)) /
        height
      indices[target] = target
    }
  }
  return { positions, normals, uv, indices }
}

/** Compose the corolla and species pigments before generic portable normalization. */
export function addLawnBakeFlowers(group: Group, flowers: Flowers) {
  if (!flowers.count) return
  const lease = new MeshStandardMaterial()
  try {
    const sample = pictureSampler(corollaMap(lease), 4)
    for (const [pageIndex, page] of collectPages(flowers).entries()) {
      const height = Math.min(SIZE, 2 ** Math.ceil(Math.log2(page.y + page.row)))
      const pixels = new Uint8Array(SIZE * height * 4)
      for (const stamp of page.stamps) paintStamp(stamp, pixels, sample)
      const material = lawnBakeMaterial(
        'lawn-flower-colours-and-corollas',
        pixels,
        SIZE,
        height,
        0.95,
        0.28,
      )
      addLawnBakeMesh(
        group,
        pageGeometry(flowers, page, height),
        material,
        pageIndex ? `lawn-flowers-${pageIndex}` : 'lawn-flowers',
      )
    }
  } finally {
    lease.dispose()
  }
}
