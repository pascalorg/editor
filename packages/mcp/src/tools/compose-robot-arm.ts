import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  composeRobotArmPrimitives,
  resolvePrimitiveWorldTransforms,
  type PrimitiveShapeInput,
  type ResolvedPrimitiveTransform,
  type RobotArmComposeInput,
} from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { BoxNode, CylinderNode, SphereNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec3Schema } from './schemas'

const ROBOT_ARM_STYLES = ['industrial', 'collaborative', 'fanuc'] as const
const ROBOT_ARM_POSES = ['rest', 'reach-forward', 'work-ready'] as const
const DETAIL_LEVELS = ['low', 'medium', 'high'] as const

export const composeRobotArmInput = {
  name: z.string().optional(),
  style: z.enum(ROBOT_ARM_STYLES).optional(),
  pose: z.enum(ROBOT_ARM_POSES).optional(),
  position: Vec3Schema.optional(),
  reach: z.number().min(0.8).max(8).optional(),
  baseHeight: z.number().min(0.12).max(2.8).optional(),
  detail: z.enum(DETAIL_LEVELS).optional(),
  materialPreset: z.string().optional(),
  parentId: NodeIdSchema.optional(),
}

export const composeRobotArmOutput = {
  createdIds: z.array(z.string()),
  count: z.number(),
}

function createNodeFromSpec(spec: PrimitiveShapeInput, transform: ResolvedPrimitiveTransform) {
  const { position, rotation } = transform

  switch (spec.kind) {
    case 'box':
      return BoxNode.parse({
        name: spec.name ?? 'Robot Arm Box',
        position,
        rotation,
        length: spec.length ?? 1.0,
        width: spec.width ?? 1.0,
        height: spec.height ?? 1.0,
        materialPreset: spec.materialPreset,
      })
    case 'cylinder':
      return CylinderNode.parse({
        name: spec.name ?? 'Robot Arm Cylinder',
        position,
        rotation,
        radius: spec.radius ?? 0.5,
        height: spec.height ?? 1.0,
        radialSegments: spec.radialSegments,
        materialPreset: spec.materialPreset,
      })
    case 'sphere':
      return SphereNode.parse({
        name: spec.name ?? 'Robot Arm Sphere',
        position,
        rotation,
        radius: spec.radius ?? 0.5,
        widthSegments: spec.widthSegments,
        heightSegments: spec.heightSegments,
        materialPreset: spec.materialPreset,
      })
    default:
      throw new Error(`Unsupported robot arm primitive: ${spec.kind}`)
  }
}

export function registerComposeRobotArm(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'compose_robot_arm',
    {
      title: 'Compose robot arm',
      description:
        'Create an editable draft industrial robot arm from a stable parameterized primitive template. Prefer this tool over compose_primitive for natural-language requests such as robot arm, industrial arm, FANUC arm, cobot, manipulator, gripper arm, or 6-axis robot. This creates an approximate blockout with base, shoulder, upper arm, elbow, forearm, wrist, flange, and gripper; it is not a high-fidelity branded CAD asset.',
      inputSchema: composeRobotArmInput,
      outputSchema: composeRobotArmOutput,
    },
    async ({ parentId, ...input }) => {
      const specs = composeRobotArmPrimitives(input as RobotArmComposeInput)
      const transforms = resolvePrimitiveWorldTransforms(specs)
      const createdIds: string[] = []

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]
        const transform = transforms[i]
        if (!spec || !transform) continue

        const node = createNodeFromSpec(spec, transform)
        const id = bridge.createNode(node, (parentId as AnyNodeId) ?? undefined)
        createdIds.push(id as string)
      }

      await publishLiveSceneSnapshot(bridge, 'compose_robot_arm')

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
