import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  resolvePrimitiveWorldTransforms,
  type PrimitiveShapeInput,
  type ResolvedPrimitiveTransform,
} from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { BoxNode, CylinderNode, LatheNode, SphereNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec3Schema } from './schemas'

const SHAPE_KINDS = ['box', 'cylinder', 'sphere', 'lathe'] as const
const ANCHORS = ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'] as const
const AXES = ['x', 'y', 'z'] as const

const PrimitiveShapeSpecSchema = z.object({
  kind: z.enum(SHAPE_KINDS),
  position: Vec3Schema,
  rotation: Vec3Schema.default([0, 0, 0]),
  scale: Vec3Schema.default([1, 1, 1]),
  name: z.string().optional(),
  length: z.number().min(0.1).max(20).optional(),
  width: z.number().min(0.1).max(20).optional(),
  height: z.number().min(0.1).max(20).optional(),
  radius: z.number().min(0.1).max(10).optional(),
  axis: z.enum(AXES).optional(),
  radialSegments: z.number().int().min(8).max(64).optional(),
  widthSegments: z.number().int().min(8).max(64).optional(),
  heightSegments: z.number().int().min(8).max(64).optional(),
  wallThickness: z.number().min(0.001).max(10).optional(),
  profile: z.array(z.tuple([z.number(), z.number()])).min(2).max(64).optional(),
  segments: z.number().int().min(8).max(128).optional(),
  arc: z.number().min(0.01).max(Math.PI * 2).optional(),
  materialPreset: z.string().optional(),
  attachTo: z.number().int().min(0).optional(),
  anchor: z.enum(ANCHORS).optional(),
  childAnchor: z.enum(ANCHORS).optional(),
})

type ShapeSpec = z.infer<typeof PrimitiveShapeSpecSchema>

export const composePrimitiveInput = {
  shapes: z.array(PrimitiveShapeSpecSchema).min(1).max(50),
  parentId: NodeIdSchema.optional(),
}

export const composePrimitiveOutput = {
  createdIds: z.array(z.string()),
  count: z.number(),
}

function createNodeFromSpec(spec: ShapeSpec, transform: ResolvedPrimitiveTransform) {
  const { position, rotation } = transform

  switch (spec.kind) {
    case 'box':
      return BoxNode.parse({
        name: spec.name ?? 'Box',
        position,
        rotation,
        length: spec.length ?? 1.0,
        width: spec.width ?? 1.0,
        height: spec.height ?? 1.0,
        materialPreset: spec.materialPreset,
      })
    case 'cylinder':
      return CylinderNode.parse({
        name: spec.name ?? (spec.wallThickness ? 'Hollow Cylinder' : 'Cylinder'),
        position,
        rotation,
        radius: spec.radius ?? 0.5,
        height: spec.height ?? 1.0,
        radialSegments: spec.radialSegments,
        wallThickness: spec.wallThickness,
        materialPreset: spec.materialPreset,
      })
    case 'sphere':
      return SphereNode.parse({
        name: spec.name ?? 'Sphere',
        position,
        rotation,
        scale: spec.scale,
        radius: spec.radius ?? 0.5,
        widthSegments: spec.widthSegments,
        heightSegments: spec.heightSegments,
        materialPreset: spec.materialPreset,
      })
    case 'lathe':
      return LatheNode.parse({
        name: spec.name ?? 'Lathe',
        position,
        rotation,
        profile: spec.profile,
        segments: spec.segments,
        arc: spec.arc,
        materialPreset: spec.materialPreset,
      })
  }
}

export function registerComposePrimitive(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'compose_primitive',
    {
      title: 'Compose primitive shapes',
      description:
        'Create one or more Pascal primitive nodes (box, cylinder, sphere, lathe) in the current scene. COORDINATE SYSTEM: +X=right, +Y=up, +Z=forward, y=0=ground. Position is world-space geometric center. PRIMITIVE CAPABILITIES: box — 6 flat faces, 3 independent dims (length=X, width=Z, height=Y), for flat/planar surfaces. cylinder — circular cross-section extruded along axis ("y"=vertical, "x"=left-right, "z"=front-back), for round straight extrusions. sphere+scale [sx,sy,sz] — all surfaces curved, stretches independently per axis, for domes/organic/curved shapes. lathe+profile [[x,y],...] — 2D profile revolved around Y axis (x=radius), for radially symmetric shapes. CHOOSE primitive by matching surface type: flat→box, curved→sphere/lathe, circular-extrusion→cylinder. wallThickness makes cylinders hollow. attachTo/anchor/childAnchor auto-aligns.',
      inputSchema: composePrimitiveInput,
      outputSchema: composePrimitiveOutput,
    },
    async ({ shapes, parentId }) => {
      const createdIds: string[] = []
      const transforms = resolvePrimitiveWorldTransforms(shapes as PrimitiveShapeInput[], { positionMode: 'world-center' })

      for (let i = 0; i < shapes.length; i++) {
        const spec = shapes[i]
        const transform = transforms[i]
        if (!spec || !transform) continue

        const node = createNodeFromSpec(spec, transform)
        const id = bridge.createNode(node, (parentId as AnyNodeId) ?? undefined)
        createdIds.push(id as string)
      }

      await publishLiveSceneSnapshot(bridge, 'compose_primitive')

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ createdIds, count: createdIds.length }),
          },
        ],
        structuredContent: { createdIds, count: createdIds.length },
      }
    },
  )
}
