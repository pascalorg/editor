#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const FALLBACK_THUMBNAIL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAGXRFWHRTb2Z0d2FyZQBwYXNjYWwtdGV4dC10by1jYWTFq8PrAAABQElEQVR4nO3aQQ6CQBBA0e5/6Z3GwBgYNKFw07bKqYbNwA6+qQAAAAAAAAAA+M/RuK/r9Jzm8bn9cHqapvF5+Xh6nKbp+VjGZQHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAQkQARHQAf8HK7QGqE5iNc4AAAAASUVORK5CYII=',
  'base64',
)

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sanitizeName(value) {
  return String(value || 'cad-bracket')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'cad-bracket'
}

function finiteNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function writeJson(filePath, value) {
  return fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function pad4(length) {
  return (4 - (length % 4)) % 4
}

function hexToRgba(value, fallback = [0.8, 0.1, 0.1, 1]) {
  const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i)
  if (!match) return fallback
  const raw = match[1]
  return [
    Number.parseInt(raw.slice(0, 2), 16) / 255,
    Number.parseInt(raw.slice(2, 4), 16) / 255,
    Number.parseInt(raw.slice(4, 6), 16) / 255,
    1,
  ]
}

function boxMesh(cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2
  const x1 = cx + sx / 2
  const y0 = cy - sy / 2
  const y1 = cy + sy / 2
  const z0 = cz - sz / 2
  const z1 = cz + sz / 2
  const positions = [
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0,
    x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0,
    x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1,
    x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0,
    x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
  ]
  const normals = [
    ...Array(4).fill([0, 0, 1]).flat(),
    ...Array(4).fill([0, 0, -1]).flat(),
    ...Array(4).fill([-1, 0, 0]).flat(),
    ...Array(4).fill([1, 0, 0]).flat(),
    ...Array(4).fill([0, 1, 0]).flat(),
    ...Array(4).fill([0, -1, 0]).flat(),
  ]
  const indices = []
  for (let face = 0; face < 6; face += 1) {
    const o = face * 4
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3)
  }
  return { positions, normals, indices }
}

function cylinderMesh(cx, cy, cz, radius, height, segments = 40) {
  const positions = []
  const normals = []
  const indices = []
  const y0 = cy - height / 2
  const y1 = cy + height / 2

  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments
    const x = cx + Math.cos(angle) * radius
    const z = cz + Math.sin(angle) * radius
    positions.push(x, y0, z, x, y1, z)
    const nx = Math.cos(angle)
    const nz = Math.sin(angle)
    normals.push(nx, 0, nz, nx, 0, nz)
  }
  const sideVertexCount = positions.length / 3
  const bottomCenter = sideVertexCount
  const topCenter = sideVertexCount + 1
  positions.push(cx, y0, cz, cx, y1, cz)
  normals.push(0, -1, 0, 0, 1, 0)

  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments
    const b0 = index * 2
    const t0 = b0 + 1
    const b1 = next * 2
    const t1 = b1 + 1
    indices.push(b0, b1, t1, b0, t1, t0)
    indices.push(bottomCenter, b0, b1)
    indices.push(topCenter, t1, t0)
  }
  return { positions, normals, indices }
}

function triangularPrismMesh(cx, cy, cz, length, height, width) {
  const x0 = cx - length / 2
  const x1 = cx + length / 2
  const y0 = cy - height / 2
  const y1 = cy + height / 2
  const z0 = cz - width / 2
  const z1 = cz + width / 2
  const positions = [
    x0, y0, z0, x1, y0, z0, x0, y1, z0,
    x0, y0, z1, x0, y1, z1, x1, y0, z1,
    x0, y0, z0, x0, y0, z1, x1, y0, z1, x1, y0, z0,
    x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1,
    x1, y0, z0, x1, y0, z1, x0, y1, z1, x0, y1, z0,
  ]
  const normals = [
    0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    0.7, 0.7, 0, 0.7, 0.7, 0, 0.7, 0.7, 0, 0.7, 0.7, 0,
  ]
  const indices = [
    0, 1, 2,
    3, 4, 5,
    6, 7, 8, 6, 8, 9,
    10, 11, 12, 10, 12, 13,
    14, 15, 16, 14, 16, 17,
  ]
  return { positions, normals, indices }
}

function appendMesh(target, mesh) {
  const offset = target.positions.length / 3
  target.positions.push(...mesh.positions)
  target.normals.push(...mesh.normals)
  target.indices.push(...mesh.indices.map((index) => index + offset))
}

function inferCadIntent(prompt, requestIntent) {
  const intent = requestIntent && typeof requestIntent === 'object' ? requestIntent : {}
  const dimensions = intent.dimensions && typeof intent.dimensions === 'object' ? intent.dimensions : {}
  const holes = intent.mountingHoles && typeof intent.mountingHoles === 'object' ? intent.mountingHoles : {}
  const promptText = String(prompt || '')
  const fourHolePrompt = /四个|4\s*个|four/i.test(promptText)
  const wantsBracket = /支架|bracket|mount/i.test(promptText)

  return {
    family: typeof intent.family === 'string' ? intent.family : wantsBracket ? 'motor_bracket' : 'generic_bracket',
    color: typeof intent.materialColor === 'string' ? intent.materialColor : '#cc2222',
    dimensions: {
      length: finiteNumber(dimensions.length, 1.4, 0.3, 4),
      width: finiteNumber(dimensions.width, 0.85, 0.2, 3),
      baseThickness: finiteNumber(dimensions.baseThickness, 0.12, 0.03, 0.5),
      wallHeight: finiteNumber(dimensions.wallHeight, 0.55, 0.1, 2),
      wallThickness: finiteNumber(dimensions.wallThickness, 0.12, 0.03, 0.5),
    },
    mountingHoles: {
      count: Math.round(finiteNumber(holes.count, fourHolePrompt ? 4 : 0, 0, 12)),
      diameter: finiteNumber(holes.diameter, 0.12, 0.02, 0.4),
      marginX: finiteNumber(holes.marginX, 0.24, 0.05, 1),
      marginZ: finiteNumber(holes.marginZ, 0.18, 0.05, 1),
    },
  }
}

function createBracketGlb(intent) {
  const { length, width, baseThickness, wallHeight, wallThickness } = intent.dimensions
  const holeDiameter = intent.mountingHoles.diameter
  const holeRadius = holeDiameter / 2
  const materialMesh = { positions: [], normals: [], indices: [] }
  const darkMesh = { positions: [], normals: [], indices: [] }

  appendMesh(materialMesh, boxMesh(0, baseThickness / 2, 0, length, baseThickness, width))
  appendMesh(materialMesh, boxMesh(-length / 2 + wallThickness / 2, baseThickness + wallHeight / 2, 0, wallThickness, wallHeight, width))
  appendMesh(materialMesh, boxMesh(0, baseThickness + 0.055, -width / 2 + wallThickness / 2, length * 0.78, 0.11, wallThickness))
  appendMesh(materialMesh, boxMesh(0, baseThickness + 0.055, width / 2 - wallThickness / 2, length * 0.78, 0.11, wallThickness))
  appendMesh(materialMesh, triangularPrismMesh(-0.08, baseThickness + wallHeight * 0.33, -width * 0.22, length * 0.46, wallHeight * 0.62, width * 0.1))
  appendMesh(materialMesh, triangularPrismMesh(-0.08, baseThickness + wallHeight * 0.33, width * 0.22, length * 0.46, wallHeight * 0.62, width * 0.1))

  const holeCount = intent.mountingHoles.count
  if (holeCount > 0) {
    const marginX = Math.min(intent.mountingHoles.marginX, length * 0.35)
    const marginZ = Math.min(intent.mountingHoles.marginZ, width * 0.35)
    const xPositions = holeCount === 1 ? [0] : [-length / 2 + marginX, length / 2 - marginX]
    const zPositions = holeCount > 2 ? [-width / 2 + marginZ, width / 2 - marginZ] : [0]
    const centers = []
    for (const x of xPositions) {
      for (const z of zPositions) centers.push([x, z])
    }
    for (const [x, z] of centers.slice(0, holeCount)) {
      appendMesh(darkMesh, cylinderMesh(x, baseThickness + 0.003, z, holeRadius, 0.008, 48))
      appendMesh(darkMesh, cylinderMesh(x, baseThickness / 2, z, holeRadius * 0.84, baseThickness + 0.01, 32))
    }
  }

  return createGlb(
    [
      { name: 'bracket body', mesh: materialMesh, material: 0 },
      { name: 'mounting holes', mesh: darkMesh, material: 1 },
    ].filter((part) => part.mesh.positions.length > 0),
    [
      {
        name: 'painted metal',
        pbrMetallicRoughness: {
          baseColorFactor: hexToRgba(intent.color),
          metallicFactor: 0.35,
          roughnessFactor: 0.42,
        },
      },
      {
        name: 'hole cut shadow',
        pbrMetallicRoughness: {
          baseColorFactor: [0.015, 0.015, 0.018, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.8,
        },
      },
    ],
  )
}

function createGlb(parts, materials) {
  const bufferViews = []
  const accessors = []
  const primitives = []
  const chunks = []
  let offset = 0

  for (const part of parts) {
    const { positions, normals, indices } = part.mesh
    const positionBytes = Buffer.alloc(positions.length * 4)
    positions.forEach((value, index) => positionBytes.writeFloatLE(value, index * 4))
    const normalBytes = Buffer.alloc(normals.length * 4)
    normals.forEach((value, index) => normalBytes.writeFloatLE(value, index * 4))
    const indexBytes = Buffer.alloc(indices.length * 2)
    indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2))

    const positionView = bufferViews.length
    chunks.push({ offset, bytes: positionBytes })
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: positionBytes.length, target: 34962 })
    offset += positionBytes.length + pad4(positionBytes.length)

    const normalView = bufferViews.length
    chunks.push({ offset, bytes: normalBytes })
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: normalBytes.length, target: 34962 })
    offset += normalBytes.length + pad4(normalBytes.length)

    const indexView = bufferViews.length
    chunks.push({ offset, bytes: indexBytes })
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.length, target: 34963 })
    offset += indexBytes.length + pad4(indexBytes.length)

    const xs = []
    const ys = []
    const zs = []
    for (let index = 0; index < positions.length; index += 3) {
      xs.push(positions[index])
      ys.push(positions[index + 1])
      zs.push(positions[index + 2])
    }
    const positionAccessor = accessors.length
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    })
    const normalAccessor = accessors.length
    accessors.push({ bufferView: normalView, componentType: 5126, count: normals.length / 3, type: 'VEC3' })
    const indexAccessor = accessors.length
    accessors.push({ bufferView: indexView, componentType: 5123, count: indices.length, type: 'SCALAR' })
    primitives.push({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material: part.material })
  }

  const binary = Buffer.alloc(offset)
  for (const chunk of chunks) chunk.bytes.copy(binary, chunk.offset)

  const json = {
    asset: { version: '2.0', generator: 'pascal cad-worker parametric' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Generated CAD model' }],
    meshes: [{ primitives }],
    materials,
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors,
  }

  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPadding = pad4(jsonBytes.length)
  const binPadding = pad4(binary.length)
  const totalLength = 12 + 8 + jsonBytes.length + jsonPadding + 8 + binary.length + binPadding
  const glb = Buffer.alloc(totalLength)
  let cursor = 0
  glb.writeUInt32LE(0x46546c67, cursor); cursor += 4
  glb.writeUInt32LE(2, cursor); cursor += 4
  glb.writeUInt32LE(totalLength, cursor); cursor += 4
  glb.writeUInt32LE(jsonBytes.length + jsonPadding, cursor); cursor += 4
  glb.writeUInt32LE(0x4e4f534a, cursor); cursor += 4
  jsonBytes.copy(glb, cursor); cursor += jsonBytes.length
  glb.fill(0x20, cursor, cursor + jsonPadding); cursor += jsonPadding
  glb.writeUInt32LE(binary.length + binPadding, cursor); cursor += 4
  glb.writeUInt32LE(0x004e4942, cursor); cursor += 4
  binary.copy(glb, cursor); cursor += binary.length
  glb.fill(0, cursor, cursor + binPadding)
  return glb
}

async function main() {
  if (process.argv[2] !== 'generate') {
    console.error('Usage: cad-worker generate --input request.json --output output-dir')
    process.exit(2)
  }
  const inputPath = argValue('--input')
  const outputDir = argValue('--output')
  if (!inputPath || !outputDir) {
    console.error('Missing --input or --output')
    process.exit(2)
  }

  await fs.mkdir(outputDir, { recursive: true })
  const request = JSON.parse((await fs.readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''))
  const prompt = String(request.prompt || 'CAD bracket')
  const name = sanitizeName(request.name || prompt)
  const createdAt = new Date().toISOString()
  const intent = inferCadIntent(prompt, request.cadIntent)

  await fs.writeFile(path.join(outputDir, 'model.glb'), createBracketGlb(intent))
  await fs.writeFile(path.join(outputDir, 'thumbnail.png'), FALLBACK_THUMBNAIL_PNG)
  await fs.writeFile(
    path.join(outputDir, 'source.py'),
    [
      '# Generated parametric CAD source sketch for Pascal text-to-CAD.',
      '# This mirrors the generated GLB dimensions; phase 2 can execute it with CadQuery/build123d.',
      `prompt = ${JSON.stringify(prompt)}`,
      `cad_intent = ${JSON.stringify(intent, null, 2)}`,
      '',
      '# Model: L-shaped motor bracket with base plate, upright wall, side rails, triangular ribs,',
      '# and visible mounting holes from the prompt-derived mountingHoles pattern.',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(
    path.join(outputDir, 'model.step'),
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('Pascal text-to-CAD parametric preview'),'2;1');",
      `FILE_NAME('${name}.step','${createdAt}',('pascal'),('pascal'),'cad-worker','pascal','');`,
      'ENDSEC;',
      'DATA;',
      `/* Parametric preview intent: ${JSON.stringify(intent).replace(/\*\//g, '')} */`,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(
    path.join(outputDir, 'run.log'),
    [
      `[${createdAt}] cad-worker generated parametric bracket preview.`,
      `prompt: ${prompt}`,
      `intent: ${JSON.stringify(intent)}`,
      'outputs: model.glb, model.step, source.py, thumbnail.png',
    ].join('\n'),
    'utf8',
  )

  await writeJson(path.join(outputDir, 'result.json'), {
    status: 'generated',
    name,
    sourcePath: 'source.py',
    stepPath: 'model.step',
    glbPath: 'model.glb',
    thumbnailPath: 'thumbnail.png',
    logPath: 'run.log',
    warnings: request.cadIntent?.plannerSource === 'llm'
      ? []
      : ['CAD worker used deterministic prompt parsing because no LLM CAD planner result was available.'],
  })
}

main().catch(async (error) => {
  const outputDir = argValue('--output')
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {})
    await writeJson(path.join(outputDir, 'result.json'), {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      warnings: [],
    }).catch(() => {})
  }
  console.error(error)
  process.exit(1)
})
