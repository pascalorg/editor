import { describe, expect, test } from 'bun:test'
import type { BufferAttribute, Mesh } from 'three'
import { CabinetModuleNode } from '../schema'
import { buildCabinetGeometry } from '../geometry'

function findMeshByNamePattern(root: { children: unknown[] }, pattern: RegExp): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name && pattern.test(item.name)) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found matching: ${pattern}`)
}

function findMeshByNamePrefix(root: { children: unknown[] }, prefix: string): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name?.startsWith(prefix)) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found with prefix: ${prefix}`)
}

function frontProfileStats(
  mesh: Mesh,
  recessTolerance = 0.001,
) {
  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  let frameMaxZ = -Infinity
  for (let i = 0; i < position.count; i += 1) frameMaxZ = Math.max(frameMaxZ, position.getZ(i))

  let panelMaxZ = -Infinity
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i)
    if (z < frameMaxZ - recessTolerance) panelMaxZ = Math.max(panelMaxZ, z)
  }
  return { frameMaxZ, panelMaxZ }
}

function archOutlineStats(mesh: Mesh, sideThreshold: number, centerThreshold: number) {
  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  let centerMaxY = -Infinity
  let sideMaxY = -Infinity

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    if (Math.abs(x) <= centerThreshold) centerMaxY = Math.max(centerMaxY, y)
    if (Math.abs(x) >= sideThreshold) sideMaxY = Math.max(sideMaxY, y)
  }

  return { centerMaxY, sideMaxY }
}

function archShoulderStats(mesh: Mesh) {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (!box) throw new Error('Expected geometry bounding box')

  const halfWidth = (box.max.x - box.min.x) / 2
  const centerThreshold = halfWidth * 0.18
  const shoulderMin = halfWidth * 0.45
  const shoulderMax = halfWidth * 0.72
  const sideThreshold = halfWidth * 0.9

  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  let centerMaxY = -Infinity
  let shoulderMaxY = -Infinity
  let sideMaxY = -Infinity

  for (let i = 0; i < position.count; i += 1) {
    const x = Math.abs(position.getX(i))
    const y = position.getY(i)
    if (x <= centerThreshold) centerMaxY = Math.max(centerMaxY, y)
    if (x >= shoulderMin && x <= shoulderMax) shoulderMaxY = Math.max(shoulderMaxY, y)
    if (x >= sideThreshold) sideMaxY = Math.max(sideMaxY, y)
  }

  return { centerMaxY, shoulderMaxY, sideMaxY }
}

function archCrownRise(mesh: Mesh) {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (!box) throw new Error('Expected geometry bounding box')

  const halfWidth = (box.max.x - box.min.x) / 2
  const centerThreshold = halfWidth * 0.18
  const sideThreshold = halfWidth * 0.88
  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  let centerMaxY = -Infinity
  let sideMaxY = -Infinity

  for (let i = 0; i < position.count; i += 1) {
    const x = Math.abs(position.getX(i))
    const y = position.getY(i)
    if (x <= centerThreshold) centerMaxY = Math.max(centerMaxY, y)
    if (x >= sideThreshold) sideMaxY = Math.max(sideMaxY, y)
  }

  return centerMaxY - sideMaxY
}

describe('cabinet raised-arch front style', () => {
  test('door fronts get an arched recessed panel instead of a rectangular shaker recess', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'door', type: 'door', doorType: 'double', shelfCount: 2 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const leftDoor = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+$/)
    const { frameMaxZ, panelMaxZ } = frontProfileStats(leftDoor)

    expect(frameMaxZ).toBeGreaterThan(panelMaxZ + 0.002)
  })

  test('drawer fronts carry the same raised-arch profile at smaller proportions', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'drawer', type: 'drawer', drawerCount: 3 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const drawerFront = findMeshByNamePrefix(group, 'cabinet-drawer-front-')
    const { frameMaxZ, panelMaxZ } = frontProfileStats(drawerFront)

    expect(frameMaxZ).toBeGreaterThan(panelMaxZ + 0.002)
  })

  test('glass doors use an arched glass opening instead of a rectangular pane', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'glass-door', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const glassPane = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-glass$/)
    const paneStats = archOutlineStats(glassPane, 0.08, 0.035)

    expect(paneStats.centerMaxY).toBeGreaterThan(paneStats.sideMaxY + 0.004)
  })

  test('glass door arches keep broad shoulders instead of pinching into spikes', () => {
    const node = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      stack: [{ id: 'glass-door', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const glassPane = findMeshByNamePattern(group, /^cabinet-door-left-[\d.]+-glass$/)
    const paneStats = archShoulderStats(glassPane)

    expect(paneStats.shoulderMaxY).toBeGreaterThan(paneStats.sideMaxY + 0.008)
    expect(paneStats.centerMaxY).toBeGreaterThan(paneStats.shoulderMaxY + 0.002)
  })

  test('glass arches keep a consistent crown for the same width across short and tall doors', () => {
    const tallNode = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      carcassHeight: 0.9,
      stack: [{ id: 'glass-door-tall', type: 'door', doorType: 'glass', shelfCount: 4 }],
    })
    const shortNode = CabinetModuleNode.parse({
      frontStyle: 'raised-arch',
      width: 0.6,
      carcassHeight: 0.45,
      stack: [{ id: 'glass-door-short', type: 'door', doorType: 'glass', shelfCount: 2 }],
    })

    const tallGroup = buildCabinetGeometry(tallNode, undefined, 'rendered', false)
    const shortGroup = buildCabinetGeometry(shortNode, undefined, 'rendered', false)
    const tallGlass = findMeshByNamePattern(tallGroup, /^cabinet-door-left-[\d.]+-glass$/)
    const shortGlass = findMeshByNamePattern(shortGroup, /^cabinet-door-left-[\d.]+-glass$/)

    expect(archCrownRise(tallGlass)).toBeCloseTo(archCrownRise(shortGlass), 2)
  })
})
