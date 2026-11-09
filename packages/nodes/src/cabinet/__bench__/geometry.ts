import { Mesh } from 'three'
import { buildCabinetGeometry } from '../geometry'
import { CABINET_PRESETS } from '../presets'
import { CabinetModuleNode } from '../schema'

// Run with: bun packages/nodes/src/cabinet/__bench__/geometry.ts
// Counts include interiors and interaction meshes, even when hidden by closed doors.
const results = CABINET_PRESETS.map((preset) => {
  const root = buildCabinetGeometry(CabinetModuleNode.parse(preset.createPatch()))
  let triangles = 0
  let meshes = 0
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    meshes++
    triangles +=
      (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    object.geometry.dispose()
  })
  return { item: preset.id, triangles, meshes }
})
console.table(results)
