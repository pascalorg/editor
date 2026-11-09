import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertIfcToPascal } from '../src'

const fixture = fileURLToPath(
  new URL(
    '../../../apps/ifc-converter/public/test-ifc-files/04-ifc-open-house.ifc',
    import.meta.url,
  ),
)
const webIfcDirectory = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`

test('locateWasmFile picks the wasm URL, over wasmPath', async () => {
  const asked: string[] = []
  const scene = await convertIfcToPascal(await readFile(fixture), undefined, {
    simplify: false,
    wasmPath: '/nowhere/',
    locateWasmFile: (fileName) => {
      asked.push(fileName)
      return `${webIfcDirectory}${fileName}`
    },
  })
  // Under bun this is the node build's `web-ifc-node.wasm`; a browser asks for `web-ifc.wasm`.
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatch(/^web-ifc(-node|-mt)?\.wasm$/)
  expect(Object.keys(scene.nodes).length).toBeGreaterThan(0)
}, 60_000)
