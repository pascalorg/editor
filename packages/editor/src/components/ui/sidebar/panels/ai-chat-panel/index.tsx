'use client'

import {
  BoxNode,
  CylinderNode,
  LatheNode,
  SphereNode,
  composeRobotArmPrimitives,
  resolvePrimitiveWorldTransforms,
  type PrimitiveShapeInput,
  type RobotArmComposeInput,
  type Vec3,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../../../../i18n'
import { cn } from '../../../../../lib/utils'

interface ShapeSpec {
  kind: string
  position: Vec3
  rotation: Vec3
  scale?: Vec3
  name?: string
  length?: number
  width?: number
  height?: number
  radius?: number
  axis?: string
  radialSegments?: number
  widthSegments?: number
  heightSegments?: number
  wallThickness?: number
  profile?: [number, number][]
  segments?: number
  arc?: number
  materialPreset?: string
  attachTo?: number
  anchor?: string
  childAnchor?: string
}

const COMPOSE_PRIMITIVE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_primitive',
    description:
      'Create editable primitive shapes in the 3D scene. Choose the primitive that matches each surface type: flat surfaces → box, curved surfaces → sphere+scale or lathe, circular extrusions → cylinder. Use attachTo/anchor/childAnchor for connected parts instead of hand-computing offsets.',
    parameters: {
      type: 'object',
      properties: {
        shapes: {
          type: 'array',
          description:
            'Shapes to create, ordered from parent to child. Child shapes use attachTo to reference an earlier shape index.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['box', 'cylinder', 'sphere', 'lathe'],
                description: 'Primitive type. box=flat faces, cylinder=circular extrusion, sphere=curved surface (use scale), lathe=radially symmetric profile.',
              },
              position: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'World-space geometric center [x, y, z] in meters. Always use the absolute world position, even for attached shapes — the system auto-aligns via anchor/childAnchor.',
              },
              rotation: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'Local Euler rotation [x, y, z] in radians. Defaults to [0, 0, 0]. For cylinders, prefer axis for primary orientation.',
              },
              scale: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'Non-uniform scale [sx, sy, sz] for spheres to create ellipsoids. [2, 0.3, 1] makes a wide flat dome (engine hood). [1, 2, 1] makes an elongated egg shape. [1, 1, 0.3] makes a thin disc. Defaults to [1, 1, 1]. Only meaningful for spheres.',
              },
              length: { type: 'number', description: 'Box length along local X, in meters.' },
              width: { type: 'number', description: 'Box width/depth along local Z, in meters.' },
              height: { type: 'number', description: 'Box or cylinder height along its local axis, in meters.' },
              radius: { type: 'number', description: 'Cylinder or sphere radius, in meters.' },
              axis: {
                type: 'string',
                enum: ['x', 'y', 'z'],
                description:
                  'Which direction the cylinder extends. "y"=vertical, "x"=left-right, "z"=front-back. For a wheel rolling along X (forward), use "z" (axle side-to-side).',
              },
              radialSegments: {
                type: 'number',
                description: 'Cylinder smoothness. Use 24-48 for visible round mechanical parts.',
              },
              widthSegments: {
                type: 'number',
                description: 'Sphere horizontal smoothness. Use 24-48 for visible round joints.',
              },
              heightSegments: {
                type: 'number',
                description: 'Sphere vertical smoothness. Use 16-32 for visible round joints.',
              },
              wallThickness: {
                type: 'number',
                description: 'Wall thickness in meters for hollow cylinders (buckets, pipes, barrels, cans, cups, pots, vases, drums). Omit for solid cylinders like legs or columns.',
              },
              profile: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description: 'For lathe shapes only. Array of [x, y] point pairs defining a 2D profile revolved around the Y axis. Points should be ordered from bottom to top. x is the radius at each height. Example: [[0.05,0],[0.15,0.1],[0.12,0.25],[0.08,0.3]] creates a bottle shape. Default: [[0,0],[0.5,1]].',
              },
              segments: {
                type: 'number',
                description: 'For lathe shapes only. Number of rotational segments (smoothness). Use 32-64 for visible curved surfaces. Default: 32.',
              },
              arc: {
                type: 'number',
                description: 'For lathe shapes only. Revolve angle in radians. Use 2*PI (≈6.283) for full revolution. Use smaller values for partial sweeps. Default: 6.283 (full circle).',
              },
              materialPreset: { type: 'string', description: 'Optional material preset id.' },
              name: { type: 'string', description: 'Shape name.' },
              attachTo: {
                type: 'number',
                description:
                  '0-based parent shape index in the shapes array. Must reference a prior shape. The child inherits parent rotation.',
              },
              anchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description: 'Parent connection point. Defaults to top.',
              },
              childAnchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description:
                  'Child connection point to align to the parent anchor. Use bottom for upright posts on top of a base, back/front for end-to-end horizontal links, and center for centered attachments.',
              },
            },
            required: ['kind', 'position'],
          },
        },
      },
      required: ['shapes'],
    },
  },
}

const COMPOSE_ROBOT_ARM_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_robot_arm',
    description:
      'Create an editable draft industrial robot arm from a stable primitive template. Prefer this over compose_primitive for robot arm, industrial arm, FANUC arm, cobot, manipulator, gripper arm, or 6-axis robot requests. It creates an approximate blockout with base, shoulder, upper arm, elbow, forearm, wrist, flange, and gripper.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional object name prefix.' },
        style: {
          type: 'string',
          enum: ['industrial', 'collaborative', 'fanuc'],
          description: 'Robot arm style. Use fanuc when the user asks for FANUC-like yellow industrial arms.',
        },
        pose: {
          type: 'string',
          enum: ['rest', 'reach-forward', 'work-ready'],
          description: 'Approximate generated pose.',
        },
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Base position [x, y, z] in meters. Defaults to scene origin on the ground.',
        },
        reach: {
          type: 'number',
          description: 'Approximate total reach in meters. Defaults to 2.4.',
        },
        baseHeight: {
          type: 'number',
          description: 'Base cylinder height in meters. Usually omit unless requested.',
        },
        detail: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Round-part smoothness. Use medium by default.',
        },
        materialPreset: { type: 'string', description: 'Optional material preset id.' },
      },
      required: [],
    },
  },
}

const BASE_RULES = `You are the 3D modeling assistant inside the Pascal editor. You work in 3 stages: analyze, generate, review.

Available tools:
- compose_primitive(shapes): Create box, cylinder, sphere, or lathe shapes.
- compose_robot_arm(...): Create robot arm drafts. Prefer for robot/cobot/FANUC/manipulator requests.

===== COORDINATE SYSTEM =====
+X = right, +Y = up, +Z = forward. y=0 is the ground plane.
Position [x,y,z] is always the geometric center of the shape.
Rotation [rx,ry,rz] is Euler angles in radians.

===== PRIMITIVE CAPABILITIES =====
Each primitive produces a specific 3D shape. Choose the one that matches the real object's geometry.

BOX = a rectangular block. 6 flat faces, 6 sharp 90° edges.
  Params: length(X), width(Z), height(Y) in meters.
  Suitable: walls, tabletops, shelves, panels, chassis, square legs.
  NOT suitable: anything round, curved, or circular.

CYLINDER = a round bar/rod/disc with TWO FLAT CIRCULAR END CAPS + one curved side wall.
  Params: radius, height, axis ("y"=vertical, "x"=left-right, "z"=front-back).
  height can be SHORT (a thin disc) or LONG (a pipe/rod).
  Suitable:
    - WHEEL/TIRE: axis="z", radius=0.35, height=0.22 (car wheel rolling along X)
    - RIM/HUB: axis="z", radius=0.22, height=0.02 (thin flat disc — the face of a wheel)
    - TABLE LEG: axis="y", radius=0.03, height=0.7
    - PIPE: axis="y"/"x"/"z" + wallThickness for hollow
    - COLUMN: axis="y", radius=0.2, height=3
  NOT suitable: anything that tapers, bulges, or has non-circular cross-section.

SPHERE = a BALL shape. Base radius=1.0. Stretched by scale [sx,sy,sz].
  ALL surfaces are curved — NO flat faces anywhere. Even when scaled flat, the rim/edge stays rounded.
  scale [sx,sy,sz]: final half-extents = scale values (e.g. scale [2,0.5,1] → 4m long, 1m tall, 2m wide).
  Suitable:
    - DOME/ROOF: scale [1.5,0.25,0.85] (wide, low, slightly curved roof)
    - EGG: scale [0.5,1.5,0.5] (tall egg shape)
    - CAR ROOF: scale [1.5,0.25,0.8] placed on top of body box
  NOT suitable:
    - Flat discs (rims, coins, plates) → use CYLINDER with short height instead
    - Wheels/tires → use CYLINDER
    - Anything that needs flat faces → use BOX
    - Pancakes/lenses that should have flat edges → sphere edges stay curved

LATHE = a 2D profile [[x,y],...] revolved around Y axis. Radially symmetric.
  x = radius at height y. Bottom-to-top order.
  Suitable: vases, bowls, bottles, lamp shades, turned legs, bells.
  NOT suitable: anything not symmetric around a vertical axis.

===== HOW TO CHOOSE (decision tree) =====
Decide by looking at the MAIN visible surface of the part:

1. Is the MAIN surface FLAT / PLANAR?
   - YES, and it's rectangular → BOX (e.g. wall, tabletop, chassis floor)
   - YES, and it's circular (disc/coin/plate) → CYLINDER with short height (e.g. rim, hubcap)
   - YES, and it's a round bar/rod → CYLINDER with long height (e.g. pipe, table leg)

2. Is the MAIN surface CURVED / ROUNDED?
   - YES, and it's a dome, bump, arch, or organic blob → SPHERE+scale
   - YES, and it's symmetric around a vertical center → LATHE
   - YES, and it's a circular extrusion with straight sides → CYLINDER

3. SPECIAL CASE — CAR ROOF: A car roof is CURVED (convex dome). MUST use SPHERE+scale. If you use a box, the car looks like a shipping container. This is the single most common mistake.

CRITICAL: DO NOT DEFAULT TO BOX. If a surface has ANY curvature, it is NOT a box. A roof has curvature. A hood has slight curvature. A car body has curvature on top.

===== INVARIANT RULES =====
- Position is world-space geometric center. y=0 is ground.
- Sphere base radius=1.0. Final half-extents = scale values. scale [2,0.5,1] → shape is 4m(X)×1m(Y)×2m(Z).
- Cylinder axis: "y"=vertical, "x"=left-right, "z"=front-back. Car wheels → "z" (axle side-to-side, rolls along X).
- wallThickness: makes cylinders hollow (pipes, buckets). Omit for solid cylinders (legs, wheels, rims).
- attachTo + anchor + childAnchor: parent before child in array. Auto-aligns along anchor axis.
- widthSegments/heightSegments/radialSegments: 32-48 for smooth visible curves.
- LIMIT: 8-12 parts max. Skip anything <15cm. Focus on major recognizable shapes, not micro-details.
`

const STAGE1_ANALYST = `${BASE_RULES}

===== STAGE 1: ANALYZE =====
Analyze the user's request and produce a structured decomposition plan. Output TEXT ONLY. Do NOT call any tools.

For each part, specify:
1. Name
2. Primitive kind — choose by matching surface type to primitive capability (flat→box, curved→sphere/lathe, circular→cylinder)
3. Key dimensions in meters (length/width/height for box, radius+height+axis for cylinder, radius+scale for sphere, profile for lathe)
4. World-space position [x, y, z] — geometric center
5. How it connects to other parts (attachTo/anchor/childAnchor), if applicable

Think step by step for each part: "What is this surface like in reality? Which primitive matches that geometry?"

VEHICLE-SPECIFIC (most common failure):
- Roof, cabin top, curved body panels → MUST use SPHERE+scale. A box roof = failure.
- Lower body, chassis, flat panels → BOX.
- Wheels, tires → CYLINDER axis "z".
- 8 parts max: body(box) + roof(sphere) + 4 wheels + optional hood/trunk(box).
`

const STAGE2_GENERATOR = `${BASE_RULES}

===== STAGE 2: GENERATE =====
Based on the analysis, call compose_primitive or compose_robot_arm to create the geometry.

Follow the analysis plan — same kinds, dimensions, positions.
- Include ALL shapes in a single call. Parent before child.
- For cylinders, use axis ("x"/"y"/"z") rather than manual rotation.
- REMINDER: car roof/cabin is SPHERE+scale, not box. DO NOT output a box for a roof — it will be rejected by review.
`

const STAGE3_REVIEWER = `${BASE_RULES}

===== STAGE 3: REVIEW =====
Review the shapes just created. Check for these violations:

1. BOX OVERUSE: Car roof, cabin top, or dome as BOX → WRONG. Must be SPHERE+scale. A car with a box roof looks like a container truck, not a car. This is the #1 most common error.

2. WRONG PRIMITIVE: Thin disc as sphere → use CYLINDER short height. Curved surface as box → use SPHERE.

3. ORIENTATION: Cylinder axis direction. Car wheels → "z". Table legs → "y".

4. PROPORTIONS: Sphere scale values = half-extents. sz should not exceed body width.

===== CORRECTION RULES (CRITICAL) =====
- DO NOT recreate the entire object. ONLY fix the specific parts that are WRONG.
- If the roof is a box but should be sphere+scale → output ONLY the corrected roof shape, NOT the whole car.
- If wheels are correct → DO NOT include them in the correction.
- If nothing is wrong → output TEXT ONLY, no tool call.
- Name corrected shapes with "-fixed" suffix.
- Example of WRONG: outputting 15 shapes when only the roof needs fixing.
- Example of CORRECT: outputting 1 shape (the fixed roof) and leaving the rest alone.
`


interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  articraftResult?: ArticraftResult
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  isToolResult?: boolean
  toolCallId?: string
}

interface ArticraftResult {
  prompt: string
  status: 'ready' | 'imported'
  recordId: string
  name: string
  partCount: number
  jointCount: number
  data: Record<string, unknown>
}

export function AiChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [articulationMode, setArticulationMode] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const baseUrl = process.env.NEXT_PUBLIC_AI_BASE_URL ?? ''
  const apiKey = process.env.NEXT_PUBLIC_AI_API_KEY ?? ''
  const model = process.env.NEXT_PUBLIC_AI_MODEL ?? 'gpt-4o'
  const articraftViewerUrl = process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765'

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const executeToolCall = useCallback((name: string, args: Record<string, unknown>): string => {
    console.log(`[AI-Chat] 🔨 executeToolCall: ${name}`)
    console.log(`[AI-Chat] 🔨 raw args:`, JSON.stringify(args, null, 2).slice(0, 4000))

    if (name !== 'compose_primitive' && name !== 'compose_robot_arm') {
      return t('aiChat.unknownTool', { fallback: '未知工具：{name}', params: { name } })
    }

    const rawShapes =
      name === 'compose_robot_arm'
        ? composeRobotArmPrimitives(args as RobotArmComposeInput)
        : (args.shapes as Array<Record<string, unknown>> | undefined)
    if (!rawShapes?.length) return t('aiChat.noShapes', '没有可创建的几何体。')

    const shapes: ShapeSpec[] = rawShapes.map((shape) => ({
      kind: shape.kind as string,
      position: (shape.position as Vec3) ?? [0, 0, 0],
      rotation: (shape.rotation as Vec3) ?? [0, 0, 0],
      scale: (shape.scale as Vec3) ?? [1, 1, 1],
      name: shape.name as string | undefined,
      length: shape.length as number | undefined,
      width: shape.width as number | undefined,
      height: shape.height as number | undefined,
      radius: shape.radius as number | undefined,
      axis: shape.axis as string | undefined,
      radialSegments: shape.radialSegments as number | undefined,
      widthSegments: shape.widthSegments as number | undefined,
      heightSegments: shape.heightSegments as number | undefined,
      wallThickness: shape.wallThickness as number | undefined,
      profile: shape.profile as [number, number][] | undefined,
      segments: shape.segments as number | undefined,
      arc: shape.arc as number | undefined,
      materialPreset: shape.materialPreset as string | undefined,
      attachTo: shape.attachTo as number | undefined,
      anchor: shape.anchor as string | undefined,
      childAnchor: shape.childAnchor as string | undefined,
    }))

    const transforms = resolvePrimitiveWorldTransforms(shapes as PrimitiveShapeInput[], { positionMode: 'world-center' })
    const levelId = useViewer.getState().selection.levelId
    const scene = useScene.getState()
    const created: string[] = []

    const clampD = (v: unknown, fallback: number, min = 0.01, max = 50) =>
      Math.max(min, Math.min(max, typeof v === 'number' && !Number.isNaN(v) ? v : fallback))
    const clampR = (v: unknown, fallback: number) => clampD(v, fallback, 0.01, 10)

    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i]
      const transform = transforms[i]
      if (!shape || !transform) continue

      const { position, rotation } = transform
      const displayName = shape.name ?? shape.kind

      try {
        let node
        switch (shape.kind) {
          case 'box':
            node = BoxNode.parse({
              name: displayName,
              position,
              rotation,
              length: clampD(shape.length, 1.0),
              width: clampD(shape.width, 1.0),
              height: clampD(shape.height, 1.0),
              materialPreset: shape.materialPreset,
            })
            break
          case 'cylinder': {
            const wt = shape.wallThickness
            node = CylinderNode.parse({
              name: displayName || (wt ? 'Hollow Cylinder' : 'Cylinder'),
              position,
              rotation,
              radius: clampR(shape.radius, 0.5),
              height: clampD(shape.height, 1.0, 0.01, 20),
              radialSegments:
                shape.radialSegments != null ? Math.round(clampD(shape.radialSegments, 32, 8, 64)) : undefined,
              wallThickness: wt != null ? clampD(wt, 0.05, 0.001, 10) : undefined,
              materialPreset: shape.materialPreset,
            })
            break
          }
          case 'sphere':
            node = SphereNode.parse({
              name: displayName,
              position,
              rotation,
              scale: shape.scale as [number, number, number] | undefined,
              radius: clampR(shape.radius, 0.5),
              widthSegments:
                shape.widthSegments != null ? Math.round(clampD(shape.widthSegments, 32, 8, 64)) : undefined,
              heightSegments:
                shape.heightSegments != null ? Math.round(clampD(shape.heightSegments, 32, 8, 64)) : undefined,
              materialPreset: shape.materialPreset,
            })
            break
          case 'lathe':
            node = LatheNode.parse({
              name: displayName,
              position,
              rotation,
              profile: shape.profile as [number, number][] | undefined,
              segments: shape.segments != null ? Math.round(clampD(shape.segments, 32, 8, 128)) : undefined,
              arc: shape.arc != null ? clampD(shape.arc, Math.PI * 2, 0.01, Math.PI * 2) : undefined,
              materialPreset: shape.materialPreset,
            })
            break
          default:
            continue
        }

        scene.createNode(node, levelId ?? undefined)
        created.push(displayName)
      } catch {
        // Invalid tool output is skipped after clamping.
      }
    }

    if (created.length > 0) {
      const firstNode = [...Object.values(scene.nodes)].reverse().find(
        (node: { name?: string; id: string }) => node.name === created[0],
      )
      if (firstNode) useViewer.getState().setSelection({ selectedIds: [firstNode.id] })
    }

    // Build detailed shape summary for Stage 3 review
    const shapeDetails = shapes.map((s) => {
      const parts: string[] = [`  - ${s.name ?? s.kind}: ${s.kind}`]
      parts.push(`pos=[${(s.position as Vec3).join(',')}]`)
      if (s.kind === 'box') parts.push(`${s.length}x${s.width}x${s.height}`)
      if (s.kind === 'cylinder') parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      if (s.kind === 'sphere') parts.push(`r=${s.radius}, scale=[${(s.scale as Vec3).join(',')}]${s.rotation && (s.rotation as Vec3).some(v => v !== 0) ? `, rot=[${(s.rotation as Vec3).join(',')}]` : ''}`)
      if (s.kind === 'lathe') parts.push(`profile=${s.profile?.length ?? 0}pts, seg=${s.segments}`)
      if (s.attachTo != null) parts.push(`attachTo=${s.attachTo}`)
      return parts.join(' ')
    }).join('\n')

    return `Created ${created.length} shapes:\n${shapeDetails}\nNames: ${created.join(', ')}`
  }, [])

  const callApi = useCallback(
    async (
      apiMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>,
      tools?: Array<typeof COMPOSE_PRIMITIVE_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL>,
    ) => {
      const hasTools = tools && tools.length > 0
      const systemMsg = apiMessages.find(m => m.role === 'system')
      const stageTag = systemMsg?.content?.includes('STAGE 1') ? 'Stage1-Analyst' :
        systemMsg?.content?.includes('STAGE 2') ? 'Stage2-Generator' :
        systemMsg?.content?.includes('STAGE 3') ? 'Stage3-Reviewer' : 'API'
      console.log(`[AI-Chat] ${stageTag} → calling API (tools=${hasTools}, messages=${apiMessages.length})`)
      const body: Record<string, unknown> = {
        model,
        messages: apiMessages,
        ...(hasTools ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: 4096,
      }
      console.log(`[AI-Chat] ${stageTag} request body:`, JSON.stringify(body, null, 2).slice(0, 2000))
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[AI-Chat] API error: ${res.status} ${res.statusText}`, errText)
        throw new Error(`${res.status} ${res.statusText}${errText ? `: ${errText}` : ''}`)
      }

      const data = await res.json()
      const msg = data.choices?.[0]?.message
      if (!msg) throw new Error('Empty response from AI.')
      const hasToolCalls = msg.tool_calls?.length > 0
      console.log(`[AI-Chat] ← response: role=${msg.role}, contentLen=${msg.content?.length ?? 0}, toolCalls=${msg.tool_calls?.length ?? 0}`)
      if (msg.content) {
        console.log(`[AI-Chat] ← content preview:`, msg.content.slice(0, 500))
      }
      if (hasToolCalls) {
        for (const tc of msg.tool_calls!) {
          console.log(`[AI-Chat] ← tool_call: ${tc.function.name}`, tc.function.arguments.slice(0, 2000))
        }
      }
      return msg as {
        role: string
        content?: string
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
    },
    [baseUrl, model, apiKey],
  )

  const importArticraftResult = useCallback((result: ArticraftResult): number => {
    const links = (result.data.links as Array<Record<string, unknown>>) ?? []
    const joints = (result.data.joints as Array<Record<string, unknown>>) ?? []
    const createdNames: string[] = []
    const levelId = useViewer.getState().selection.levelId
    const scene = useScene.getState()
    const nodeIdByLink = new Map<string, string>()
    const parentLinkByChild = new Map<string, string>()

    for (const joint of joints) {
      parentLinkByChild.set(joint.child as string, joint.parent as string)
    }

    function createLinkNodes(linkName: string) {
      if (nodeIdByLink.has(linkName)) return
      const parentLink = parentLinkByChild.get(linkName)
      if (parentLink && !nodeIdByLink.has(parentLink)) createLinkNodes(parentLink)

      const link = links.find((candidate) => candidate.name === linkName)
      if (!link) return

      const visuals = (link.visuals as Array<Record<string, unknown>>) ?? []
      for (let vi = 0; vi < Math.max(1, visuals.length); vi++) {
        const visual = visuals[vi]
        if (!visual) continue

        const geom = visual.geometry as { type: string; params: Record<string, number> }
        const origin = visual.origin as { xyz: Vec3; rpy: Vec3 }
        const pos: Vec3 = [origin.xyz[0], origin.xyz[2], -origin.xyz[1]]
        const rot: Vec3 = [origin.rpy[0], origin.rpy[2], -origin.rpy[1]]
        const parentNodeId = parentLink ? nodeIdByLink.get(parentLink) : undefined
        const parentId = (parentNodeId ?? levelId ?? undefined) as never

        try {
          let node
          const nodeName = visuals.length > 1 ? `${linkName}_v${vi}` : linkName

          if (geom.type === 'box') {
            node = BoxNode.parse({
              name: nodeName,
              position: pos,
              rotation: rot,
              length: geom.params.length ?? 1.0,
              width: geom.params.width ?? 1.0,
              height: geom.params.height ?? 1.0,
            })
          } else if (geom.type === 'cylinder') {
            node = CylinderNode.parse({
              name: nodeName,
              position: pos,
              rotation: rot,
              radius: geom.params.radius ?? 0.5,
              height: geom.params.length ?? 1.0,
            })
          } else {
            node = SphereNode.parse({
              name: nodeName,
              position: pos,
              rotation: rot,
              radius: geom.type === 'sphere' ? (geom.params.radius ?? 0.5) : 0.05,
            })
          }

          node.metadata = {
            ...(node.metadata as Record<string, unknown> | undefined),
            articraft: {
              recordId: result.recordId,
              name: result.name,
              prompt: result.prompt,
            },
          } as Record<string, unknown> as never

          if (articulationMode && vi === 0) {
            const joint = joints.find((candidate) => candidate.child === linkName)
            if (joint) {
              const jOrigin = joint.origin as { xyz: Vec3; rpy: Vec3 }
              const jAxis = joint.axis as Vec3
              node.metadata = {
                ...(node.metadata as Record<string, unknown> | undefined),
                articraftJoint: {
                  jointName: joint.name,
                  jointType: joint.type,
                  parentLink: joint.parent,
                  childLink: joint.child,
                  axis: [jAxis[0], jAxis[2], -jAxis[1]],
                  origin: {
                    xyz: [jOrigin.xyz[0], jOrigin.xyz[2], -jOrigin.xyz[1]],
                    rpy: [jOrigin.rpy[0], jOrigin.rpy[2], -jOrigin.rpy[1]],
                  },
                  limits: joint.limits,
                  currentValue: 0,
                },
              } as Record<string, unknown> as never
            }
          }

          scene.createNode(node, parentId ?? undefined)
          createdNames.push(nodeName)
          if (vi === 0) nodeIdByLink.set(linkName, node.id)
        } catch {
          // Skip invalid Articraft visual records.
        }
      }
    }

    const roots = links.filter((link) => !parentLinkByChild.has(link.name as string))
    for (const root of roots) createLinkNodes(root.name as string)

    const firstNode = [...Object.values(scene.nodes)].reverse().find(
      (node) => typeof node.name === 'string' && createdNames.includes(node.name),
    )
    if (firstNode) useViewer.getState().setSelection({ selectedIds: [firstNode.id] })

    return createdNames.length
  }, [articulationMode])

  const openArticraftViewer = useCallback((recordId: string) => {
    const base = articraftViewerUrl.replace(/\/$/, '')
    window.open(`${base}/viewer?record=${encodeURIComponent(recordId)}&tab=inspect`, '_blank', 'noopener,noreferrer')
  }, [articraftViewerUrl])

  const markArticraftImported = useCallback((recordId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.articraftResult?.recordId === recordId
          ? { ...message, articraftResult: { ...message.articraftResult, status: 'imported' } }
          : message,
      ),
    )
  }, [])

  const handleImportArticraftResult = useCallback((result: ArticraftResult) => {
    const count = importArticraftResult(result)
    markArticraftImported(result.recordId)
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: t('aiChat.articraftImported', {
          fallback: '已导入当前场景：{count} 个部件。',
          params: { count },
        }),
      },
    ])
  }, [importArticraftResult, markArticraftImported])

  const sendArticraftMessage = useCallback(async (text: string) => {
    setInput('')
    const userMsg: ChatMessage = { role: 'user', content: text }
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: t('aiChat.articraftGenerating', '正在用 Articraft 生成模型...'),
    }
    setMessages((prev) => [...prev, userMsg, progressMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/articraft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, mode: articulationMode ? 'articulated' : 'static' }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((errData as { error?: string }).error ?? res.statusText)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let resultData: Record<string, unknown> | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6)
          try {
            const event = JSON.parse(jsonStr)
            if (event.type === 'progress') {
              setMessages((prev) => {
                const updated = [...prev]
                const lastIdx = updated.length - 1
                if (lastIdx >= 0 && updated[lastIdx]?.role === 'assistant' && !updated[lastIdx]?.isToolResult) {
                  updated[lastIdx] = { ...updated[lastIdx]!, content: event.message as string }
                }
                return updated
              })
            } else if (event.type === 'result') {
              resultData = event.data as Record<string, unknown>
            } else if (event.type === 'error') {
              throw new Error(event.message as string)
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }

      if (!resultData) throw new Error('No result data from articraft')

      const resultLinks = (resultData.links as Array<Record<string, unknown>>) ?? []
      const resultJoints = (resultData.joints as Array<Record<string, unknown>>) ?? []
      const result: ArticraftResult = {
        prompt: text,
        status: 'ready',
        recordId: String(resultData.recordId ?? ''),
        name: String(resultData.name ?? resultData.recordId ?? 'Articraft asset'),
        partCount: resultLinks.length,
        jointCount: resultJoints.length,
        data: resultData,
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: t('aiChat.articraftReady', 'Articraft 生成完成，请先检查或导入。'),
          articraftResult: result,
        },
      ])
      return
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('aiChat.error', { fallback: '閿欒锛歿message}', params: { message: errorMsg } }) },
      ])
    } finally {
      setLoading(false)
    }
  }, [articulationMode])

  // Helper: execute tool_calls from an API response, return result strings.
  // Updates chat messages in-place via setMessages callback.
  const processToolCalls = useCallback(
    async (
      response: { role: string; content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> },
      apiMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>,
      tools: Array<typeof COMPOSE_PRIMITIVE_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL>,
      label: string,
    ): Promise<{ results: string[]; lastContent: string }> => {
      const allResults: string[] = []
      let currentResponse = response
      let lastContent = response.content ?? ''

      while (currentResponse.tool_calls?.length) {
        const toolResultApiMsgs: Array<{ role: string; tool_call_id: string; content: string }> = []

        for (const tc of currentResponse.tool_calls) {
          const result = executeToolCall(tc.function.name, JSON.parse(tc.function.arguments))
          toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
          allResults.push(result)
        }

        // Update the placeholder message with results so far
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `**${label}:**\n${allResults.join('\n')}` }
          return updated
        })

        apiMessages.push({
          role: 'assistant',
          content: currentResponse.content ?? '',
          tool_calls: currentResponse.tool_calls.map((tc) => ({
            type: 'function' as const,
            id: tc.id,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        } as Record<string, unknown> as never)
        apiMessages.push(...toolResultApiMsgs)

        currentResponse = await callApi(apiMessages, tools)
        if (currentResponse.content) lastContent = currentResponse.content
      }

      return { results: allResults, lastContent }
    },
    [callApi, executeToolCall],
  )

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    if (articulationMode) {
      await sendArticraftMessage(text)
      return
    }

    if (!baseUrl || !apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: t('aiChat.noConfig', '请在 .env.local 中设置 NEXT_PUBLIC_AI_BASE_URL 和 NEXT_PUBLIC_AI_API_KEY。'),
        },
      ])
      return
    }

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      // ===== STAGE 1: ANALYZE (no tools — text only) =====
      console.log('[AI-Chat] ===== STAGE 1: ANALYZE =====')
      setMessages((prev) => [...prev, { role: 'assistant', content: '**📋 Analysis:**\n_Thinking..._' }])

      const analysisResponse = await callApi(
        [
          { role: 'system', content: STAGE1_ANALYST },
          { role: 'user', content: text },
        ],
        [],
      )
      const analysis = analysisResponse.content ?? ''

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: `**📋 Analysis:**\n${analysis}` }
        return updated
      })

      // ===== STAGE 2: GENERATE (with tools) =====
      console.log('[AI-Chat] ===== STAGE 2: GENERATE =====')
      setMessages((prev) => [...prev, { role: 'assistant', content: '**🔧 Generate:**\n_Generating..._' }])

      const genMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }> = [
        { role: 'system', content: STAGE2_GENERATOR },
        {
          role: 'user',
          content: `User request: ${text}\n\nAnalysis:\n${analysis}\n\nNow call compose_primitive based on this analysis. Output ALL shapes in one call.`,
        },
      ]

      let genResponse = await callApi(genMessages, [COMPOSE_PRIMITIVE_TOOL, COMPOSE_ROBOT_ARM_TOOL])
      const genResult = await processToolCalls(genResponse, genMessages, [COMPOSE_PRIMITIVE_TOOL, COMPOSE_ROBOT_ARM_TOOL], '🔧 Generate')

      // If no tool calls were made, show the text response
      if (genResult.results.length === 0) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `**🔧 Generate:**\n${genResult.lastContent || '(no output)'}` }
          return updated
        })
      }

      // ===== STAGE 3: REVIEW (with tools for corrections) =====
      console.log('[AI-Chat] ===== STAGE 3: REVIEW =====')
      setMessages((prev) => [...prev, { role: 'assistant', content: '**🔍 Self-Check:**\n_Reviewing..._' }])

      const reviewMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }> = [
        { role: 'system', content: STAGE3_REVIEWER },
        {
          role: 'user',
          content: `User request: ${text}\n\nGenerated shapes:\n${genResult.results.join('\n')}\n\nReview these shapes. If any are wrong (boxes instead of sphere+scale for curved bodies, unrealistic dimensions, wrong positions), call compose_primitive with CORRECTED versions. Otherwise confirm.`,
        },
      ]

      const reviewResponse = await callApi(reviewMessages, [COMPOSE_PRIMITIVE_TOOL])
      const reviewResult = await processToolCalls(reviewResponse, reviewMessages, [COMPOSE_PRIMITIVE_TOOL], '🔍 Self-Check')

      // Final update: show review text (confirmations or correction results)
      setMessages((prev) => {
        const updated = [...prev]
        const finalContent = reviewResult.results.length > 0
          ? `**🔍 Self-Check:**\n${reviewResult.lastContent}\n\nCorrections:\n${reviewResult.results.join('\n')}`
          : `**🔍 Self-Check:**\n${reviewResult.lastContent || reviewResponse.content || 'Review complete.'}`
        updated[updated.length - 1] = { role: 'assistant', content: finalContent }
        return updated
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('aiChat.error', { fallback: '错误：{message}', params: { message: errorMsg } }) },
      ])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, baseUrl, apiKey, articulationMode, sendArticraftMessage, callApi, executeToolCall, processToolCalls])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  const hasConfig = baseUrl && apiKey

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-border/50 border-b px-3 py-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" icon="mdi:robot-outline" />
        <span className="text-xs font-medium">{t('aiChat.title', 'AI 助手')}</span>
        {!hasConfig && (
          <span className="ml-auto text-[10px] text-orange-400">
            {t('aiChat.notConfigured', '未配置')}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <Icon className="mx-auto mb-2 size-8 opacity-30" icon="mdi:cube-scan" />
            <p>{t('aiChat.placeholder', '描述你想创建的物体，AI 会在画布中生成可编辑草模。')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {['鼓风机', '工作台', '储物架', '排风扇'].map((hint) => (
                <button
                  className="rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  key={hint}
                  onClick={() => setInput(hint)}
                  type="button"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
              msg.role === 'user'
                ? 'bg-accent/60 text-foreground'
                : msg.isToolResult
                  ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'bg-transparent text-muted-foreground',
            )}
            key={`${msg.role}-${i}`}
          >
            {msg.role === 'user' ? (
              msg.content
            ) : msg.toolCalls ? (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="size-3.5 shrink-0" icon="mdi:tools" />
                <span>
                  {t('aiChat.calling', '正在调用工具...')} {msg.toolCalls.map((tc) => tc.name).join(', ')}
                </span>
              </div>
            ) : msg.articraftResult ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2 text-foreground">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{msg.articraftResult.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      record: {msg.articraftResult.recordId || '-'}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]',
                      msg.articraftResult.status === 'imported'
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : 'border-sky-400/40 bg-sky-400/10 text-sky-300',
                    )}
                  >
                    {msg.articraftResult.status === 'imported' ? '已导入' : '可检查'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[11px]">
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">部件</div>
                    <div className="font-medium">{msg.articraftResult.partCount}</div>
                  </div>
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">关节</div>
                    <div className="font-medium">{msg.articraftResult.jointCount}</div>
                  </div>
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">状态</div>
                    <div className="font-medium">
                      {msg.articraftResult.status === 'imported' ? 'Imported' : 'Ready'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => openArticraftViewer(msg.articraftResult!.recordId)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:open-in-new" />
                    打开 Articraft Viewer
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={msg.articraftResult.status === 'imported'}
                    onClick={() => handleImportArticraftResult(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:import" />
                    导入当前场景
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading}
                    onClick={() => sendArticraftMessage(msg.articraftResult!.prompt)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:refresh" />
                    重新生成
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{msg.content}</div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 animate-spin" icon="mdi:loading" />
            {t('aiChat.thinking', '思考中...')}
          </div>
        )}
      </div>

      <div className="border-border/50 border-t px-3 py-2">
        <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <input
            checked={articulationMode}
            className="size-3 accent-[#a684ff]"
            onChange={(e) => setArticulationMode(e.target.checked)}
            type="checkbox"
          />
          <Icon className="size-3 shrink-0" icon="mdi:robot-industrial-outline" />
          {t('aiChat.articulationMode', '生成关节模型')}
        </label>
        <div className="flex items-end gap-1.5">
          <textarea
            className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-lg border border-border/60 bg-accent/30 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-[#a684ff]/50 focus:outline-none focus:ring-1 focus:ring-[#a684ff]/30"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiChat.inputPlaceholder', '描述你想要的物体...')}
            ref={inputRef}
            rows={1}
            value={input}
          />
          <button
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors',
              loading ? 'cursor-not-allowed opacity-50' : 'hover:border-[#a684ff]/50 hover:text-[#a684ff]',
            )}
            disabled={loading || !input.trim()}
            onClick={sendMessage}
            type="button"
          >
            <Icon className="size-4" icon="mdi:send" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AiChatPanel
