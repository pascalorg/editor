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

function appendMeshObject(lines: string[], part: Print3mfPart, objectId: number) {
  lines.push(`    <object id="${objectId}" type="model" name="${escapeXml(part.name)}">`)
  lines.push('      <mesh>')
  lines.push('        <vertices>')
  for (let offset = 0; offset < part.mesh.positions.length; offset += 3) {
    lines.push(
      `          <vertex x="${decimal(part.mesh.positions[offset]!)}" y="${decimal(part.mesh.positions[offset + 1]!)}" z="${decimal(part.mesh.positions[offset + 2]!)}"/>`,
    )
  }
  lines.push('        </vertices>')
  lines.push('        <triangles>')
  for (let offset = 0; offset < part.mesh.indices.length; offset += 3) {
    lines.push(
      `          <triangle v1="${part.mesh.indices[offset]}" v2="${part.mesh.indices[offset + 1]}" v3="${part.mesh.indices[offset + 2]}"/>`,
    )
  }
  lines.push('        </triangles>')
  lines.push('      </mesh>')
  lines.push('    </object>')
}

export function createPrint3mf(
  parts: Print3mfPart[],
  title = 'Pascal print export',
): Uint8Array<ArrayBuffer> {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `  <metadata name="Title">${escapeXml(title)}</metadata>`,
    '  <metadata name="Application">Pascal</metadata>',
    '  <resources>',
  ]

  for (const [index, part] of parts.entries()) appendMeshObject(lines, part, index + 1)
  lines.push('  </resources>')
  lines.push('  <build>')

  let cursorX = 0
  for (const [index, part] of parts.entries()) {
    const translateX = cursorX - part.bounds.min.x
    const translateY = -part.bounds.min.y
    lines.push(
      `    <item objectid="${index + 1}" transform="1 0 0 0 1 0 0 0 1 ${decimal(translateX)} ${decimal(translateY)} 0"/>`,
    )
    cursorX += part.bounds.width + PART_GAP_MM
  }
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
