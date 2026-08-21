import { z } from 'zod'

const MetadataSchema = z.record(z.string(), z.unknown())

export const CaptureSessionLocatorSchema = z.object({
  sessionId: z.string().min(1),
  manifestUrl: z.string().min(1).optional(),
  schemaVersion: z.number().int().positive().optional(),
  revisionId: z.string().min(1).optional(),
})

export const DeviceMotionSampleSchema = z.object({
  segment: z.number().int().nonnegative(),
  timestamp: z.number().nonnegative(),
  transform: z.array(z.number()).length(16),
})

export const DeviceMotionTrajectorySchema = z.object({
  coordinateSystem: z.string().min(1),
  samples: z.array(DeviceMotionSampleSchema).min(2),
})

export const ArkitDeviceMotionTrajectorySchema = DeviceMotionTrajectorySchema.extend({
  coordinateSystem: z.literal('arkit-world'),
})

export const PointCloudPayloadSchema = z
  .object({
    coordinateSystem: z.string().min(1),
    positions: z.array(z.number().finite()).min(3),
    colors: z.array(z.number().finite()).optional(),
  })
  .superRefine((payload, context) => {
    if (payload.positions.length % 3 !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Point-cloud positions must contain XYZ triples.',
        path: ['positions'],
      })
    }
    if (payload.colors && payload.colors.length !== payload.positions.length) {
      context.addIssue({
        code: 'custom',
        message: 'Point-cloud colors must match the positions array length.',
        path: ['colors'],
      })
    }
  })

export const ArkitPointCloudPayloadSchema = PointCloudPayloadSchema.safeExtend({
  coordinateSystem: z.literal('arkit-world'),
})

const MAX_SURFACE_MESH_VERTICES = 65_535
const MAX_SURFACE_MESH_FACES = 6_000

export const SurfaceMeshPayloadSchema = z
  .object({
    version: z.literal(1),
    coordinateSystem: z.string().min(1),
    representation: z.literal('quantized-indexed-triangle-mesh'),
    appearance: z.literal('camera-vertex-color'),
    vertexCount: z.number().int().positive().max(MAX_SURFACE_MESH_VERTICES),
    faceCount: z.number().int().positive().max(MAX_SURFACE_MESH_FACES),
    boundsMin: z.array(z.number().finite()).length(3),
    boundsMax: z.array(z.number().finite()).length(3),
    positionEncoding: z.literal('uint16x3-base64-little-endian'),
    colorEncoding: z.literal('uint8x3-base64-srgb'),
    indexEncoding: z.literal('uint16x3-base64-little-endian'),
    positions: z.string().min(1).max(524_280),
    colors: z.string().min(1).max(262_140),
    indices: z.string().min(1).max(48_000),
  })
  .superRefine((payload, context) => {
    if (payload.vertexCount > payload.faceCount * 3) {
      context.addIssue({
        code: 'custom',
        message: 'Surface meshes cannot contain more than three vertices per face.',
        path: ['vertexCount'],
      })
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if ((payload.boundsMax[axis] ?? 0) < (payload.boundsMin[axis] ?? 0)) {
        context.addIssue({
          code: 'custom',
          message: 'Surface-mesh maximum bounds must not be below minimum bounds.',
          path: ['boundsMax', axis],
        })
      }
    }

    const positionBytes = decodeBase64(payload.positions)
    const colorBytes = decodeBase64(payload.colors)
    const indexBytes = decodeBase64(payload.indices)
    validateSurfaceMeshByteLength(positionBytes, payload.vertexCount * 3 * 2, 'positions', context)
    validateSurfaceMeshByteLength(colorBytes, payload.vertexCount * 3, 'colors', context)
    validateSurfaceMeshByteLength(indexBytes, payload.faceCount * 3 * 2, 'indices', context)

    if (indexBytes?.byteLength === payload.faceCount * 3 * 2) {
      const indices = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength)
      for (let offset = 0; offset < indexBytes.byteLength; offset += 2) {
        if (indices.getUint16(offset, true) >= payload.vertexCount) {
          context.addIssue({
            code: 'custom',
            message: 'Surface-mesh indices must reference an existing vertex.',
            path: ['indices'],
          })
          break
        }
      }
    }
  })

export const ArkitSurfaceMeshPayloadSchema = SurfaceMeshPayloadSchema.safeExtend({
  coordinateSystem: z.literal('arkit-world'),
})

export const CaptureTimeRangeSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
  })
  .refine((range) => range.end >= range.start, {
    message: 'Capture time ranges must end at or after they start.',
    path: ['end'],
  })

export const CaptureArtifactReferenceSchema = z.object({
  id: z.string().min(1),
  uri: z.string().min(1).optional(),
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  timeRange: CaptureTimeRangeSchema.optional(),
  metadata: MetadataSchema.optional(),
})

export const CaptureStreamDescriptorSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  role: z.string().min(1).optional(),
  availability: z.enum(['pending', 'live', 'ready', 'failed']).default('ready'),
  frameId: z.string().min(1).optional(),
  clockId: z.string().min(1).optional(),
  artifact: CaptureArtifactReferenceSchema.optional(),
  inline: z.unknown().optional(),
  metadata: MetadataSchema.optional(),
})

export const CaptureClockSchema = z.object({
  id: z.string().min(1),
  timebase: z.enum(['seconds', 'milliseconds', 'microseconds', 'nanoseconds']),
  epoch: z.string().min(1).optional(),
})

export const CaptureCoordinateFrameSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  convention: z.string().min(1),
  transform: z.array(z.number()).length(16).optional(),
})

export const CaptureSessionManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  streams: z.object({
    roomModel: z
      .object({
        kind: z.literal('room-model'),
        mediaType: z.literal('model/vnd.usdz+zip'),
        url: z.string().min(1),
      })
      .optional(),
    deviceMotion: z
      .object({
        kind: z.literal('device-motion'),
        trajectory: ArkitDeviceMotionTrajectorySchema,
      })
      .optional(),
    pointCloud: z
      .object({
        kind: z.literal('point-cloud'),
        points: ArkitPointCloudPayloadSchema,
      })
      .optional(),
    surfaceMesh: z
      .object({
        kind: z.literal('surface-mesh'),
        mesh: ArkitSurfaceMeshPayloadSchema,
      })
      .optional(),
  }),
})

export const CaptureSessionManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    sessionId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
    state: z.enum(['live', 'finalizing', 'ready', 'failed']).default('ready'),
    clocks: z.array(CaptureClockSchema).default([]),
    coordinateFrames: z.array(CaptureCoordinateFrameSchema).default([]),
    streams: z.array(CaptureStreamDescriptorSchema),
    metadata: MetadataSchema.optional(),
  })
  .superRefine(validateUniqueSessionIds)

export const CaptureSessionManifestSchema = z.union([
  CaptureSessionManifestV1Schema,
  CaptureSessionManifestV2Schema,
])

export const CaptureSessionDescriptorSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    sessionId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
    state: z.enum(['live', 'finalizing', 'ready', 'failed']),
    clocks: z.array(CaptureClockSchema),
    coordinateFrames: z.array(CaptureCoordinateFrameSchema),
    streams: z.array(CaptureStreamDescriptorSchema),
    metadata: MetadataSchema.optional(),
  })
  .superRefine(validateUniqueSessionIds)

export type CaptureArtifactReference = z.infer<typeof CaptureArtifactReferenceSchema>
export type CaptureClock = z.infer<typeof CaptureClockSchema>
export type CaptureCoordinateFrame = z.infer<typeof CaptureCoordinateFrameSchema>
export type CaptureSessionDescriptor = z.infer<typeof CaptureSessionDescriptorSchema>
export type CaptureSessionLocator = z.infer<typeof CaptureSessionLocatorSchema>
export type CaptureSessionManifest = z.infer<typeof CaptureSessionManifestSchema>
export type CaptureSessionManifestV1 = z.infer<typeof CaptureSessionManifestV1Schema>
export type CaptureSessionManifestV2 = z.infer<typeof CaptureSessionManifestV2Schema>
export type CaptureStreamDescriptor = z.infer<typeof CaptureStreamDescriptorSchema>
export type DeviceMotionTrajectoryPayload = z.infer<typeof DeviceMotionTrajectorySchema>
export type PointCloudPayload = z.infer<typeof PointCloudPayloadSchema>
export type SurfaceMeshPayload = z.infer<typeof SurfaceMeshPayloadSchema>

export function normalizeCaptureSessionManifest(value: unknown): CaptureSessionDescriptor {
  const manifest = CaptureSessionManifestSchema.parse(value)
  if (manifest.schemaVersion === 2) return CaptureSessionDescriptorSchema.parse(manifest)

  const streams: CaptureStreamDescriptor[] = []
  if (manifest.streams.roomModel) {
    streams.push({
      id: 'room-model',
      kind: manifest.streams.roomModel.kind,
      role: 'model',
      availability: 'ready',
      artifact: {
        id: `${manifest.sessionId}:room-model`,
        mediaType: manifest.streams.roomModel.mediaType,
        uri: manifest.streams.roomModel.url,
      },
    })
  }
  if (manifest.streams.deviceMotion) {
    streams.push({
      id: 'device-motion',
      kind: manifest.streams.deviceMotion.kind,
      role: 'deviceMotion',
      availability: 'ready',
      inline: manifest.streams.deviceMotion.trajectory,
    })
  }
  if (manifest.streams.pointCloud) {
    streams.push({
      id: 'point-cloud',
      kind: manifest.streams.pointCloud.kind,
      role: 'pointCloud',
      availability: 'ready',
      inline: manifest.streams.pointCloud.points,
    })
  }
  if (manifest.streams.surfaceMesh) {
    streams.push({
      id: 'surface-mesh',
      kind: manifest.streams.surfaceMesh.kind,
      role: 'surfaceMesh',
      availability: 'ready',
      inline: manifest.streams.surfaceMesh.mesh,
    })
  }

  return CaptureSessionDescriptorSchema.parse({
    schemaVersion: manifest.schemaVersion,
    sessionId: manifest.sessionId,
    projectId: manifest.projectId,
    state: 'ready',
    clocks: [],
    coordinateFrames: [],
    streams,
  })
}

export function captureLayerKey(stream: CaptureStreamDescriptor): string {
  if (stream.role) return stream.role
  if (stream.kind === 'room-model') return 'model'
  if (stream.kind === 'device-motion') return 'deviceMotion'
  if (stream.kind === 'point-cloud') return 'pointCloud'
  if (stream.kind === 'surface-mesh') return 'surfaceMesh'
  if (stream.kind === 'gaussian-splat') return 'splat'
  return stream.kind
}

export function captureStreamLabel(stream: CaptureStreamDescriptor): string {
  const key = captureLayerKey(stream)
  if (key === 'model') return '3D model'
  if (key === 'deviceMotion') return 'Device motion'
  if (key === 'pointCloud') return 'Point cloud'
  if (key === 'surfaceMesh') return 'Surface mesh'
  if (key === 'splat') return 'Gaussian splat'
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (value) => value.toUpperCase())
}

function validateSurfaceMeshByteLength(
  bytes: Uint8Array | null,
  expectedLength: number,
  path: 'colors' | 'indices' | 'positions',
  context: { addIssue(issue: { code: 'custom'; message: string; path: string[] }): void },
): void {
  if (bytes?.byteLength === expectedLength) return
  context.addIssue({
    code: 'custom',
    message: `Surface-mesh ${path} must contain exactly ${expectedLength} decoded bytes.`,
    path: [path],
  })
}

function decodeBase64(value: string): Uint8Array | null {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
  ) {
    return null
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const output = new Uint8Array((value.length / 4) * 3 - padding)
  let outputIndex = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index] ?? '')
    const b = alphabet.indexOf(value[index + 1] ?? '')
    const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2] ?? '')
    const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3] ?? '')
    const bits = a * 262_144 + b * 4096 + c * 64 + d
    if (outputIndex < output.length) output[outputIndex++] = Math.floor(bits / 65_536) % 256
    if (outputIndex < output.length) output[outputIndex++] = Math.floor(bits / 256) % 256
    if (outputIndex < output.length) output[outputIndex++] = bits % 256
  }
  return output
}

function validateUniqueSessionIds(
  value: {
    clocks: Array<{ id: string }>
    coordinateFrames: Array<{ id: string }>
    streams: Array<{ id: string }>
  },
  context: {
    addIssue(issue: { code: 'custom'; message: string; path: Array<number | string> }): void
  },
): void {
  validateUniqueIds(value.streams, 'streams', context)
  validateUniqueIds(value.clocks, 'clocks', context)
  validateUniqueIds(value.coordinateFrames, 'coordinateFrames', context)
}

function validateUniqueIds(
  values: Array<{ id: string }>,
  path: string,
  context: {
    addIssue(issue: { code: 'custom'; message: string; path: Array<number | string> }): void
  },
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate capture ${path} id: ${value.id}`,
        path: [path, index, 'id'],
      })
    }
    seen.add(value.id)
  })
}
