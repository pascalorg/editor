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
  if (stream.kind === 'gaussian-splat') return 'splat'
  return stream.kind
}

export function captureStreamLabel(stream: CaptureStreamDescriptor): string {
  const key = captureLayerKey(stream)
  if (key === 'model') return '3D model'
  if (key === 'deviceMotion') return 'Device motion'
  if (key === 'pointCloud') return 'Point cloud'
  if (key === 'splat') return 'Gaussian splat'
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (value) => value.toUpperCase())
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
