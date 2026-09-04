import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

export const ArticraftJoint = z.object({
  name: z.string(),
  type: z.enum(['fixed', 'revolute', 'continuous', 'prismatic']),
  parent: z.string(),
  child: z.string(),
  axis: Vec3.default([0, 0, 1]),
  origin: z.object({
    xyz: Vec3.default([0, 0, 0]),
    rpy: Vec3.default([0, 0, 0]),
  }),
  limits: z
    .object({
      lower: z.number(),
      upper: z.number(),
    })
    .nullable()
    .default(null),
})

export const ArticraftAssetNode = BaseNode.extend({
  id: objectId('articraft'),
  type: nodeType('articraft:asset'),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  scale: z.number().positive().default(1),
  catalogId: z.string(),
  title: z.string(),
  source: z.enum(['articraft-10k', 'generated']),
  artifact: z.object({
    format: z.enum(['urdf', 'usdz']),
    url: z.string().url(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  thumbnailUrl: z.string().url().optional(),
  dimensions: Vec3.default([1, 1, 1]),
  parts: z
    .array(
      z.object({
        name: z.string(),
        objectName: z.string().optional(),
      }),
    )
    .default([]),
  joints: z.array(ArticraftJoint).default([]),
  jointValues: z.record(z.string(), z.number()).default({}),
  motionEnabled: z.boolean().default(false),
  attribution: z.object({
    creator: z.string(),
    license: z.string(),
    sourceUrl: z.string().url(),
    datasetRevision: z.string().optional(),
    sourceArchive: z.string().optional(),
  }),
  prompt: z.string().optional(),
})

export type ArticraftAssetNode = z.infer<typeof ArticraftAssetNode>
