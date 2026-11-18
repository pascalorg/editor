import type { LawnBuild, LawnNode } from '@pascal-app/core'
import { type Group, MeshStandardMaterial } from 'three'
import { addLawnBakeMesh } from './bake-mesh'
import { lawnBakeMaterial, pictureSampler, srgbByte } from './bake-textures'
import { swardTexture } from './turf-textures'

const PAGE_METRES = 8
const PIXELS_PER_METRE = 128
const MAX_SIZE = 1024
const PAD = 2

type Ground = LawnBuild['base']
type Page = { triangles: number[]; minX: number; minZ: number; maxX: number; maxZ: number }
type Frame = {
  width: number
  height: number
  scaleX: number
  scaleZ: number
  minX: number
  minZ: number
}
type Sample = ReturnType<typeof pictureSampler>

function cornersOf(base: Ground, triangle: number) {
  return [0, 1, 2].map((i) => base.indices[triangle + i] ?? 0)
}

function collectPages(base: Ground) {
  const pages = new Map<string, Page>()
  for (let triangle = 0; triangle < base.indices.length; triangle += 3) {
    const corners = cornersOf(base, triangle)
    const xs = corners.map((i) => base.positions[i * 3] ?? 0),
      zs = corners.map((i) => base.positions[i * 3 + 2] ?? 0)
    const minX = Math.min(...xs),
      minZ = Math.min(...zs),
      maxX = Math.max(...xs),
      maxZ = Math.max(...zs)
    const key = `${Math.floor(minX / PAGE_METRES)},${Math.floor(minZ / PAGE_METRES)}`
    let page = pages.get(key)
    if (!page) {
      page = { triangles: [], minX, minZ, maxX, maxZ }
      pages.set(key, page)
    }
    page.triangles.push(triangle)
    page.minX = Math.min(page.minX, minX)
    page.minZ = Math.min(page.minZ, minZ)
    page.maxX = Math.max(page.maxX, maxX)
    page.maxZ = Math.max(page.maxZ, maxZ)
  }
  return [...pages.values()]
}

function pageFrame(page: Page): Frame {
  const width = Math.min(MAX_SIZE, Math.ceil((page.maxX - page.minX) * PIXELS_PER_METRE) + PAD * 2),
    height = Math.min(MAX_SIZE, Math.ceil((page.maxZ - page.minZ) * PIXELS_PER_METRE) + PAD * 2)
  return {
    width,
    height,
    minX: page.minX,
    minZ: page.minZ,
    scaleX: (width - PAD * 2) / (page.maxX - page.minX),
    scaleZ: (height - PAD * 2) / (page.maxZ - page.minZ),
  }
}

// Padding belongs outside the retained footprint, not to a new ground triangle.
function padEdges(pixels: Uint8Array, width: number, height: number) {
  for (let pass = 0; pass < PAD; pass++) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        if (pixels[at + 3]) continue
        let neighbour = -1
        if (x > 0 && pixels[at - 1] === 255) neighbour = at - 4
        else if (x + 1 < width && pixels[at + 7] === 255) neighbour = at + 4
        else if (y > 0 && pixels[at - width * 4 + 3] === 255) neighbour = at - width * 4
        else if (y + 1 < height && pixels[at + width * 4 + 3] === 255) neighbour = at + width * 4
        if (neighbour < 0) continue
        pixels.set(pixels.subarray(neighbour, neighbour + 3), at)
        pixels[at + 3] = 128
      }
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 128) pixels[i] = 255
  }
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
}

function trianglePainter(
  base: Ground,
  corners: number[],
  pixels: Uint8Array,
  sample: Sample,
  phase: number,
) {
  const [first = 0, second = 0, third = 0] = corners
  return (x: number, z: number, a: number, b: number, offset: number) => {
    const c = 1 - a - b
    const coverage = base.cover
      ? (base.cover[first] ?? 0) * a + (base.cover[second] ?? 0) * b + (base.cover[third] ?? 0) * c
      : 1
    const grain =
      sample(x * 1.28 + phase, z * 1.28 + phase) * 1.75 +
      sample(z * 0.72 - phase, -x * 0.72 - phase) * 0.55 +
      0.04
    const shade = 1 + (grain - 1) * coverage
    for (let channel = 0; channel < 3; channel++) {
      const tint =
        (base.colors[first * 3 + channel] ?? 0) * a +
        (base.colors[second * 3 + channel] ?? 0) * b +
        (base.colors[third * 3 + channel] ?? 0) * c
      pixels[offset + channel] = srgbByte(tint * shade)
    }
    pixels[offset + 3] = 255
  }
}

function rasterTriangle(
  base: Ground,
  triangle: number,
  frame: Frame,
  pixels: Uint8Array,
  sample: Sample,
  phase: number,
) {
  const corners = cornersOf(base, triangle)
  const xs = corners.map((i) => base.positions[i * 3] ?? 0),
    zs = corners.map((i) => base.positions[i * 3 + 2] ?? 0)
  const [ax = 0, bx = 0, cx = 0] = xs,
    [az = 0, bz = 0, cz = 0] = zs
  const { width, height, minX, minZ, scaleX, scaleZ } = frame
  const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  const left = Math.max(0, Math.floor((Math.min(...xs) - minX) * scaleX + PAD)),
    right = Math.min(width - 1, Math.ceil((Math.max(...xs) - minX) * scaleX + PAD)),
    bottom = Math.max(0, Math.floor((Math.min(...zs) - minZ) * scaleZ + PAD)),
    top = Math.min(height - 1, Math.ceil((Math.max(...zs) - minZ) * scaleZ + PAD))
  const paint = trianglePainter(base, corners, pixels, sample, phase)
  for (let y = bottom; y <= top; y++)
    for (let x = left; x <= right; x++) {
      const px = minX + (x + 0.5 - PAD) / scaleX,
        pz = minZ + (y + 0.5 - PAD) / scaleZ
      const a = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / determinant,
        b = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / determinant
      if (Math.min(a, b, 1 - a - b) < -1e-6) continue
      paint(px, pz, a, b, (y * width + x) * 4)
    }
}

function pageGeometry(base: Ground, page: Page, frame: Frame) {
  const count = page.triangles.length * 3
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    indices = new Uint32Array(count)
  for (const [face, triangle] of page.triangles.entries()) {
    for (const [corner, source] of cornersOf(base, triangle).entries()) {
      const target = face * 3 + corner
      positions.set(base.positions.subarray(source * 3, source * 3 + 3), target * 3)
      normals.set(base.normals.subarray(source * 3, source * 3 + 3), target * 3)
      uv[target * 2] =
        (((base.positions[source * 3] ?? 0) - frame.minX) * frame.scaleX + PAD) / frame.width
      uv[target * 2 + 1] =
        (((base.positions[source * 3 + 2] ?? 0) - frame.minZ) * frame.scaleZ + PAD) / frame.height
      indices[target] = target
    }
  }
  return { positions, normals, uv, indices }
}

/** Rasterize the shader's local-XZ grain × interpolated ground tint/brush cover. */
export function addLawnBakeGround(group: Group, node: LawnNode, base: Ground) {
  const lease = new MeshStandardMaterial()
  try {
    const sample = pictureSampler(swardTexture(lease), 1)
    const phase = (node.seed % 113) / 113
    for (const [pageIndex, page] of collectPages(base).entries()) {
      const frame = pageFrame(page)
      const pixels = new Uint8Array(frame.width * frame.height * 4)
      for (const triangle of page.triangles)
        rasterTriangle(base, triangle, frame, pixels, sample, phase)
      padEdges(pixels, frame.width, frame.height)
      const material = lawnBakeMaterial(
        'lawn-ground-grain-and-colours',
        pixels,
        frame.width,
        frame.height,
        0.98,
      )
      addLawnBakeMesh(
        group,
        pageGeometry(base, page, frame),
        material,
        pageIndex ? `lawn-ground-${pageIndex}` : 'lawn-ground',
      )
    }
  } finally {
    lease.dispose()
  }
}
