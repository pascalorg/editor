'use client'

import {
  BoxNode,
  CapsuleNode,
  CylinderNode,
  ExtrudeNode,
  HalfCylinderNode,
  LatheNode,
  RoundedPanelNode,
  SphereNode,
  SweepNode,
  composeObjectPrimitives,
  composeRobotArmPrimitives,
  resolvePrimitiveWorldTransforms,
  type AnyNode,
  type AnyNodeId,
  type ObjectComposeInput,
  type PrimitiveMaterialInput,
  type PrimitiveShapeInput,
  type RobotArmComposeInput,
  type Vec3,
  useScene,
} from '@pascal-app/core'
import { createModelNodes } from '@pascal-app/articraft-bridge/scene-converter'
import type { ArticraftJoint, ArticraftLink, ArticraftModelData } from '@pascal-app/articraft-bridge/types'
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
  depth?: number
  thickness?: number
  cornerRadius?: number
  cornerSegments?: number
  radius?: number
  axis?: string
  capSegments?: number
  radialSegments?: number
  tubularSegments?: number
  widthSegments?: number
  heightSegments?: number
  wallThickness?: number
  profile?: [number, number][]
  path?: Vec3[]
  segments?: number
  arc?: number
  bevelSize?: number
  bevelThickness?: number
  bevelSegments?: number
  curveSegments?: number
  closed?: boolean
  material?: PrimitiveMaterialInput
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
      'Create editable primitive shapes in the 3D scene. Choose the primitive that matches each surface type: boxes/panels, round extrusions, capsules, half-cylinders, lathes, extrusions, or swept tubes. Use attachTo/anchor/childAnchor for connected parts instead of hand-computing offsets.',
    parameters: {
      type: 'object',
      properties: {
        shapes: {
          type: 'array',
          description:
            'Shapes to create, ordered from parent to child. Child shapes use attachTo plus explicit anchor/childAnchor to reference and snap to an earlier shape index.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'box',
                  'cylinder',
                  'sphere',
                  'lathe',
                  'capsule',
                  'half-cylinder',
                  'rounded-panel',
                  'extrude',
                  'sweep',
                ],
                description:
                  'Primitive type. box=solid cuboid, rounded-panel=thin bevelled rounded rectangle, cylinder=circular extrusion, capsule=rounded-ended bar, half-cylinder=semicircular extrusion, sphere=ellipsoid/dome, lathe=revolved vertical profile, extrude=custom 2D profile with depth, sweep=tube along a 3D path.',
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
              width: { type: 'number', description: 'Box width/depth along local Z, in meters. If thinking in natural width/depth/height terms, use length for the left-right width and width for the front-back depth.' },
              height: { type: 'number', description: 'Box height along Y, or cylinder/capsule/half-cylinder length along its axis, in meters. Do not omit this for table legs or handles.' },
              depth: {
                type: 'number',
                description: 'Extrude depth along local Z, in meters. Also accepted as object depth for templates.',
              },
              thickness: {
                type: 'number',
                description: 'Rounded-panel thickness along local Y, in meters.',
              },
              radius: { type: 'number', description: 'Cylinder or sphere radius, in meters.' },
              axis: {
                type: 'string',
                enum: ['x', 'y', 'z'],
                description:
                  'Which direction the cylinder extends. "y"=vertical, "x"=left-right, "z"=front-back. In this editor, vehicle length usually runs along Z, so wheels should use axis="x" (axle side-to-side).',
              },
              radialSegments: {
                type: 'number',
                description:
                  'Round-part smoothness for cylinders, capsules, half-cylinders, and sweeps. Use 24-48 for visible mechanical parts.',
              },
              capSegments: {
                type: 'number',
                description: 'Capsule cap smoothness. Use 4-8 for low-poly soft rounded ends.',
              },
              tubularSegments: {
                type: 'number',
                description: 'Sweep path smoothness. Use 16-40 for curved cables/handles.',
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
              cornerRadius: {
                type: 'number',
                description:
                  'Box-only rounded corner radius in meters. Use 0.02-0.12 for manufactured plastic/metal housings, vehicle bodies, appliance shells, cabinets, and softened furniture. Use 0 for sharp construction blocks.',
              },
              cornerSegments: {
                type: 'number',
                description:
                  'Box-only rounded corner smoothness. Use 3-5 for normal low-poly rounded boxes, 6-8 for close-up smooth housings.',
              },
              profile: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description:
                  'For lathe and extrude shapes. Lathe: [radius,height] points revolved around Y, bottom-to-top. Extrude: closed [x,y] outline extruded through depth.',
              },
              path: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description:
                  'For sweep shapes only. Local 3D path as [[x,y,z],...]; node position is the center. Use for cables, hoses, rails, handles, bumper arcs.',
              },
              segments: {
                type: 'number',
                description: 'For lathe shapes only. Number of rotational segments (smoothness). Use 32-64 for visible curved surfaces. Default: 32.',
              },
              arc: {
                type: 'number',
                description: 'For lathe shapes only. Revolve angle in radians. Use 2*PI (≈6.283) for full revolution. Use smaller values for partial sweeps. Default: 6.283 (full circle).',
              },
              bevelSize: {
                type: 'number',
                description: 'Extrude bevel size in meters. Use 0.005-0.03 for softened real-world profiles.',
              },
              bevelThickness: {
                type: 'number',
                description: 'Extrude bevel thickness in meters.',
              },
              bevelSegments: {
                type: 'number',
                description: 'Extrude bevel smoothness. Use 1-4 for low-poly bevels.',
              },
              curveSegments: {
                type: 'number',
                description: 'Extrude curve smoothness for curved profile edges.',
              },
              closed: {
                type: 'boolean',
                description: 'Sweep only. true closes the tube path into a loop.',
              },
              material: {
                type: 'object',
                description:
                  'Optional material. Prefer {properties:{color:"#C4956A", roughness:0.6, metalness:0}}. Also accepted: {color:"#C4956A"} or {preset:"wood"}.',
              },
              materialPreset: { type: 'string', description: 'Optional material preset id.' },
              name: { type: 'string', description: 'Shape name.' },
              attachTo: {
                type: 'number',
                description:
                  '0-based parent shape index in the shapes array. Must reference a prior shape. Requires anchor and childAnchor. The child inherits parent rotation.',
              },
              anchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description:
                  'Parent connection point. Required when attachTo is used. Under a desktop uses anchor="bottom". On top of a base uses anchor="top".',
              },
              childAnchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description:
                  'Child connection point to align to the parent anchor. Required when attachTo is used. Use top when a drawer/cabinet hangs under a desktop bottom; use bottom for posts on top of a base; use back/front for face-mounted handles.',
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

const COMPOSE_OBJECT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_object',
    description:
      'Create a stable editable low-poly object from curated category templates. Prefer this for common whole-object requests such as vehicles, chairs, sofas, outdoor AC units, keyboards, monitors, tables, shelves, and cabinets; use compose_primitive for custom one-off geometry or unsupported categories.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional object name prefix.' },
        category: {
          type: 'string',
          enum: [
            'vehicle',
            'chair',
            'outdoor-ac',
            'sofa',
            'keyboard',
            'monitor',
            'table',
            'shelf',
            'cabinet',
            'generic',
          ],
          description:
            'Object category. Use vehicle for cars/Tesla, chair for chairs/stools, outdoor-ac for air conditioner outdoor units, sofa, keyboard, monitor, table, shelf, cabinet, or generic.',
        },
        model: {
          type: 'string',
          description: 'Requested model or product name, e.g. "Tesla Model Y" or "air conditioner outdoor unit".',
        },
        style: {
          type: 'string',
          description: 'Optional style hint such as crossover, office, wooden, modern, metal, etc.',
        },
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Ground origin [x, y, z] in meters. Defaults to scene origin.',
        },
        width: { type: 'number', description: 'Object width along X in meters.' },
        depth: { type: 'number', description: 'Object depth along Z in meters.' },
        length: { type: 'number', description: 'Alias for depth/vehicle length along Z in meters.' },
        height: { type: 'number', description: 'Object height along Y in meters.' },
        primaryColor: { type: 'string', description: 'CSS hex primary color, e.g. #f4f6f8.' },
        secondaryColor: { type: 'string', description: 'CSS hex secondary/accent color.' },
        bodyColor: { type: 'string', description: 'Vehicle/body color alias.' },
        glassColor: { type: 'string', description: 'Vehicle glass color alias.' },
        wheelColor: { type: 'string', description: 'Vehicle tire color alias.' },
        detail: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Round-part smoothness. Use medium by default; low for very abstract blockouts.',
        },
      },
      required: [],
    },
  },
}

type ComposeTool = typeof COMPOSE_OBJECT_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL | typeof COMPOSE_PRIMITIVE_TOOL
type RawShape = Omit<PrimitiveShapeInput, 'kind' | 'material'> & {
  kind?: string
  shape?: string
  type?: string
  params?: Record<string, unknown>
  size?: number[]
  color?: number[]
  material?: PrimitiveMaterialInput | Record<string, unknown> | string
  materialColor?: string
}

const BASE_RULES = `You are the 3D modeling assistant inside the Pascal editor. You work in 2 stages: analyze, generate.

Available tools:
- compose_object(...): Create stable editable low-poly whole objects from category templates. Prefer for common categories: vehicle/car/Tesla, chair/stool, sofa, outdoor AC unit, keyboard, monitor, table/desk, shelf/rack, cabinet.
- compose_primitive(shapes): Create custom box, rounded-panel, cylinder, capsule, half-cylinder, sphere, lathe, extrude, or sweep shapes for unsupported categories or user-specified individual parts.
- compose_robot_arm(...): Create robot arm drafts. Prefer for robot/cobot/FANUC/manipulator requests.

===== COORDINATE SYSTEM =====
+X = left/right width, +Y = up, +Z = depth/front-back. y=0 is the ground plane.
Position [x,y,z] is always the geometric center of the shape.
Rotation [rx,ry,rz] is Euler angles in radians.

===== PRIMITIVE CAPABILITIES =====
BOX = rectangular block with flat faces; set cornerRadius for rounded corners. Use sharp boxes for construction panels and rounded boxes for vehicle bodies, appliance shells, plastic/metal housings, cabinets, furniture, and softened manufactured parts.
CYLINDER = round bar/rod/disc. Use for wheels, fans, vents, pipes, table/chair legs.
CAPSULE = cylinder with hemispherical ends. Use for soft bolsters, sofa arms, pillows, rounded handles, rails, grips, and organic rounded bars.
HALF-CYLINDER = semicircular extrusion with one flat cut face. Use for fenders, arched covers, half pipes, rounded roof caps, and protective shells.
ROUNDED-PANEL = thin bevelled rounded rectangle. Use for screens, keycaps, cushions, control panels, appliance front plates, and device faces.
SPHERE = full ball/ellipsoid. Use sparingly for domes/canopies only; a scaled sphere is still a blob with rounded edges.
LATHE = vertical radial profile. Use for vases, bowls, lamps, bells, turned parts.
EXTRUDE = closed custom 2D profile with depth. Use for non-rectangular plates, handles, logos, brackets, silhouettes, and shaped vents.
SWEEP = circular tube along a 3D path. Use for cables, hoses, curved handles, rails, bumper arcs, and pipes with bends.

===== TEMPLATE-FIRST RULE =====
If the requested object matches a supported compose_object category, use compose_object instead of hand-building raw primitives:
- vehicle/car/Tesla/Model Y -> compose_object({category:"vehicle", model, style})
- chair/stool -> compose_object({category:"chair"})
- air conditioner outdoor unit / AC condenser / 空调外机 -> compose_object({category:"outdoor-ac"})
- sofa/couch/沙发 -> compose_object({category:"sofa"})
- keyboard/键盘 -> compose_object({category:"keyboard"})
- monitor/display/screen/显示器 -> compose_object({category:"monitor"})
- table/desk -> compose_object({category:"table"})
- shelf/rack -> compose_object({category:"shelf"})
- cabinet/cupboard -> compose_object({category:"cabinet"})
Use compose_object only when the template category satisfies the complete request. If the user asks for extra structural features not guaranteed by the template (drawers, doors, shelves, compartments, special handles, asymmetry, exact count of subparts), build the whole object with ONE compose_primitive call instead.

===== GEOMETRY RULES =====
- Build a recognizable silhouette first: main volume + 2-8 distinctive features.
- Field names are strict: box/rounded-panel use length=X left-right, width=Z front-back depth, height=Y vertical. If you think "width/depth/height", output length=width and width=depth. Never omit length for drawer faces, handles, desks, or panels.
- Cylinder/capsule/half-cylinder use height as the distance along axis. Table legs must include height, e.g. cylinder axis="y", radius=0.025, height=0.7.
- Materials are strict: use material:{properties:{color:"#C4956A", roughness:0.6, metalness:0}} or materialPreset:"wood". For wood-colored objects, set the material on every visible wood part, not only in analysis text.
- Output exactly ONE geometry tool call for the final object. Do not call compose_object and then compose_primitive to add details.
- attachTo indexes are local to the shapes array inside the same compose_primitive call only. Parent must appear before child. Never reference shapes from a previous tool call.
- Never set attachTo by itself. If a part must be under/on/front/back/side of another part, include explicit anchors: under desktop -> attachTo desktop, anchor="bottom", childAnchor="top"; on top -> anchor="top", childAnchor="bottom"; front face handle -> anchor="front", childAnchor="back". If you already computed an absolute world position and do not need snapping, omit attachTo.
- Support stack rule: lower support's top connects to upper part's bottom. Example: a seat on legs uses parent leg anchor="top", childAnchor="bottom"; a hanging drawer under a desktop uses parent desktop anchor="bottom", childAnchor="top".
- Use cornerRadius on boxes that should not read like sharp shipping containers: cars, appliances, electronics, molded furniture, machine housings.
- Do not default to sphere. Sphere is not a curved panel; it becomes a blob if too tall or too large.
- For broad curved rectangular surfaces, prefer a rounded box for the main mass plus a shallow sphere/ellipsoid only for domes or glass canopies.
- For cylinders, use axis ("x"/"y"/"z") rather than manual rotation.
- Vehicle length runs along Z; wheels use axis="x" and no manual rotation.
- Chair/table legs are vertical cylinders with axis="y".
- Outdoor AC units: rectangular case, dark front grille panel, circular fan grille, vent slats, base feet.
- Sofas: rounded cushions, capsule arms/bolsters, recessed shadow base.
- Keyboards: bevelled base tray, repeated rounded-panel keycaps, long spacebar, optional sweep cable.
- Monitors: rounded screen/bezel panels, capsule stand, bevelled foot, optional sweep cable.
- LIMIT: 4-16 parts max. Skip anything <15cm. Prefer stable low-poly abstraction over tiny details.
`

const STAGE1_ANALYST = `${BASE_RULES}

===== STAGE 1: ANALYZE =====
Analyze the user's request and produce a structured decomposition plan. Output TEXT ONLY. Do NOT call any tools.

First decide whether the request matches a compose_object category. If yes, say the chosen category and key visual traits.
If the request includes extra structural features beyond the template category, choose compose_primitive instead and decompose the whole object yourself.
If not, decompose into primitives. For each part specify:
1. Name
2. Primitive kind (box/rounded-panel/cylinder/capsule/half-cylinder/sphere/lathe/extrude/sweep)
3. Key dimensions in meters; for box or panel parts, whether they need cornerRadius/bevel and why
4. World-space position [x, y, z]
5. Why this primitive matches the surface
`

const STAGE2_GENERATOR = `${BASE_RULES}

===== STAGE 2: GENERATE =====
Based on the analysis, call compose_object, compose_robot_arm, or compose_primitive to create the geometry.

- For common whole objects (vehicle/car/Tesla, chair, sofa, outdoor AC unit, keyboard, monitor, table, shelf, cabinet), call compose_object once only when the template fully covers the request.
- If the user requested extra structural features or exact subpart counts, do not mix tools; call compose_primitive once with the complete object.
- For robot arms, call compose_robot_arm once.
- Otherwise call compose_primitive once with all shapes. Parent before child.
- For cylinders, use axis instead of manual rotation.
- Every box/rounded-panel must include length, width, and height/thickness explicitly. Every cylinder/capsule/half-cylinder must include radius and height explicitly.
- For box housings and bodies, include cornerRadius/cornerSegments when the real object has rounded manufactured edges.
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
  recordPath: string
  name: string
  partCount: number
  jointCount: number
  links: ArticraftLink[]
  joints: ArticraftJoint[]
  data: ArticraftModelData
}

const ARTICRAFT_PROGRESS_LINE_LIMIT = 12

function formatArticraftProgressMessage(header: string, lines: string[]) {
  const visibleLines = lines.map((line) => line.trim()).filter(Boolean).slice(-ARTICRAFT_PROGRESS_LINE_LIMIT)
  if (visibleLines.length === 0) return header
  return `${header}\n\n${visibleLines.map((line) => `• ${line}`).join('\n')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MATERIAL_PRESETS = new Set([
  'white',
  'brick',
  'concrete',
  'wood',
  'glass',
  'metal',
  'plaster',
  'tile',
  'marble',
  'custom',
])

const PRIMITIVE_ANCHORS = new Set(['top', 'bottom', 'center', 'front', 'back', 'left', 'right'])

function colorArrayToHex(color: number[]): string {
  return `#${color.slice(0, 3).map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255).toString(16).padStart(2, '0')).join('')}`
}

function normalizePrimitiveMaterial(
  rawMaterial: unknown,
  materialColor: unknown,
  color: number[] | undefined,
): PrimitiveMaterialInput | undefined {
  if (typeof rawMaterial === 'string') {
    if (/^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(rawMaterial)) return { properties: { color: rawMaterial } }
    if (MATERIAL_PRESETS.has(rawMaterial)) return { preset: rawMaterial }
  }

  if (isRecord(rawMaterial)) {
    const rawProperties = isRecord(rawMaterial.properties) ? rawMaterial.properties : {}
    const rawColor = rawMaterial.color ?? rawProperties.color
    const rawRoughness = rawMaterial.roughness ?? rawProperties.roughness
    const rawMetalness = rawMaterial.metalness ?? rawProperties.metalness
    const rawOpacity = rawMaterial.opacity ?? rawProperties.opacity
    const rawTransparent = rawMaterial.transparent ?? rawProperties.transparent
    const rawSide = rawMaterial.side ?? rawProperties.side
    const properties: NonNullable<PrimitiveMaterialInput['properties']> = {}

    if (typeof rawColor === 'string') properties.color = rawColor
    if (typeof rawRoughness === 'number' && Number.isFinite(rawRoughness)) {
      properties.roughness = Math.max(0, Math.min(1, rawRoughness))
    }
    if (typeof rawMetalness === 'number' && Number.isFinite(rawMetalness)) {
      properties.metalness = Math.max(0, Math.min(1, rawMetalness))
    }
    if (typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)) {
      properties.opacity = Math.max(0, Math.min(1, rawOpacity))
    }
    if (typeof rawTransparent === 'boolean') properties.transparent = rawTransparent
    if (rawSide === 'front' || rawSide === 'back' || rawSide === 'double') properties.side = rawSide

    const material: PrimitiveMaterialInput = {}
    if (typeof rawMaterial.id === 'string') material.id = rawMaterial.id
    if (typeof rawMaterial.preset === 'string' && MATERIAL_PRESETS.has(rawMaterial.preset)) {
      material.preset = rawMaterial.preset
    }
    if (Object.keys(properties).length > 0) material.properties = properties
    if (material.id || material.preset || material.properties) return material
  }

  if (typeof materialColor === 'string') return { properties: { color: materialColor } }
  if (color?.length) {
    return {
      properties: {
        color: colorArrayToHex(color),
        opacity: typeof color[3] === 'number' ? color[3] : 1,
        transparent: typeof color[3] === 'number' ? color[3] < 1 : false,
      },
    }
  }

  return undefined
}

function isPrimitiveAnchor(value: unknown): value is string {
  return typeof value === 'string' && PRIMITIVE_ANCHORS.has(value)
}

function getExpectedAttachmentSide(
  anchor: string,
  childAnchor: string,
): { axis: 0 | 1 | 2; sign: -1 | 1; label: string } | undefined {
  if (anchor === 'top' && childAnchor === 'bottom') return { axis: 1, sign: 1, label: 'above the parent' }
  if (anchor === 'bottom' && childAnchor === 'top') return { axis: 1, sign: -1, label: 'below the parent' }
  if (anchor === 'right' && childAnchor === 'left') return { axis: 0, sign: 1, label: 'right of the parent' }
  if (anchor === 'left' && childAnchor === 'right') return { axis: 0, sign: -1, label: 'left of the parent' }
  if (anchor === 'front' && childAnchor === 'back') return { axis: 2, sign: 1, label: 'in front of the parent' }
  if (anchor === 'back' && childAnchor === 'front') return { axis: 2, sign: -1, label: 'behind the parent' }
  return undefined
}

function getArticraftMetadata(result: ArticraftResult, nodeName: string) {
  const linkName = nodeName.replace(/_v\d+$/, '')
  const joint = result.joints.find((candidate) => candidate.child === linkName)
  return {
    recordId: result.recordId,
    recordPath: result.recordPath,
    jointName: joint?.name ?? null,
    parentLink: joint?.parent ?? null,
    childLink: joint?.child ?? linkName,
  }
}

type BridgeJointMetadata = ReturnType<typeof createModelNodes>['jointMetadata'][string]

function toSceneJointMetadata(jointMetadata: BridgeJointMetadata) {
  return {
    jointName: jointMetadata.jointName,
    jointType: jointMetadata.jointType,
    parentLink: jointMetadata.parentLink,
    childLink: jointMetadata.childLink,
    axis: jointMetadata.axis,
    origin: jointMetadata.origin,
    ...(jointMetadata.limits ? { limits: jointMetadata.limits } : {}),
    ...(jointMetadata.mimic ? { mimic: jointMetadata.mimic } : {}),
    currentValue: jointMetadata.currentValue,
  }
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
    console.log(`[AI-Chat] executeToolCall: ${name}`)
    console.log('[AI-Chat] raw args:', JSON.stringify(args, null, 2).slice(0, 4000))

    if (name !== 'compose_primitive' && name !== 'compose_robot_arm' && name !== 'compose_object') {
      return t('aiChat.unknownTool', { fallback: 'Unknown tool: {name}', params: { name } })
    }

    const rawShapes: RawShape[] | undefined =
      name === 'compose_robot_arm'
        ? composeRobotArmPrimitives(args as RobotArmComposeInput)
        : name === 'compose_object'
          ? composeObjectPrimitives(args as ObjectComposeInput)
          : (args.shapes as RawShape[] | undefined)
    if (!rawShapes?.length) return t('aiChat.noShapes', 'No geometry to create.')

    const shapes: ShapeSpec[] = rawShapes.map((shape) => {
      const shapeRecord = shape as Record<string, unknown>
      const params = isRecord(shapeRecord.params) ? shapeRecord.params : {}
      const read = (key: string) => shapeRecord[key] ?? params[key]
      const size = Array.isArray(read('size')) ? read('size') as number[] : undefined
      const color = Array.isArray(read('color')) ? read('color') as number[] : undefined
      const material = normalizePrimitiveMaterial(read('material'), read('materialColor'), color)

      const kind = (read('kind') ?? read('shape') ?? read('type')) as string
      const isBoxLike = kind === 'box' || kind === 'rounded-panel'
      const isAxisLengthPrimitive =
        kind === 'cylinder' || kind === 'capsule' || kind === 'half-cylinder'
      const rawLength = read('length')
      const rawWidth = read('width')
      const rawHeight = read('height')
      const rawDepth = read('depth')
      const rawThickness = read('thickness')
      const naturalWidthDepth = isBoxLike && rawLength == null && rawWidth != null && rawDepth != null
      const normalizedLength = rawLength ?? (naturalWidthDepth ? rawWidth : undefined) ?? size?.[0]
      const normalizedWidth =
        (isBoxLike ? rawDepth : undefined) ?? rawWidth ?? (isBoxLike ? size?.[2] : undefined)
      const normalizedHeight = isAxisLengthPrimitive
        ? (rawHeight ?? rawLength ?? size?.[1])
        : (rawHeight ?? size?.[1])
      const normalizedThickness =
        kind === 'rounded-panel' ? (rawThickness ?? rawHeight ?? size?.[1]) : rawThickness
      const normalizedDepth =
        kind === 'extrude' ? (rawDepth ?? rawWidth ?? size?.[2]) : rawDepth

      return {
        kind,
        position: (read('position') as Vec3) ?? [0, 0, 0],
        rotation: (read('rotation') as Vec3) ?? [0, 0, 0],
        scale: (read('scale') as Vec3) ?? [1, 1, 1],
        name: read('name') as string | undefined,
        length: normalizedLength as number | undefined,
        width: normalizedWidth as number | undefined,
        height: normalizedHeight as number | undefined,
        depth: normalizedDepth as number | undefined,
        thickness: normalizedThickness as number | undefined,
        cornerRadius: read('cornerRadius') as number | undefined,
        cornerSegments: read('cornerSegments') as number | undefined,
        radius: read('radius') as number | undefined,
        axis: read('axis') as string | undefined,
        capSegments: read('capSegments') as number | undefined,
        radialSegments: read('radialSegments') as number | undefined,
        tubularSegments: read('tubularSegments') as number | undefined,
        widthSegments: read('widthSegments') as number | undefined,
        heightSegments: read('heightSegments') as number | undefined,
        wallThickness: read('wallThickness') as number | undefined,
        profile: read('profile') as [number, number][] | undefined,
        path: read('path') as Vec3[] | undefined,
        segments: read('segments') as number | undefined,
        arc: read('arc') as number | undefined,
        bevelSize: read('bevelSize') as number | undefined,
        bevelThickness: read('bevelThickness') as number | undefined,
        bevelSegments: read('bevelSegments') as number | undefined,
        curveSegments: read('curveSegments') as number | undefined,
        closed: read('closed') as boolean | undefined,
        material,
        materialPreset: read('materialPreset') as string | undefined,
        attachTo: read('attachTo') as number | undefined,
        anchor: read('anchor') as string | undefined,
        childAnchor: read('childAnchor') as string | undefined,
      }
    })

    const isPositiveNumber = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
    const validationIssues = shapes.flatMap((shape, index) => {
      const label = shape.name ?? `${shape.kind} #${index + 1}`
      const issues: string[] = []
      if (shape.attachTo != null && (!Number.isInteger(shape.attachTo) || shape.attachTo < 0 || shape.attachTo >= index)) {
        issues.push(
          `${label}: attachTo must reference an earlier shape in the SAME compose_primitive call; got ${shape.attachTo}.`,
        )
      }
      if (shape.attachTo != null && (!isPrimitiveAnchor(shape.anchor) || !isPrimitiveAnchor(shape.childAnchor))) {
        issues.push(
          `${label}: attachTo requires explicit anchor and childAnchor. Examples: under desktop uses anchor="bottom", childAnchor="top"; front handle uses anchor="front", childAnchor="back".`,
        )
      }
      if (shape.attachTo != null && isPrimitiveAnchor(shape.anchor) && isPrimitiveAnchor(shape.childAnchor)) {
        const parent = shapes[shape.attachTo]
        const expectedSide = getExpectedAttachmentSide(shape.anchor, shape.childAnchor)
        if (parent && expectedSide) {
          const delta = shape.position[expectedSide.axis] - parent.position[expectedSide.axis]
          if (Number.isFinite(delta) && Math.abs(delta) > 0.02 && delta * expectedSide.sign < -0.02) {
            issues.push(
              `${label}: anchor="${shape.anchor}" and childAnchor="${shape.childAnchor}" place the child ${expectedSide.label}, but its world-center position is on the opposite side of "${parent.name ?? parent.kind}". Reverse the anchors or remove attachTo.`,
            )
          }
        }
      }

      switch (shape.kind) {
        case 'box':
          if (!isPositiveNumber(shape.length)) issues.push(`${label}: box.length is required (X left-right).`)
          if (!isPositiveNumber(shape.width)) issues.push(`${label}: box.width is required (Z front-back depth).`)
          if (!isPositiveNumber(shape.height)) issues.push(`${label}: box.height is required (Y vertical).`)
          break
        case 'rounded-panel':
          if (!isPositiveNumber(shape.length)) issues.push(`${label}: rounded-panel.length is required (X left-right).`)
          if (!isPositiveNumber(shape.width)) issues.push(`${label}: rounded-panel.width is required (Z front-back depth).`)
          if (!isPositiveNumber(shape.thickness)) issues.push(`${label}: rounded-panel.thickness is required (Y thickness).`)
          break
        case 'cylinder':
        case 'capsule':
        case 'half-cylinder':
          if (!isPositiveNumber(shape.radius)) issues.push(`${label}: ${shape.kind}.radius is required.`)
          if (!isPositiveNumber(shape.height)) issues.push(`${label}: ${shape.kind}.height is required along axis.`)
          break
        case 'sphere':
          if (!isPositiveNumber(shape.radius)) issues.push(`${label}: sphere.radius is required.`)
          break
        case 'lathe':
          if (!Array.isArray(shape.profile) || shape.profile.length < 2) {
            issues.push(`${label}: lathe.profile needs at least 2 [radius,height] points.`)
          }
          break
        case 'extrude':
          if (!Array.isArray(shape.profile) || shape.profile.length < 3) {
            issues.push(`${label}: extrude.profile needs at least 3 closed outline points.`)
          }
          if (!isPositiveNumber(shape.depth)) issues.push(`${label}: extrude.depth is required.`)
          break
        case 'sweep':
          if (!Array.isArray(shape.path) || shape.path.length < 2) {
            issues.push(`${label}: sweep.path needs at least 2 [x,y,z] points.`)
          }
          if (!isPositiveNumber(shape.radius)) issues.push(`${label}: sweep.radius is required.`)
          break
        default:
          issues.push(`${label}: unsupported kind "${shape.kind}".`)
      }
      return issues
    })

    if (validationIssues.length > 0) {
      return [
        'Invalid geometry tool call. Nothing was created.',
        'Fix the arguments and call exactly one geometry tool again.',
        ...validationIssues.map((issue) => `- ${issue}`),
      ].join('\n')
    }

    const transforms = resolvePrimitiveWorldTransforms(shapes as PrimitiveShapeInput[], { positionMode: 'world-center' })
    const levelId = useViewer.getState().selection.levelId
    const scene = useScene.getState()
    const created: string[] = []

    const clampD = (v: unknown, fallback: number, min = 0.01, max = 50) =>
      Math.max(min, Math.min(max, typeof v === 'number' && !Number.isNaN(v) ? v : fallback))
    const clampR = (v: unknown, fallback: number) => clampD(v, fallback, 0.01, 10)
    const clampI = (v: unknown, fallback: number, min: number, max: number) =>
      Math.round(clampD(v, fallback, min, max))
    const clampCornerRadius = (shape: ShapeSpec) => {
      if (shape.cornerRadius == null) return undefined
      const length = clampD(shape.length, 1.0)
      const width = clampD(shape.width, 1.0)
      const height = clampD(shape.height, 1.0)
      return clampD(shape.cornerRadius, 0, 0, Math.max(0, Math.min(length, width, height) / 2 - 0.001))
    }
    const clampPanelCornerRadius = (shape: ShapeSpec) => {
      if (shape.cornerRadius == null) return undefined
      const length = clampD(shape.length, 1.0)
      const width = clampD(shape.width, 0.5)
      const thickness = clampD(shape.thickness ?? shape.height, 0.04, 0.005, 2)
      return clampD(
        shape.cornerRadius,
        0.04,
        0,
        Math.max(0, Math.min(length, width, thickness) / 2 - 0.001),
      )
    }

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
              cornerRadius: clampCornerRadius(shape),
              cornerSegments:
                shape.cornerSegments != null ? Math.round(clampD(shape.cornerSegments, 4, 1, 12)) : undefined,
              material: shape.material,
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
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
          }
          case 'capsule':
            node = CapsuleNode.parse({
              name: displayName,
              position,
              rotation,
              radius: clampR(shape.radius, 0.25),
              height: clampD(shape.height, 1.0, 0.02, 20),
              capSegments: shape.capSegments != null ? clampI(shape.capSegments, 6, 1, 16) : undefined,
              radialSegments:
                shape.radialSegments != null ? clampI(shape.radialSegments, 32, 8, 64) : undefined,
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
          case 'half-cylinder':
            node = HalfCylinderNode.parse({
              name: displayName,
              position,
              rotation,
              radius: clampR(shape.radius, 0.5),
              height: clampD(shape.height, 1.0, 0.01, 20),
              radialSegments:
                shape.radialSegments != null ? clampI(shape.radialSegments, 24, 8, 64) : undefined,
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
          case 'rounded-panel':
            node = RoundedPanelNode.parse({
              name: displayName,
              position,
              rotation,
              length: clampD(shape.length, 1.0, 0.01, 20),
              width: clampD(shape.width, 0.5, 0.01, 20),
              thickness: clampD(shape.thickness ?? shape.height, 0.04, 0.005, 2),
              cornerRadius: clampPanelCornerRadius(shape),
              cornerSegments:
                shape.cornerSegments != null ? clampI(shape.cornerSegments, 4, 1, 12) : undefined,
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
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
              material: shape.material,
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
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
          case 'extrude':
            node = ExtrudeNode.parse({
              name: displayName,
              position,
              rotation,
              profile: shape.profile as [number, number][] | undefined,
              depth: clampD(shape.depth ?? shape.width, 0.1, 0.005, 10),
              bevelSize:
                shape.bevelSize != null ? clampD(shape.bevelSize, 0.01, 0, 1) : undefined,
              bevelThickness:
                shape.bevelThickness != null
                  ? clampD(shape.bevelThickness, shape.bevelSize ?? 0.01, 0, 1)
                  : undefined,
              bevelSegments:
                shape.bevelSegments != null ? clampI(shape.bevelSegments, 2, 0, 12) : undefined,
              curveSegments:
                shape.curveSegments != null ? clampI(shape.curveSegments, 8, 1, 32) : undefined,
              material: shape.material,
              materialPreset: shape.materialPreset,
            })
            break
          case 'sweep':
            node = SweepNode.parse({
              name: displayName,
              position,
              rotation,
              path: shape.path,
              radius: clampD(shape.radius, 0.03, 0.005, 2),
              tubularSegments:
                shape.tubularSegments != null ? clampI(shape.tubularSegments, 24, 2, 128) : undefined,
              radialSegments:
                shape.radialSegments != null ? clampI(shape.radialSegments, 12, 3, 32) : undefined,
              closed: shape.closed,
              material: shape.material,
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

    const shapeDetails = shapes.map((s) => {
      const parts: string[] = [`  - ${s.name ?? s.kind}: ${s.kind}`]
      parts.push(`pos=[${(s.position as Vec3).join(',')}]`)
      if (s.kind === 'box') parts.push(`${s.length}x${s.width}x${s.height}, corner=${s.cornerRadius ?? 0}`)
      if (s.kind === 'rounded-panel') parts.push(`${s.length}x${s.width}x${s.thickness}, corner=${s.cornerRadius ?? 0}`)
      if (s.kind === 'cylinder') parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      if (s.kind === 'capsule' || s.kind === 'half-cylinder') {
        parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      }
      if (s.kind === 'sphere') parts.push(`r=${s.radius}, scale=[${(s.scale as Vec3).join(',')}]${s.rotation && (s.rotation as Vec3).some(v => v !== 0) ? `, rot=[${(s.rotation as Vec3).join(',')}]` : ''}`)
      if (s.kind === 'lathe') parts.push(`profile=${s.profile?.length ?? 0}pts, seg=${s.segments}`)
      if (s.kind === 'extrude') parts.push(`profile=${s.profile?.length ?? 0}pts, depth=${s.depth}`)
      if (s.kind === 'sweep') parts.push(`path=${s.path?.length ?? 0}pts, r=${s.radius}`)
      if (s.material?.properties?.color) parts.push(`color=${s.material.properties.color}`)
      else if (s.material?.preset) parts.push(`material=${s.material.preset}`)
      else if (s.materialPreset) parts.push(`material=${s.materialPreset}`)
      if (s.attachTo != null) parts.push(`attachTo=${s.attachTo} ${s.anchor}->${s.childAnchor}`)
      return parts.join(' ')
    }).join('\n')

    return `Created ${created.length} shapes:\n${shapeDetails}\nNames: ${created.join(', ')}`
  }, [])

  const callApi = useCallback(
    async (
      apiMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown }>,
      tools?: ComposeTool[],
    ) => {
      const hasTools = tools && tools.length > 0
      const systemMsg = apiMessages.find(m => m.role === 'system')
      const stageTag = systemMsg?.content?.includes('STAGE 1') ? 'Stage1-Analyst' :
        systemMsg?.content?.includes('STAGE 2') ? 'Stage2-Generator' : 'API'
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
    const levelId = useViewer.getState().selection.levelId
    const scene = useScene.getState()

    const created = createModelNodes(
      result.data,
      (node, parentId) => {
        scene.createNode(node, parentId)
        return node.id as AnyNodeId
      },
      {
        articulationMode,
        parentId: levelId ?? undefined,
      },
    )

    const metadataUpdates = created.nodeIds.flatMap((id) => {
      const node = useScene.getState().nodes[id as AnyNodeId]
      if (!node) return []

      const existingMetadata = isRecord(node.metadata) ? node.metadata : {}
      const jointMetadata = created.jointMetadata[id]
      const articraftMetadata = jointMetadata
        ? {
            recordId: result.recordId,
            recordPath: result.recordPath,
            jointName: jointMetadata.jointName,
            parentLink: jointMetadata.parentLink,
            childLink: jointMetadata.childLink,
          }
        : getArticraftMetadata(result, node.name ?? id)

      return [
        {
          id: id as AnyNodeId,
          data: {
            metadata: {
              ...existingMetadata,
              articraft: articraftMetadata,
              ...(jointMetadata ? { articraftJoint: toSceneJointMetadata(jointMetadata) } : {}),
            },
          } as unknown as Partial<AnyNode>,
        },
      ]
    })

    if (metadataUpdates.length > 0) {
      useScene.getState().updateNodes(metadataUpdates)
    }

    const selectedRootId = created.rootNodeIds[0] ?? created.nodeIds[0]
    if (selectedRootId) {
      useViewer.getState().setSelection({ selectedIds: [selectedRootId] })
    }

    return created.nodeIds.length
  }, [articulationMode])

  const getArticraftViewerUrl = useCallback((recordId: string, tab = 'inspect') => {
    const base = articraftViewerUrl.replace(/\/$/, '')
    return `${base}/viewer?record=${encodeURIComponent(recordId)}&tab=${encodeURIComponent(tab)}`
  }, [articraftViewerUrl])

  const openArticraftViewer = useCallback((recordId: string, tab?: string) => {
    window.open(getArticraftViewerUrl(recordId, tab), '_blank', 'noopener,noreferrer')
  }, [getArticraftViewerUrl])

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
    const progressHeader = t('aiChat.articraftGenerating', 'Generating with Articraft...')
    const progressLines: string[] = []
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: progressHeader,
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
              const message = String(event.message ?? '').trim()
              if (message) {
                progressLines.push(message)
                if (progressLines.length > ARTICRAFT_PROGRESS_LINE_LIMIT) {
                  progressLines.splice(0, progressLines.length - ARTICRAFT_PROGRESS_LINE_LIMIT)
                }
              }
              setMessages((prev) => {
                const updated = [...prev]
                const lastIdx = updated.length - 1
                if (lastIdx >= 0 && updated[lastIdx]?.role === 'assistant' && !updated[lastIdx]?.isToolResult) {
                  updated[lastIdx] = {
                    ...updated[lastIdx]!,
                    content: formatArticraftProgressMessage(progressHeader, progressLines),
                  }
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
        recordPath: String(resultData.recordPath ?? ''),
        name: String(resultData.name ?? resultData.recordId ?? 'Articraft asset'),
        partCount: resultLinks.length,
        jointCount: resultJoints.length,
        links: resultLinks as unknown as ArticraftLink[],
        joints: resultJoints as unknown as ArticraftJoint[],
        data: resultData as unknown as ArticraftModelData,
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
      tools: ComposeTool[],
      label: string,
    ): Promise<{ results: string[]; lastContent: string }> => {
      const allResults: string[] = []
      let currentResponse = response
      let lastContent = response.content ?? ''
      let round = 0

      while (currentResponse.tool_calls?.length && round < 3) {
        round += 1
        const toolResultApiMsgs: Array<{ role: string; tool_call_id: string; content: string }> = []
        const geometryToolCalls = currentResponse.tool_calls.filter((tc) =>
          tc.function.name === 'compose_primitive' ||
          tc.function.name === 'compose_object' ||
          tc.function.name === 'compose_robot_arm'
        )

        if (geometryToolCalls.length > 1) {
          for (const tc of currentResponse.tool_calls) {
            const result = [
              'Invalid generation plan. Nothing was created.',
              'Call exactly ONE geometry tool for the complete object.',
              'Do not split one object across compose_object + compose_primitive, because attachTo indexes are local to a single tool call.',
            ].join('\n')
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
            allResults.push(result)
          }
        } else {
          for (const tc of currentResponse.tool_calls) {
            const result = executeToolCall(tc.function.name, JSON.parse(tc.function.arguments))
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
            allResults.push(result)
          }
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

        if (toolResultApiMsgs.some((msg) => msg.content.startsWith('Created '))) {
          break
        }

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
          content: `User request: ${text}\n\nAnalysis:\n${analysis}\n\nNow call the best available tool based on this analysis. Prefer compose_object for supported whole-object categories, compose_robot_arm for robot arms, otherwise compose_primitive. Output the complete object in one tool call.`,
        },
      ]

      const generationTools: ComposeTool[] = [COMPOSE_OBJECT_TOOL, COMPOSE_ROBOT_ARM_TOOL, COMPOSE_PRIMITIVE_TOOL]
      const genResponse = await callApi(genMessages, generationTools)
      const genResult = await processToolCalls(genResponse, genMessages, generationTools, 'Generate')

      // If no tool calls were made, show the text response
      if (genResult.results.length === 0) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `**🔧 Generate:**\n${genResult.lastContent || '(no output)'}` }
          return updated
        })
      }

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
                    {msg.articraftResult.recordPath ? (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={msg.articraftResult.recordPath}>
                        path: {msg.articraftResult.recordPath}
                      </div>
                    ) : null}
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
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => openArticraftViewer(msg.articraftResult!.recordId, 'code')}
                    title={msg.articraftResult.recordPath || undefined}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:file-document-outline" />
                    查看源记录
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
