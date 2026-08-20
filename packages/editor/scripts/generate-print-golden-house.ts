import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareSceneForExport } from '../src/lib/glb-export'
import { exportSceneLevelsForPrint } from '../src/lib/level-print-export'
import { filterPreparedSceneForPrintContent } from '../src/lib/print-content-scope'
import { createPrintGoldenHouseFixture } from '../src/lib/print-golden-house.test-fixture'
import { compileManifoldMeshData } from '../src/lib/print-shell-compiler-manifold-core'
import { compileSemanticPrintShellWithManifold } from '../src/lib/print-shell-compiler-manifold-worker'

const outputArgument = process.argv[2]
if (!outputArgument) {
  throw new Error(
    'Usage: bun packages/editor/scripts/generate-print-golden-house.ts <output-directory>',
  )
}

const outputDirectory = resolve(outputArgument)
const fixture = createPrintGoldenHouseFixture()

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

try {
  const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })
  const structure = filterPreparedSceneForPrintContent(prepared.scene, fixture.nodes, 'structure')
  const compileShell = (source: Parameters<typeof exportSceneLevelsForPrint>[0]) =>
    compileSemanticPrintShellWithManifold(source, fixture.nodes, {
      runner: compileManifoldMeshData,
    })
  const common = {
    scale: 100,
    plinth: { marginMm: 2, thicknessMm: 3 },
    compileShells: true,
    compileShell,
  }
  const threeMf = await exportSceneLevelsForPrint(structure, fixture.nodes, {
    ...common,
    format: '3mf',
  })
  const stl = await exportSceneLevelsForPrint(structure, fixture.nodes, {
    ...common,
    format: 'stl',
  })
  if (threeMf.report.status === 'blocked' || stl.report.status === 'blocked') {
    throw new Error('The golden house failed print preflight and was not written.')
  }

  await mkdir(outputDirectory, { recursive: true })
  const files = [
    { name: 'pascal-golden-house-levels.3mf', data: threeMf.data },
    { name: 'pascal-golden-house-levels-stl.zip', data: stl.data },
  ]
  for (const file of files) await writeFile(resolve(outputDirectory, file.name), file.data)

  const manifest = {
    kind: 'pascal-print-golden-house',
    version: 1,
    scale: 100,
    units: 'millimeter',
    files: await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: file.data.byteLength,
        sha256: await sha256(file.data),
      })),
    ),
    parts: threeMf.report.parts.map((part) => ({
      kind: part.kind,
      label: part.label,
      sourceBaseMeters: part.sourceBaseMeters,
      bounds: part.report.bounds,
      triangles: part.report.triangleCount,
      volumeMm3: part.report.volumeMm3,
      minimumFeatureThicknessMm: part.report.minimumFeatureThicknessMm,
    })),
  }
  await writeFile(
    resolve(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify({ outputDirectory, ...manifest }, null, 2)}\n`)
} finally {
  fixture.dispose()
}
