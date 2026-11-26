import { FileLoader, Loader } from 'three'

export type PointCloudData = {
  colors: Float32Array | null
  positions: Float32Array
}

const SCALAR_BYTES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
}

type Property = { name: string; offset: number; type: string }

/**
 * A PLY's vertex positions and colours, as the capture point layers draw them: colours are the
 * file's bytes over 255, like the live stream, with no sRGB-to-linear step (three's PLYLoader
 * makes one, which drew a saved cloud darker than the same points live).
 */
export function parsePointCloudPly(buffer: ArrayBuffer): PointCloudData {
  const bytes = new Uint8Array(buffer)
  const headerEnd = findHeaderEnd(bytes)
  const lines = new TextDecoder()
    .decode(bytes.subarray(0, headerEnd))
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))

  let format = ''
  let vertexCount = 0
  let inVertex = false
  let beforeVertex = 0
  const properties: Property[] = []
  let stride = 0
  for (const [keyword, ...rest] of lines) {
    if (keyword === 'format') format = rest[0] ?? ''
    if (keyword === 'element') {
      inVertex = rest[0] === 'vertex'
      if (inVertex) vertexCount = Number(rest[1])
      else if (vertexCount === 0) beforeVertex += Number(rest[1])
    }
    if (keyword === 'property' && inVertex) {
      if (rest[0] === 'list') throw new Error('A PLY vertex list property is not supported.')
      const type = rest[0] ?? ''
      const size = SCALAR_BYTES[type]
      if (!size) throw new Error(`Unknown PLY property type: ${type}.`)
      properties.push({ name: rest[1] ?? '', offset: stride, type })
      stride += size
    }
  }
  if (!(Number.isInteger(vertexCount) && vertexCount >= 0)) {
    throw new Error('The PLY has no readable vertex count.')
  }
  if (beforeVertex > 0) throw new Error('The PLY stores other elements before its vertices.')
  const field = (name: string) => properties.findIndex((property) => property.name === name)
  const xyz = [field('x'), field('y'), field('z')]
  if (xyz.some((index) => index < 0)) throw new Error('The PLY vertices have no x, y and z.')
  const rgb = [field('red'), field('green'), field('blue')]
  const hasColors = rgb.every((index) => index >= 0)

  const positions = new Float32Array(vertexCount * 3)
  const colors = hasColors ? new Float32Array(vertexCount * 3) : null
  const colorScale = (index: number) =>
    properties[index]?.type.startsWith('float') || properties[index]?.type === 'double' ? 1 : 255

  if (format === 'ascii') {
    const rows = new TextDecoder().decode(bytes.subarray(headerEnd)).trim().split(/\r?\n/)
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const values = (rows[vertex] ?? '').trim().split(/\s+/).map(Number)
      for (let axis = 0; axis < 3; axis += 1) {
        positions[vertex * 3 + axis] = values[xyz[axis] as number] ?? Number.NaN
        if (colors) {
          const index = rgb[axis] as number
          colors[vertex * 3 + axis] = (values[index] ?? 0) / colorScale(index)
        }
      }
    }
    return { colors, positions }
  }

  const littleEndian = format === 'binary_little_endian'
  if (!(littleEndian || format === 'binary_big_endian')) {
    throw new Error(`Unknown PLY format: ${format}.`)
  }
  if (headerEnd + vertexCount * stride > bytes.byteLength) {
    throw new Error('The PLY ends before its last vertex.')
  }
  const view = new DataView(buffer, headerEnd)
  const read = (base: number, property: Property) =>
    readScalar(view, base + property.offset, property.type, littleEndian)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * stride
    for (let axis = 0; axis < 3; axis += 1) {
      positions[vertex * 3 + axis] = read(base, properties[xyz[axis] as number] as Property)
      if (colors) {
        const index = rgb[axis] as number
        colors[vertex * 3 + axis] = read(base, properties[index] as Property) / colorScale(index)
      }
    }
  }
  return { colors, positions }
}

/** The first `maxPoints` points: a capture cloud is stored shuffled, so any prefix spreads evenly. */
export function firstPoints(data: PointCloudData, maxPoints: number): PointCloudData {
  const keep = Math.max(0, Math.min(data.positions.length / 3, Math.floor(maxPoints)))
  if (keep * 3 === data.positions.length) return data
  return {
    colors: data.colors?.subarray(0, keep * 3) ?? null,
    positions: data.positions.subarray(0, keep * 3),
  }
}

/** For `useLoader`: fetches a PLY and parses it with `parsePointCloudPly`. */
export class PointCloudPlyLoader extends Loader<PointCloudData> {
  override load(
    url: string,
    onLoad: (data: PointCloudData) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const files = new FileLoader(this.manager)
    files.setPath(this.path)
    files.setResponseType('arraybuffer')
    files.setRequestHeader(this.requestHeader)
    files.setWithCredentials(this.withCredentials)
    files.load(
      url,
      (response) => {
        try {
          onLoad(parsePointCloudPly(response as ArrayBuffer))
        } catch (error) {
          onError?.(error)
          this.manager.itemError(url)
        }
      },
      onProgress,
      onError,
    )
  }
}

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode('end_header')
  const limit = Math.min(bytes.byteLength, 64 * 1024)
  for (let index = 0; index + marker.length <= limit; index += 1) {
    let match = true
    for (let offset = 0; offset < marker.length; offset += 1) {
      if (bytes[index + offset] !== marker[offset]) {
        match = false
        break
      }
    }
    if (!match) continue
    let end = index + marker.length
    if (bytes[end] === 0x0d) end += 1
    if (bytes[end] === 0x0a) end += 1
    return end
  }
  throw new Error('The file is not a PLY: it has no end_header.')
}

function readScalar(view: DataView, at: number, type: string, littleEndian: boolean): number {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(at)
    case 'uchar':
    case 'uint8':
      return view.getUint8(at)
    case 'short':
    case 'int16':
      return view.getInt16(at, littleEndian)
    case 'ushort':
    case 'uint16':
      return view.getUint16(at, littleEndian)
    case 'int':
    case 'int32':
      return view.getInt32(at, littleEndian)
    case 'uint':
    case 'uint32':
      return view.getUint32(at, littleEndian)
    case 'float':
    case 'float32':
      return view.getFloat32(at, littleEndian)
    default:
      return view.getFloat64(at, littleEndian)
  }
}
