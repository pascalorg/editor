import { beforeAll, describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  getWallAssemblyPreset,
  resolveWallExteriorSide,
  type WallNode,
  wallAssemblyPatch,
} from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { buildIfcExport } from '../src/export'
import { roomWithOpenings, wallsOn } from './export-scenes'

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const api = new WebIFC.IfcAPI()

beforeAll(async () => {
  api.SetWasmPath(wasmPath, true)
  await api.Init()
})

type LayerOut = { material: string; thickness: number; category: string | null }

/** Each wall's IFC layer stack, in IFC order, by wall GlobalId. */
function wallLayers(ifc: string): Map<string, { setName: string; layers: LayerOut[] }> {
  const modelID = api.OpenModel(new TextEncoder().encode(ifc))
  try {
    const out = new Map<string, { setName: string; layers: LayerOut[] }>()
    const rels = api.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL)
    for (let i = 0; i < rels.size(); i++) {
      const rel = api.GetLine(modelID, rels.get(i), true)
      const usage = rel.RelatingMaterial
      if (usage?.type !== WebIFC.IFCMATERIALLAYERSETUSAGE) continue
      const set = usage.ForLayerSet
      const layers = set.MaterialLayers.map((l: any) => ({
        material: l.Material.Name.value,
        thickness: l.LayerThickness.value,
        category: l.Category?.value ?? null,
      }))
      for (const obj of rel.RelatedObjects) {
        out.set(obj.GlobalId.value, { setName: set.LayerSetName.value, layers })
      }
    }
    return out
  } finally {
    api.CloseModel(modelID)
  }
}

function exteriorStuccoScene(flipFirstWall: boolean) {
  const nodes: Record<string, AnyNode> = roomWithOpenings()
  const level = Object.values(nodes).find((n) => n.type === 'level')!
  const preset = getWallAssemblyPreset('exterior-2x6-stucco')!
  wallsOn(nodes, level.id).forEach((wall, index) => {
    let next = { ...wall } as WallNode
    if (flipFirstWall && index === 0) {
      next = {
        ...next,
        start: wall.end,
        end: wall.start,
        frontSide: wall.backSide,
        backSide: wall.frontSide,
      }
    }
    nodes[wall.id] = {
      ...next,
      ...wallAssemblyPatch({ ...preset.assembly, face: 'exterior' }),
    } as AnyNode
  })
  return nodes
}

describe('wall assemblies in IFC', () => {
  for (const flip of [false, true]) {
    test(`writes one IFC layer per assembly layer, exterior side outward${flip ? ' (one wall reversed)' : ''}`, () => {
      const nodes = exteriorStuccoScene(flip)
      const walls = Object.values(nodes).filter((n) => n.type === 'wall') as WallNode[]
      expect(walls.every((w) => resolveWallExteriorSide(w) !== null)).toBe(true)

      const { ifc } = buildIfcExport({ nodes, timestamp: new Date(Date.UTC(2026, 0, 1)) })
      const stacks = [...wallLayers(ifc).values()]
      expect(stacks).toHaveLength(walls.length)

      const preset = getWallAssemblyPreset('exterior-2x6-stucco')!
      const total = preset.assembly.layers.reduce((s, l) => s + l.thickness, 0)
      for (const { setName, layers } of stacks) {
        expect(setName).toBe(preset.label)
        expect(layers.map((l) => l.material).sort()).toEqual(
          preset.assembly.layers.map((l) => l.material ?? l.role).sort(),
        )
        expect(layers.reduce((s, l) => s + l.thickness, 0)).toBeCloseTo(total, 6)
        expect(layers.find((l) => l.material === 'wood')?.category).toBe('LoadBearing')
      }

      // IFC layer 1 sits on Pascal's front face (+n), so the stack starts at
      // the stucco when the front face is exterior and at the drywall when
      // the back face is. Reversing one wall puts walls on both sides.
      const sides = new Set(walls.map((w) => resolveWallExteriorSide(w)))
      if (flip) expect(sides.size).toBe(2)
      const firsts = stacks.map((s) => s.layers[0]!.material).sort()
      const expected = walls
        .map((w) => (resolveWallExteriorSide(w) === 1 ? 'stucco' : 'drywall'))
        .sort()
      expect(firsts).toEqual(expected)
    })
  }

  test('an undetermined exterior side starts the stack at the back face, as core does', () => {
    const nodes = exteriorStuccoScene(false)
    for (const node of Object.values(nodes)) {
      if (node.type === 'wall')
        nodes[node.id] = { ...node, frontSide: 'unknown', backSide: 'unknown' }
    }
    const walls = Object.values(nodes).filter((n) => n.type === 'wall') as WallNode[]
    expect(walls.every((w) => resolveWallExteriorSide(w) === null)).toBe(true)

    const { ifc } = buildIfcExport({ nodes, timestamp: new Date(Date.UTC(2026, 0, 1)) })
    for (const { layers } of wallLayers(ifc).values()) {
      expect(layers[0]!.material).toBe('drywall')
    }
  })

  test('air layers are ventilated as an IfcLogical', () => {
    const nodes: Record<string, AnyNode> = roomWithOpenings()
    const level = Object.values(nodes).find((n) => n.type === 'level')!
    const preset = getWallAssemblyPreset('exterior-2x6-brick')!
    for (const wall of wallsOn(nodes, level.id)) {
      nodes[wall.id] = { ...wall, ...wallAssemblyPatch(preset.assembly) } as AnyNode
    }
    const { ifc } = buildIfcExport({ nodes, timestamp: new Date(Date.UTC(2026, 0, 1)) })
    const airLayers = ifc.split('\n').filter((line) => /IFCMATERIALLAYER\(.*'air'/.test(line))
    expect(airLayers.length).toBeGreaterThan(0)
    for (const line of airLayers) expect(line).toContain('IFCLOGICAL(.T.)')
  })

  test('walls without an assembly keep the single core layer', () => {
    const { ifc } = buildIfcExport({
      nodes: roomWithOpenings(),
      timestamp: new Date(Date.UTC(2026, 0, 1)),
    })
    for (const { setName, layers } of wallLayers(ifc).values()) {
      expect(layers).toHaveLength(1)
      expect(layers[0]!.material).toBe('Wall')
      expect(setName).toMatch(/^Wall \d+ mm$/)
    }
  })
})
