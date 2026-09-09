import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'

const fixture = new URL(
  '../../../apps/ifc-converter/public/test-ifc-files/04-ifc-open-house.ifc',
  import.meta.url,
)
const fillIds = [2441, 2511, 2594, 2667, 2740, 2813]
const originalSetWasmPath = WebIFC.IfcAPI.prototype.SetWasmPath
const originalGetLineIDsWithType = WebIFC.IfcAPI.prototype.GetLineIDsWithType
const originalGetLine = WebIFC.IfcAPI.prototype.GetLine

function assertUniqueFills(graph: PascalSceneGraph) {
  const fills = Object.values(graph.nodes).filter(
    (node) => node.type === 'door' || node.type === 'window',
  )
  expect(
    fills.map((node) => node.metadata?.expressID).sort((a, b) => Number(a) - Number(b)),
  ).toEqual(fillIds)
  for (const fill of fills) {
    const parent = fill.parentId ? graph.nodes[fill.parentId] : undefined
    expect(parent).toBeDefined()
    if (parent && 'children' in parent) {
      expect(parent.children.filter((id) => id === fill.id)).toHaveLength(1)
    }
  }
}

describe('IFC opening emission', () => {
  const spies: { mockRestore: () => void }[] = []

  beforeEach(() => {
    const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
    spies.push(
      spyOn(WebIFC.IfcAPI.prototype, 'SetWasmPath').mockImplementation(function (
        this: WebIFC.IfcAPI,
      ) {
        originalSetWasmPath.call(this, wasmPath, true)
      }),
    )
  })

  afterEach(() => {
    for (const spy of spies.splice(0).reverse()) spy.mockRestore()
  })

  it('emits each fixture fill once across relationship and fallback paths without cleanup', async () => {
    const graph = await convertIfcToPascal(await Bun.file(fixture).bytes(), undefined, {
      simplify: false,
    })
    assertUniqueFills(graph)
    const door = Object.values(graph.nodes).find((node) => node.metadata?.expressID === 2441)
    expect(door?.metadata?.hostWallExpressID).toBe(268)
  })

  for (const [kind, fillId] of [
    ['door', 2441],
    ['window', 2511],
  ] as const) {
    it(`emits one ${kind} when void, fill, and containment records repeat`, async () => {
      spies.push(
        spyOn(WebIFC.IfcAPI.prototype, 'GetLineIDsWithType').mockImplementation(function (
          this: WebIFC.IfcAPI,
          modelID,
          type,
          includeInherited,
        ) {
          const ids = originalGetLineIDsWithType.call(this, modelID, type, includeInherited)
          if (
            type !== WebIFC.IFCRELVOIDSELEMENT &&
            type !== WebIFC.IFCRELFILLSELEMENT &&
            type !== WebIFC.IFCRELAGGREGATES &&
            type !== WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE
          ) {
            return ids
          }
          const repeatedIds = Array.from({ length: ids.size() * 8 }, (_, i) =>
            ids.get(i % ids.size()),
          )
          return {
            size: () => repeatedIds.length,
            get: (i: number) => repeatedIds[i]!,
            [Symbol.iterator]: () => repeatedIds.values(),
          }
        }),
        spyOn(WebIFC.IfcAPI.prototype, 'GetLine').mockImplementation(function (
          this: WebIFC.IfcAPI,
          modelID,
          expressID,
          ...args
        ) {
          const line = originalGetLine.call(this, modelID, expressID, ...args)
          if (expressID !== 2451) return line
          return {
            ...line,
            RelatedBuildingElement: { ...line.RelatedBuildingElement, value: fillId },
          }
        }),
      )

      const graph = await convertIfcToPascal(await Bun.file(fixture).bytes(), undefined, {
        simplify: false,
      })
      assertUniqueFills(graph)
      const fill = Object.values(graph.nodes).find((node) => node.metadata?.expressID === fillId)
      expect(fill?.type).toBe(kind)
      expect(fill?.metadata?.hostWallExpressID).toBe(268)
    })
  }

  it('emits a shared fill only on the first converted host wall', async () => {
    spies.push(
      spyOn(WebIFC.IfcAPI.prototype, 'GetLine').mockImplementation(function (
        this: WebIFC.IfcAPI,
        modelID,
        expressID,
        ...args
      ) {
        const line = originalGetLine.call(this, modelID, expressID, ...args)
        if (expressID !== 120) return line
        return { ...line, RelatedOpeningElement: { ...line.RelatedOpeningElement, value: 2380 } }
      }),
    )

    const graph = await convertIfcToPascal(await Bun.file(fixture).bytes(), undefined, {
      simplify: false,
    })
    assertUniqueFills(graph)
    const door = Object.values(graph.nodes).find((node) => node.metadata?.expressID === 2441)
    expect(door?.metadata?.hostWallExpressID).toBe(40)
  })
})
