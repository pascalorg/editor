import { strToU8, type Zippable, zipSync } from 'fflate'
import type * as THREE from 'three'
import type {
  PrintExportBounds,
  PrintExportOptions,
  PrintExportReport,
  PrintMeshData,
} from './print-export'
import { extractPreparedPrintMesh, prepareSceneForPrint } from './print-export'

const ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0)
const PART_GAP_MM = 5

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

const ROOT_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

export type Print3mfPart = {
  name: string
  mesh: PrintMeshData
  bounds: PrintExportBounds
}

export type Print3mfExport = {
  buffer: Uint8Array<ArrayBuffer>
  report: PrintExportReport
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('3MF coordinates must be finite.')
  const rounded = Math.abs(value) < 5e-10 ? 0 : value
  return rounded.toFixed(9).replace(/\.?0+$/, '')
}

type PlacedPrint3mfPart = {
  part: Print3mfPart
  translateX: number
  translateY: number
  vertexStart: number
  triangleStart: number
}

function appendMeshObject(lines: string[], name: string, parts: PlacedPrint3mfPart[]) {
  lines.push(`    <object id="1" type="model" name="${escapeXml(name)}">`)
  lines.push('      <mesh>')
  lines.push('        <vertices>')
  for (const { part, translateX, translateY } of parts) {
    for (let offset = 0; offset < part.mesh.positions.length; offset += 3) {
      lines.push(
        `          <vertex x="${decimal(part.mesh.positions[offset]! + translateX)}" y="${decimal(part.mesh.positions[offset + 1]! + translateY)}" z="${decimal(part.mesh.positions[offset + 2]!)}"/>`,
      )
    }
  }
  lines.push('        </vertices>')
  lines.push('        <triangles>')
  for (const { part, vertexStart } of parts) {
    for (let offset = 0; offset < part.mesh.indices.length; offset += 3) {
      lines.push(
        `          <triangle v1="${part.mesh.indices[offset]! + vertexStart}" v2="${part.mesh.indices[offset + 1]! + vertexStart}" v3="${part.mesh.indices[offset + 2]! + vertexStart}"/>`,
      )
    }
  }
  lines.push('        </triangles>')
  lines.push('      </mesh>')
  lines.push('    </object>')
}

export function createPrint3mf(
  parts: Print3mfPart[],
  title = 'Pascal print export',
): Uint8Array<ArrayBuffer> {
  const placements: PlacedPrint3mfPart[] = []
  let cursorX = 0
  let vertexStart = 0
  let triangleStart = 0
  for (const part of parts) {
    placements.push({
      part,
      translateX: cursorX - part.bounds.min.x,
      translateY: -part.bounds.min.y,
      vertexStart,
      triangleStart,
    })
    cursorX += part.bounds.width + PART_GAP_MM
    vertexStart += part.mesh.positions.length / 3
    triangleStart += part.mesh.indices.length / 3
  }
  const partManifest = placements.map(({ part, vertexStart, triangleStart }) => ({
    name: part.name,
    vertexStart,
    vertexCount: part.mesh.positions.length / 3,
    triangleStart,
    triangleCount: part.mesh.indices.length / 3,
  }))
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `  <metadata name="Title">${escapeXml(title)}</metadata>`,
    '  <metadata name="Application">Pascal</metadata>',
    `  <metadata name="Pascal.PartManifest">${escapeXml(JSON.stringify(partManifest))}</metadata>`,
    '  <resources>',
  ]

  // CHITUBOX 1.3.0 recenters independent 3MF objects, so package the plate as one mesh.
  if (placements.length > 0) {
    appendMeshObject(lines, parts.length === 1 ? parts[0]!.name : title, placements)
  }
  lines.push('  </resources>')
  lines.push('  <build>')

  if (parts.length > 0) lines.push('    <item objectid="1"/>')
  lines.push('  </build>')
  lines.push('</model>')
  lines.push('')

  const files: Zippable = {
    '[Content_Types].xml': [strToU8(CONTENT_TYPES), { level: 0, mtime: ZIP_MTIME }],
    '_rels/.rels': [strToU8(ROOT_RELATIONSHIPS), { level: 0, mtime: ZIP_MTIME }],
    '3D/3dmodel.model': [strToU8(lines.join('\n')), { level: 0, mtime: ZIP_MTIME }],
  }
  return zipSync(files, { level: 0 })
}

export function exportSceneToPrint3mf(
  source: THREE.Object3D,
  options: PrintExportOptions,
): Print3mfExport {
  const prepared = prepareSceneForPrint(source, { ...options, format: '3mf' })
  const parts =
    prepared.report.bounds && prepared.report.invalidTriangleCount === 0
      ? [
          {
            name: 'Pascal print model',
            mesh: extractPreparedPrintMesh(prepared.scene),
            bounds: prepared.report.bounds,
          },
        ]
      : []
  return {
    buffer: createPrint3mf(parts),
    report: prepared.report,
  }
}
