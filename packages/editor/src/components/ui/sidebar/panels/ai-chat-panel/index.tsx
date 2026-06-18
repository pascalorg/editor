'use client'

import {
  type AnyNode,
  type AssetInput,
  type AnyNodeId,
  ItemNode,
  type Vec3,
  useScene,
} from '@pascal-app/core'
import { createModelNodes } from '@pascal-app/articraft-bridge/scene-converter'
import type { ArticraftJoint, ArticraftLink, ArticraftModelData } from '@pascal-app/articraft-bridge/types'
import {
  executeGeometryToolCall,
  type GeometryToolExecutionResult,
} from '../../../../../lib/ai-geometry-tool-executor'
import {
  buildGeometryAnalysisContext,
  buildGeometryHarnessContext,
  buildPrimitiveRepairStopMessage,
  latestGeneratedGeometryArtifact,
  type GeometryContextDecision,
} from '../../../../../lib/ai-chat-harness'
import {
  clampD,
  clampR,
  placeGeneratedGeometryArtifact,
  replaceGeneratedGeometryArtifactOnCanvas,
  saveGeneratedGeometryArtifactToLocalLibrary,
  toAssemblyLocalPosition,
  type GeneratedGeometryArtifact,
  type GeneratedGeometryShapeSpec as ShapeSpec,
} from '../../../../../lib/ai-generated-geometry'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { t } from '../../../../../i18n'
import {
  applyArticraftJointValue,
  parseArticraftPose,
  type ArticraftJointMetadata,
} from '../../../../../lib/articraft-joints'
import { cn } from '../../../../../lib/utils'
import useEditor from '../../../../../store/use-editor'

const GEOMETRY_BRIEF_SCHEMA = {
  type: 'object',
  description:
    'Internal geometry brief distilled from the analysis. Declare object family, dimensions, required semantic roles, validation targets, and assumptions. Do not show this JSON to the user.',
  properties: {
    category: {
      type: 'string',
      description:
        'Semantic family such as vehicle, bicycle, fan, pump, conveyor, desk, electrical, pipe_system, or generic.',
    },
    units: { type: 'string', description: 'Use "m" for meters.' },
    coordinateConvention: {
      type: 'string',
      description: 'Coordinate convention, e.g. +X length/front-back, +Y up, +Z width.',
    },
    expectedDimensions: {
      type: 'object',
      properties: {
        length: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
    requiredRoles: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Required semantic roles used by validation. Use roles, not part kinds: for bicycles use bicycle_tire, bicycle_frame, bicycle_fork, handlebar, saddle, chain_loop; for cars use vehicle_body, vehicle_tire, vehicle_window, headlight, front_bumper, rear_bumper.',
    },
    semanticRoles: {
      type: 'array',
      items: { type: 'string' },
      description: 'Compatibility alias for requiredRoles. Prefer requiredRoles in new calls.',
    },
    validationTargets: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Concrete geometry checks to satisfy, e.g. exactly 4 tires, windows above body, red body material.',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only meaningful inferred choices, not generic filler.',
    },
  },
}

const COMPOSE_PRIMITIVE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_primitive',
    description:
      'Create editable primitive shapes in the 3D scene. Choose the primitive that matches each surface type: boxes/panels, cylinders/tubes, cones/frustums, hemispheres, torus rings, wedges/trapezoids, capsules, half-cylinders, lathes, extrusions, swept tubes, repeated arrays, or beveled extrusions with holes. Use attachTo/anchor/childAnchor for connected parts instead of hand-computing offsets.',
    parameters: {
      type: 'object',
      properties: {
        geometryBrief: GEOMETRY_BRIEF_SCHEMA,
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
                  'hollow-cylinder',
                  'cone',
                  'frustum',
                  'hemisphere',
                  'torus',
                  'wedge',
                  'trapezoid-prism',
                  'sphere',
                  'lathe',
                  'capsule',
                  'half-cylinder',
                  'rounded-panel',
                  'ellipsoid',
                  'ellipse-panel',
                  'semi-ellipse-panel',
                  'pyramid',
                  'extrude',
                  'sweep',
                ],
                description:
                  'Primitive type. box=solid cuboid, rounded-panel=thin bevelled rounded rectangle, cylinder=solid circular extrusion, hollow-cylinder=tube/pipe, cone=pointed circular cone, frustum=truncated cone/circular taper, hemisphere=closed dome, torus=ring/donut tube, wedge=sloped triangular prism, trapezoid-prism=tapered rectangular prism, capsule=rounded-ended bar, half-cylinder=semicircular extrusion, sphere/ellipsoid=scaled round body, ellipse-panel/semi-ellipse-panel=thin oval profiles, pyramid=square pyramid, lathe=revolved vertical profile, extrude=custom 2D profile with depth, sweep=tube along a 3D path.',
              },
              position: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'World-space geometric center [x, y, z] in meters. Always use the absolute world position, even for attached shapes; the system auto-aligns via anchor/childAnchor.',
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
                  'Non-uniform scale [sx, sy, sz] for spheres/hemispheres to create ellipsoids or flattened domes. [2, 0.3, 1] makes a wide flat dome. [1, 2, 1] makes an elongated egg/dome. Defaults to [1, 1, 1].',
              },
              length: { type: 'number', description: 'Box length along local X, in meters.' },
              width: { type: 'number', description: 'Box width/depth along local Z, in meters. If thinking in natural width/depth/height terms, use length for the left-right width and width for the front-back depth.' },
              height: { type: 'number', description: 'Box/wedge/trapezoid height along Y, or cylinder/hollow-cylinder/cone/frustum/capsule/half-cylinder length along its axis, in meters. Do not omit this for table legs, cones, handles, or tapered parts.' },
              depth: {
                type: 'number',
                description: 'Extrude depth along local Z, in meters. Also accepted as object depth for templates.',
              },
              thickness: {
                type: 'number',
                description: 'Rounded-panel thickness along local Y, in meters.',
              },
              radius: { type: 'number', description: 'Cylinder/cone/sphere/hemisphere/capsule/torus fallback radius, in meters.' },
              radiusTop: { type: 'number', description: 'Frustum top radius, in meters.' },
              radiusBottom: { type: 'number', description: 'Frustum bottom radius, in meters.' },
              majorRadius: { type: 'number', description: 'Torus centerline radius, in meters.' },
              tubeRadius: { type: 'number', description: 'Torus tube radius, in meters.' },
              topScale: {
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2,
                description: 'Trapezoid-prism top face scale [xScale, zScale] relative to bottom face. [0.6,0.8] tapers inward; [1.2,1.0] flares along X.',
              },
              topLengthScale: { type: 'number', description: 'Trapezoid-prism top X scale relative to bottom length.' },
              topWidthScale: { type: 'number', description: 'Trapezoid-prism top Z scale relative to bottom depth.' },
              slopeAxis: { type: 'string', enum: ['x', 'z'], description: 'Wedge slope direction axis. Use z for ramps/car hoods front-back, x for side wedges.' },
              slopeDirection: { type: 'string', enum: ['positive', 'negative'], description: 'Wedge high side direction along slopeAxis. positive means +X or +Z high side.' },
              axis: {
                type: 'string',
                enum: ['x', 'y', 'z'],
                description:
                  'Primary axis. For cylinder/hollow-cylinder/cone/frustum/capsule/half-cylinder/hemisphere it is the length/dome-up axis. For torus it is the ring normal/axle axis. "y"=vertical, "x"=left-right, "z"=front-back. Bicycle/vehicle wheel_set tires use axis="z" so the wheel disk is vertical in the X/Y plane.',
              },
              radialSegments: {
                type: 'number',
                description:
                  'Round-part smoothness for cylinders, cones, frustums, torus cross-sections, capsules, half-cylinders, and sweeps. Use 24-48 for visible mechanical parts.',
              },
              capSegments: {
                type: 'number',
                description: 'Capsule cap smoothness. Use 4-8 for low-poly soft rounded ends.',
              },
              tubularSegments: {
                type: 'number',
                description: 'Sweep/torus path smoothness. Use 16-40 for curved cables/handles and 48-96 for visible rings or tires.',
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
                  'For lathe and extrude shapes. Lathe: [radius,height] points revolved around Y, bottom-to-top. Extrude: closed outer [x,y] outline extruded through depth. For gears or logos, precompute every outline point as numeric literals.',
              },
              holes: {
                type: 'array',
                items: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                description:
                  'Extrude-only inner cutout loops. Each hole is a closed [x,y] polygon. Use holes for bores, slots, and keyways. Example: holes:[[[0.1,0],[0,0.1],[-0.1,0],[0,-0.1]]].',
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
                description: 'For lathe shapes only. Revolve angle in radians. Use 2*PI (~6.283) for full revolution. Use smaller values for partial sweeps. Default: 6.283 (full circle).',
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
              array: {
                type: 'object',
                description: 'Repeat this primitive before validation. Use for grilles, screw rows, louvers, fins, legs, ribs, and repeated appliance details. Linear: {count, step:[x,y,z]} or {count, axis, spacing}. Grid: {columns, rows, layers, spacing:[x,y,z]}.',
                properties: {
                  count: { type: 'number', description: 'Linear repeat count including the original shape.' },
                  columns: { type: 'number', description: 'Grid columns along local/world X step.' },
                  rows: { type: 'number', description: 'Grid rows along local/world Z step.' },
                  layers: { type: 'number', description: 'Grid layers along local/world Y step.' },
                  step: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Linear repeat offset [dx,dy,dz] in meters.' },
                  spacing: { description: 'Grid spacing [dx,dy,dz] or scalar linear spacing.' },
                  axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Linear repeat axis when using scalar spacing.' },
                },
              },
              arrayCount: { type: 'number', description: 'Compatibility shortcut for array.count.' },
              arrayStep: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Compatibility shortcut for array.step.' },
              material: {
                type: 'object',
                description:
                  'Optional material. Prefer {properties:{color:"#C4956A", roughness:0.6, metalness:0}}. Also accepted: {color:"#C4956A"} or {preset:"wood"}.',
              },
              materialPreset: { type: 'string', description: 'Optional material preset id.' },
              name: { type: 'string', description: 'Shape name.' },
              semanticRole: {
                type: 'string',
                description:
                  'Optional validation role for important shapes, e.g. vehicle_body, vehicle_tire, vehicle_window, headlight, front_bumper, rear_bumper, bicycle_tire, bicycle_frame.',
              },
              semanticGroup: {
                type: 'string',
                description:
                  'Optional logical group id shared by shapes that belong to the same semantic module.',
              },
              sourcePartKind: {
                type: 'string',
                description: 'Optional source part kind when hand-building a reusable module.',
              },
              sourcePartId: {
                type: 'string',
                description: 'Optional source part id/name when hand-building a reusable module.',
              },
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


const COMPOSE_RECIPE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_recipe',
    description:
      'Create an editable primitive object from a small closed-form deterministic recipe pack. Use only when the object is a professional standard part with stable geometry, such as gear.spur, sprocket.chain, pipe.flange/elbow90, fastener.hexBolt, bearing.pillowBlock, coupling.flexible, plate.perforated, valve.gate/ball, robotArm.threeAxis, motor.servo, or mixer.impeller. Do not use recipes for open-ended vehicles, outdoor AC units, machine tools, pumps, conveyors, fans, tanks, towers, reactors, compressors, grate coolers, or broad factory equipment; use compose_parts for dedicated industrial parts families and compose_assembly for broader open-ended families.',
    parameters: {
      type: 'object',
      properties: {
        recipeId: {
          type: 'string',
          enum: [
            'gear.spur',
            'sprocket.chain',
            'pipe.flange',
            'pipe.elbow90',
            'fastener.hexBolt',
            'bearing.pillowBlock',
            'coupling.flexible',
            'plate.perforated',
            'valve.gate',
            'valve.ball',
            'robotArm.threeAxis',
            'motor.servo',
            'mixer.impeller',
          ],
          description:
            'Built-in primitive recipe id. Use gear.spur for spur gears, sprocket.chain for roller-chain sprockets, pipe.flange for standard flanges, pipe.elbow90 for standard elbows, fastener.hexBolt for hex-head bolts, bearing.pillowBlock for mounted bearings, coupling.flexible for shaft couplings, plate.perforated for perforated/sieve plates, valve.ball/gate for standard valves, robotArm.threeAxis for 3-axis robot arms, motor.servo for servo motors, and mixer.impeller only for a simple shaft+hub+blade mixer part. Use compose_parts for pump, conveyor, electrical cabinet, and pipe-system family registries; use compose_assembly for broader open-ended vehicles, outdoor AC units, machine tools, fans, tanks, towers, reactors, compressors, grate coolers, and factory equipment.',
        },
        name: { type: 'string', description: 'Optional generated object name.' },
        geometryBrief: GEOMETRY_BRIEF_SCHEMA,
        params: {
          type: 'object',
          description:
            'Compact recipe parameters. Keep this small: intent/style/color/dimensions only. The recipe expands to stable compose_parts or compose_robot_arm geometry internally.',
          properties: {
            name: { type: 'string', description: 'Optional generated object name.' },
            color: { type: 'string', description: 'Primary CSS color alias, e.g. #cc0000 for red.' },
            primaryColor: { type: 'string', description: 'Primary CSS color.' },
            secondaryColor: { type: 'string', description: 'Secondary CSS color.' },
            accentColor: { type: 'string', description: 'Glass/accent CSS color.' },
            darkColor: { type: 'string', description: 'Rubber/shadow CSS color.' },
            metalColor: { type: 'string', description: 'Metal CSS color.' },
            size: {
              type: 'string',
              enum: ['tiny', 'small', 'medium', 'large'],
              description: 'Recipe size preset.',
            },
            sizeScale: { type: 'number', description: 'Overall recipe scale multiplier.' },
            length: { type: 'number', description: 'Optional length/reach in meters.' },
            width: { type: 'number', description: 'Optional width in meters.' },
            height: { type: 'number', description: 'Optional height in meters.' },
            detail: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Recipe detail level.' },
            highFidelity: {
              type: 'boolean',
              description: 'When true, request smoother/stylized high-fidelity primitive details inside the recipe.',
            },
            enhanceVisualDetails: { type: 'boolean', description: 'Alias for highFidelity.' },
            valveStyle: {
              type: 'string',
              enum: ['gate', 'ball'],
              description: 'Valve style hint; normally implied by recipeId.',
            },
            handleStyle: { type: 'string', enum: ['lever', 'handwheel'], description: 'Valve handle hint.' },
            axisCount: { type: 'number', description: 'Robot arm visible axis count; use 3 for robotArm.threeAxis.' },
            baseShape: {
              type: 'string',
              enum: ['round', 'square', 'pedestal'],
              description: 'Robot arm base shape. Use round for circular base.',
            },
            endEffector: {
              type: 'string',
              enum: ['gripper', 'suction', 'tool-flange'],
              description: 'Robot arm end effector. Default gripper.',
            },
            pose: {
              type: 'string',
              enum: ['rest', 'reach-forward', 'work-ready'],
              description: 'Robot arm pose. Default work-ready for a readable bent silhouette.',
            },
            reach: { type: 'number', description: 'Robot arm reach in meters.' },
            teeth: { type: 'number', description: 'gear.spur tooth count.' },
            module: { type: 'number', description: 'gear.spur module in millimeters, e.g. 4.5.' },
            outerDiameter: {
              type: 'number',
              description:
                'gear.spur/sprocket.chain outside/tip diameter, pipe.flange outside diameter, or coupling.flexible outside diameter in meters.',
            },
            nominalDiameter: {
              type: 'number',
              description:
                'pipe flange/elbow nominal diameter, fastener.hexBolt nominal shank diameter, bearing/coupling shaft diameter, or plate hole nominal diameter in meters.',
            },
            boltCircleDiameter: { type: 'number', description: 'pipe.flange bolt circle diameter in meters.' },
            boltCount: { type: 'number', description: 'pipe.flange bolt hole count.' },
            bendRadius: { type: 'number', description: 'pipe.elbow90 bend centerline radius in meters.' },
            angle: { type: 'number', description: 'pipe.elbow90 bend angle in degrees; default 90.' },
            jawCount: { type: 'number', description: 'coupling.flexible elastomer jaw/spider count.' },
            rows: { type: 'number', description: 'plate.perforated hole grid row count.' },
            columns: { type: 'number', description: 'plate.perforated hole grid column count.' },
            holeCount: { type: 'number', description: 'plate.perforated column/count hint when rows are omitted.' },
            holeDiameter: { type: 'number', description: 'plate.perforated circular hole diameter in meters.' },
            boltSpacing: { type: 'number', description: 'bearing.pillowBlock mounting hole spacing in meters.' },
            headHeight: { type: 'number', description: 'fastener.hexBolt head height in meters.' },
            headDiameter: { type: 'number', description: 'fastener.hexBolt across-corner head diameter in meters.' },
            shankLength: { type: 'number', description: 'fastener.hexBolt shank length in meters.' },
            threadLength: { type: 'number', description: 'fastener.hexBolt threaded length in meters.' },
            pitchDiameter: { type: 'number', description: 'gear.spur pitch diameter in meters.' },
            rootDiameter: { type: 'number', description: 'gear.spur root diameter in meters.' },
            thickness: { type: 'number', description: 'gear/sprocket/plate/flange axial thickness in meters.' },
            boreDiameter: { type: 'number', description: 'gear/sprocket/bearing/coupling bore diameter in meters.' },
            keywayWidth: { type: 'number', description: 'gear.spur keyway width in meters.' },
            keywayDepth: { type: 'number', description: 'gear.spur keyway radial depth in meters.' },
            bladeCount: { type: 'number', description: 'mixer.impeller blade count; default 3.' },
            bladeLength: { type: 'number', description: 'mixer.impeller blade radial length in meters.' },
            bladeWidth: { type: 'number', description: 'mixer.impeller blade width in meters.' },
            bladeThickness: { type: 'number', description: 'mixer.impeller blade thickness in meters.' },
            bladeTilt: { type: 'number', description: 'mixer.impeller blade tilt in degrees; default 0. Use compose_parts + propeller_blade_set for new mixer/agitator blade requests.' },
            shaftDiameter: { type: 'number', description: 'mixer.impeller vertical shaft diameter in meters.' },
            shaftLength: { type: 'number', description: 'mixer.impeller vertical shaft length in meters.' },
            position: {
              type: 'array',
              items: { type: 'number' },
              minItems: 3,
              maxItems: 3,
              description: 'Optional object origin [x,y,z].',
            },
          },
        },
      },
      required: ['recipeId'],
    },
  },
}

const COMPOSE_ASSEMBLY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_assembly',
    description:
      'Create one editable object through the constraint-first automatic instruction-sheet generator. Prefer this only for supported open-ended families without a dedicated parts family: vehicles, outdoor AC units, machine tools (lathe/milling/grinder/planer/drill/CNC), industrial robot arms, fans, tanks, distillation/chemical towers or columns, reactors, compressors, grate coolers, and broad factory equipment. Use compose_parts family registries for pumps, belt conveyors, electrical/control cabinets, and pipe systems. Plain chimneys/smokestacks are not assembly towers; use compose_parts with chimney_stack. If the requested family is unsupported, do not retry assembly; switch to compose_parts and build from generic reusable parts. Pass hard constraints such as length, width/diameter, height, primaryColor. Use compose_recipe only for closed-form standard instruction sheets such as gears/sprockets, flanges/elbows, fasteners, bearings, couplings, perforated plates, standard valves, robotArm.threeAxis, mixer.impeller, and servo motors.',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        family: {
          type: 'string',
          enum: ['vehicle', 'fan', 'pump', 'conveyor', 'machine_tool', 'outdoor_ac', 'tank', 'distillation_tower', 'reactor', 'compressor', 'grate_cooler', 'electrical', 'robot_arm'],
        },
        object: { type: 'string' },
        style: { type: 'string' },
        length: { type: 'number' },
        width: { type: 'number' },
        diameter: { type: 'number', description: 'Cylindrical diameter in meters; for towers/columns this maps to width.' },
        height: { type: 'number' },
        primaryColor: { type: 'string' },
        color: { type: 'string' },
      },
    },
  },
}

const COMPOSE_PARTS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_parts',
    description:
      'Create one editable object from the reusable building-block library. Parts are generic kernels; assign semanticRole to give context-specific meaning. Use this for explicit reusable part blueprints, industrial family registries, subassemblies, and any object family not supported by compose_assembly. Recipes are instruction sheets that reference parts; assembly is the automatic instruction-sheet generator.',
    parameters: {
      type: 'object',
      properties: {
        geometryBrief: GEOMETRY_BRIEF_SCHEMA,
        name: { type: 'string', description: 'Object name, e.g. "standing fan".' },
        partName: {
          type: 'string',
          description: 'Compatibility alias for name. Prefer name in new tool calls.',
        },
        family: {
          type: 'string',
          enum: ['pump', 'conveyor', 'electrical', 'pipe_system', 'aircraft', 'kiosk', 'desk', 'generic'],
          description:
            'Optional parts-family registry id. Use pump, conveyor, electrical, or pipe_system for industrial equipment so top-level dimensions drive editable part parameters.',
        },
        length: { type: 'number', description: 'Overall object length in meters.' },
        width: { type: 'number', description: 'Overall object width/depth in meters.' },
        height: { type: 'number', description: 'Overall object height in meters.' },
        diameter: { type: 'number', description: 'Overall cylindrical diameter in meters, mainly for pipe systems.' },
        position: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Object origin [x, y, z]. Part positions are offsets from this origin. Defaults to [0,0,0].',
        },
        detail: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Procedural detail level. medium is usually enough; high adds smoother rings/spokes.',
        },
        primaryColor: { type: 'string', description: 'Primary CSS color.' },
        secondaryColor: { type: 'string', description: 'Secondary CSS color.' },
        metalColor: { type: 'string', description: 'Metal/wire CSS color.' },
        darkColor: { type: 'string', description: 'Dark plastic/rubber CSS color.' },
        accentColor: { type: 'string', description: 'Accent/blade CSS color.' },
        autoComplete: {
          type: 'boolean',
          description:
            'When true or omitted, compose_parts may add missing structural essentials for recognized factory equipment, e.g. pump skid/motor/ports/flange or conveyor frame/rollers/belt.',
        },
        enhanceVisualDetails: {
          type: 'boolean',
          description:
            'When true, compose_parts adds recommended non-essential visual details such as impellers, nameplates, warning labels, control knobs, drive motors, or seam rings. Defaults to automatic only when the object name/request asks for detail or realism.',
        },
        parts: {
          type: 'array',
              description:
                'Reusable parts to procedurally expand into primitives. Complete family objects and family components are different intents: car steering wheel, car wheel, aircraft wing, pump impeller, and fan blade are single-component requests, not parent assemblies. For industrial families, prefer family:"pump", family:"conveyor", family:"electrical", or family:"pipe_system" with top-level length/width/height or diameter plus optional parts[].params; the registry fills required parts and clamps unsafe values. For kiosks, booths, ticket booths, vendor stalls, newsstands, small pavilions, and small sheds, use family:"kiosk" with kiosk_body, kiosk_roof, kiosk_opening, kiosk_counter, kiosk_sign, and kiosk_awning. If no dedicated part kind exists for a component, use family:"generic" with generic_body/generic_base/generic_panel/generic_handle/generic_spout/generic_control_panel/generic_display/generic_foot_set/generic_opening/generic_detail_accent before raw compose_primitive. For a standing fan use circular_base + vertical_pole + support_bracket + motor_housing + radial_blades + protective_grill + optional control_knob. For shaft + hub + propeller/impeller/mud-mixer blades use cylinder-like support parts plus propeller_blade_set; do not create a new recipe. For chimneys/smokestacks use chimney_stack with height/radius and warningStripes:true for red-white bands. For desks with visible drawers use desk_top + leg_set + drawer_stack. For electrical/control cabinets use electrical_cabinet + cable_tray + nameplate/warning details. For pipe systems use pipe_run + pipe_elbow + flange_ring/valve_body. For a complete bicycle use wheel_set semanticRole:bicycle_tire count:2 + tube_frame semanticRole:bicycle_frame + fork semanticRole:bicycle_fork + handlebar + saddle + chain_loop; do not invent bicycle_crank/chainring/pedals part kinds. For a complete car use body_shell semanticRole:vehicle_body + wheel_set count:4 semanticRole:vehicle_tire + window_strip semanticRole:vehicle_window variant:vehicle_glasshouse + light_pair + bar_pair; legacy vehicle_* aliases remain accepted. For complete aircraft/airplanes/airliners, use family:"aircraft" with top-level length/primaryColor and optional aircraft_* parts with params; the registry fills fuselage, wings, engines, T-tail, windows, and landing gear. Do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For a water pump / centrifugal blower use skid_base + ribbed_motor_body or rounded_machine_body + volute_casing + inlet_port + outlet_port + flange_ring + optional impeller_blades + control_box. For conveyors use conveyor_frame + roller_array + belt_surface. For tanks use cylindrical_tank plus pipe/flange details. For valves use valve_body plus optional handwheel; set valveStyle/handleStyle for variants such as ball valves instead of inventing internal parts. For factory scenes use gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, platform_ladder, electrical_cabinet, cable_tray, pipe_run, and pipe_elbow.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'circular_base',
                  'vertical_pole',
                  'motor_housing',
                  'radial_blades',
                  'protective_grill',
                  'pyramid',
                  'support_bracket',
                  'control_knob',
                  'vent_slats',
                  'vent_grill',
                  'skid_base',
                  'rounded_machine_body',
                  'volute_casing',
                  'impeller_blades',
                  'propeller_blade_set',
                  'pipe_port',
                  'inlet_port',
                  'outlet_port',
                  'flange_ring',
                  'bolt_pattern',
                  'control_box',
                  'ribbed_motor_body',
                  'conveyor_frame',
                  'roller_array',
                  'belt_surface',
                  'cylindrical_tank',
                  'chimney_stack',
                  'valve_body',
                  'handwheel',
                  'wheel',
                  'wheel_set',
                  'window_panel',
                  'window_strip',
                  'body_shell',
                  'tube_frame',
                  'fork',
                  'light_pair',
                  'bar_pair',
                  'bicycle_wheels',
                  'bicycle_frame',
                  'bicycle_fork',
                  'handlebar',
                  'saddle',
                  'chain_loop',
                  'vehicle_body',
                  'vehicle_wheels',
                  'vehicle_windows',
                  'headlights',
                  'bumper',
                  'gearbox_body',
                  'filter_vessel',
                  'heat_exchanger',
                  'agitator_tank',
                  'pipe_rack',
                  'platform_ladder',
                  'desk_top',
                  'leg_set',
                  'drawer_stack',
                  'electrical_cabinet',
                  'pipe_run',
                  'pipe_elbow',
                  'cable_tray',
                  'nameplate',
                  'warning_label',
                  'seam_ring',
                  'airfoil_blade',
                  'ellipsoid_shell',
                  'curved_lens_panel',
                  'ergonomic_shell',
                  'streamlined_body',
                  'lofted_panel',
                ],
                description:
                  'Reusable procedural part. kiosk_body/kiosk_roof/kiosk_opening/kiosk_counter/kiosk_sign/kiosk_awning build small kiosks, ticket booths, vendor stalls, newsstands, small pavilions, and sheds. generic_body/generic_base/generic_panel/generic_handle/generic_spout/generic_control_panel/generic_display/generic_foot_set/generic_opening/generic_detail_accent cover unknown long-tail equipment, simple objects, and devices while preserving semantic part roles. aircraft_fuselage/aircraft_wing/aircraft_engine/aircraft_vertical_stabilizer/aircraft_horizontal_stabilizer/aircraft_landing_gear are family-registry parts for complete aircraft; use parts[].params to tune length, span, engine count/radius, window count, colors, and landing gear. chimney_stack creates a tall tapered industrial chimney with base, rim, lift seams, access door, and optional red-white warning bands. pyramid creates a four-sided pyramid from length/width/height; set truncated:true or topScale/topRadius to make a flat-top truncated pyramid/frustum. vent_grill creates framed grille/louver panels; bolt_pattern creates screws/fasteners; leg_set creates support feet; nameplate creates rating plates; pipe_port/inlet_port/outlet_port create nozzles. propeller_blade_set creates count-based radial propeller/impeller/mixer paddle sets, including taiji-half circular-cropped blades with longitudinal curve; airfoil_blade creates continuous swept/tapered aircraft/turbine-like blades for local blade details, not complete aircraft layout; curved_lens_panel creates tinted non-rectangular lenses/visors; ergonomic_shell creates smooth mouse/controller/appliance shells; streamlined_body creates aerodynamic fuselage/car/train/appliance bodies; lofted_panel creates section-to-section transition fairings/panels. protective_grill creates a shallow domed fan cage; radial_blades creates airfoil-like fan blades; desk_top/leg_set/drawer_stack build office desks; electrical_cabinet/cable_tray build power/control cabinets and tray routes; pipe_run/pipe_elbow build process piping; wheel/wheel_set/window_panel/window_strip/body_shell/tube_frame/fork/light_pair/bar_pair are generic building blocks whose meaning comes from semanticRole; bicycle_* and vehicle_* aliases remain accepted but new calls should prefer generic parts; volute_casing creates pump/blower scroll casing; impeller_blades creates pump/turbine vanes; pipe/inlet/outlet/flange/bolt parts create industrial connection details; ribbed_motor_body, conveyor_frame, roller_array, belt_surface, cylindrical_tank, valve_body, handwheel, gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, and platform_ladder cover common factory equipment.',
              },
              partType: {
                type: 'string',
                description:
                  'Compatibility alias for kind. Prefer kind in new tool calls; accepted to recover from analysis text that says partType.',
              },
              id: { type: 'string', description: 'Stable part id for connectTo references, e.g. "pump_outlet".' },
              name: { type: 'string', description: 'Optional part name.' },
              partName: {
                type: 'string',
                description: 'Compatibility alias for name. Prefer name in new tool calls.',
              },
              params: {
                type: 'object',
                description:
                  'LLM-safe adjustable part parameters. Prefer params for family parts instead of raw coordinates. Kiosk examples: kiosk_body {length,width,height,primaryColor}; kiosk_roof {length,width,height,variant:pitch|flat}; kiosk_opening {length,height}; kiosk_counter {length,width,thickness}; kiosk_sign {length,height,accentColor}. Generic examples: generic_body {length,width,height,primaryColor,cornerRadius}; generic_base {length,width,thickness}; generic_spout {length,radius}; generic_control_panel/generic_display/generic_opening {length,height,thickness}. Vehicle examples: body_shell {length,width,height,primaryColor,vehicleStyle}; wheel_set {count:2|4|6,radius,width,hubColor}; window_strip {height,tint,opacity}. Aircraft examples: aircraft_fuselage {length,width,height,count,primaryColor,accentColor,noseRoundness}; aircraft_wing {length,width,thickness,bladeSweep}; aircraft_engine {count,radius,length,width}; aircraft_landing_gear {length,width,radius}. Values are normalized and clamped by the tool.',
              },
              style: {
                type: 'string',
                description:
                  'Optional style hint consumed by supported procedural parts. For vehicle_body use sedan, suv, sports, van, or truck when inferable. Prefer this over inventing tiny unsupported part kinds.',
              },
              vehicleStyle: {
                type: 'string',
                enum: ['sedan', 'suv', 'sports', 'van', 'truck'],
                description:
                  'vehicle_body style preset. Use sedan for normal cars, suv for SUVs/off-road vehicles, sports for sports/racing cars, van for vans/MPVs, and truck for pickup/trucks.',
              },
              variant: {
                type: 'string',
                description:
                  'Optional variant hint for supported procedural parts, e.g. ball/gate for valves or visual subtype hints for machinery.',
              },
              valveStyle: {
                type: 'string',
                description:
                  'valve_body style hint. Use "ball" for ball valves / quarter-turn valves; omit for the default gate-valve-like body.'
              },
              handleStyle: {
                type: 'string',
                description:
                  'handwheel style hint. Use "lever" for ball valves or quarter-turn handles; omit for a circular handwheel.',
              },
              state: {
                type: 'string',
                description:
                  'Optional operating state hint such as open/closed. Use only when the requested object describes a meaningful visible state.',
              },
              connectTo: {
                description:
                  'Optional part id, name, kind, or prior part index to connect this part to. Use with anchor/childAnchor so flanges can snap to pipe ends or ports can snap to housings.',
              },
              connectPoint: {
                type: 'string',
                description:
                  'Semantic connection point on the parent part when connectTo is used. Examples: pipe open/base, volute inlet/outlet, motor shaft, valve inlet/outlet, tank top/nozzle.',
              },
              childPoint: {
                type: 'string',
                description:
                  'Semantic connection point on this child part. Examples: flange back/front, pipe base/open. Prefer connectPoint/childPoint over manual position for mechanical attachments.',
              },
              centeredOn: {
                description:
                  'Optional part id, name, kind, or prior part index. Align this part center on the referenced part in X/Z while keeping its own natural height. Use before manual position for centered modules.',
              },
              alignAbove: {
                description:
                  'Optional part id, name, kind, or prior part index. Stack this part on top of the referenced part by matching parent top to child bottom and centering X/Z.',
              },
              alignBeside: {
                description:
                  'Optional part id, name, kind, or prior part index. Place this part beside the referenced part; set side left/right/front/back to choose direction.',
              },
              offsetFrom: {
                description:
                  'Optional part id, name, kind, or prior part index. Like alignBeside, but intended for controlled offsets from a parent boundary; set offsetDirection and offsetDistance.',
              },
              offsetDirection: {
                type: 'string',
                enum: ['left', 'right', 'front', 'back', 'top', 'bottom'],
                description:
                  'Direction used by offsetFrom. Use front/back/left/right for ports, manifolds, labels, and external modules.',
              },
              offsetDistance: {
                type: 'number',
                description:
                  'Extra clearance in meters beyond parent/child extents when offsetFrom is used.',
              },
              around: {
                description:
                  'Optional part id, name, kind, or prior part index. Place this part around the referenced part on a circular distribution. Use with aroundCount for evenly spaced repeated supports, small fixtures, or decorative modules.',
              },
              aroundCount: {
                type: 'number',
                description:
                  'When around is set, duplicate this part into this many evenly spaced copies. Example: around:"tank", aroundCount:4, aroundRadius:0.5 for four feet around a vessel.',
              },
              aroundIndex: {
                type: 'number',
                description:
                  'Optional zero-based index when manually defining one element in an around distribution. Usually omit when using aroundCount.',
              },
              aroundRadius: {
                type: 'number',
                description:
                  'Optional radius in meters for around placement. Omit to use parent/child extents plus relationGap.',
              },
              aroundAngle: {
                type: 'number',
                description:
                  'Optional absolute angle in radians for a single around-placed part. Prefer aroundCount for evenly spaced copies.',
              },
              aroundStartAngle: {
                type: 'number',
                description:
                  'Optional start angle in radians for aroundCount distributions. Use when the first item should start front/back/diagonal.',
              },
              aroundAxis: {
                type: 'string',
                enum: ['x', 'y', 'z'],
                description:
                  'Axis to distribute around. Default y means horizontal X/Z circle around a vertical object.',
              },
              cornerPattern: {
                type: 'boolean',
                description:
                  'When true with around, place repeated parts at rectangular parent corners instead of a circular distribution. Use for four feet/supports on a base.',
              },
              cornerInset: {
                type: 'number',
                description:
                  'Inset in meters from the parent corner when cornerPattern is true.',
              },
              array: {
                type: 'object',
                description:
                  'Linear repetition for one part after relationship placement. Use for evenly spaced cylinders, ribs, vents, bolts, and fins without hand-written positions.',
                properties: {
                  count: { type: 'number', description: 'Number of repeated copies.' },
                  axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Repeat axis.' },
                  spacing: { type: 'number', description: 'Center-to-center spacing in meters.' },
                },
              },
              relationGap: {
                type: 'number',
                description:
                  'Optional clearance in meters used by alignAbove/alignBeside. Usually omit or use a small value such as 0.01-0.05.',
              },
              anchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description: 'Parent anchor when connectTo is used. Example: anchor="front" for the open end of a front-facing port.',
              },
              childAnchor: {
                type: 'string',
                enum: ['top', 'bottom', 'center', 'front', 'back', 'left', 'right'],
                description: 'Child anchor when connectTo is used. Example: childAnchor="back" to place a flange back face against a pipe front end.',
              },
              rotation: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'Optional part-level Euler rotation [x,y,z] in radians. Use for angled motors, rotated pumps, diagonal conveyors, or rotated tanks.',
              },
              axis: {
                type: 'string',
                enum: ['x', 'y', 'z'],
                description:
                  'Part axis for ports, flanges, bolts, cylinders, and rings. x=left/right, y=vertical, z=front/back.',
              },
              side: {
                type: 'string',
                enum: ['left', 'right', 'top', 'bottom', 'front', 'back'],
                description:
                  'Semantic side for ports/flanges. This chooses the axis and places pipe rims on the open end, e.g. side="front" for a front suction inlet or side="top" for an upward discharge.',
              },
              outletAngle: {
                type: 'number',
                description:
                  'volute_casing discharge angle in radians in the XY plane. 0 points right, 1.57 points upward. Use to orient pump/blower outlet necks.',
              },
              position: {
                type: 'array',
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3,
                description:
                  'Part center/local reference offset [x,y,z] from object origin. Fan grille/blades/motor share the same Y height and face along Z.',
              },
              radius: { type: 'number', description: 'Generic radius for round parts.' },
              height: { type: 'number', description: 'Vertical height or part thickness depending on kind.' },
              width: { type: 'number', description: 'Part width, bracket width, or blade width depending on kind.' },
              depth: { type: 'number', description: 'Depth along Z, grille cage depth, or motor depth. For protective_grill this is the front-to-back cage thickness.' },
              domeDepth: { type: 'number', description: 'protective_grill front dome bulge along Z. Use 0.06-0.14 for a shallow half-round fan cage.' },
              length: { type: 'number', description: 'Length alias used by some parts. For vehicle_body this is the front-back body length along X.' },
              truncated: {
                type: 'boolean',
                description:
                  'For pyramid, true removes the pointed tip and creates a flat-top truncated pyramid/frustum.',
              },
              topScale: {
                type: 'number',
                description:
                  'For pyramid, top footprint scale relative to the base. Use 0.3-0.6 for a flat top instead of a sharp point.',
              },
              topRadius: {
                type: 'number',
                description:
                  'For pyramid, explicit top radius/half-width for a flat-top truncated pyramid. Usually prefer topScale.',
              },
              topLength: {
                type: 'number',
                description:
                  'For pyramid, desired top length in meters for a flat top. Usually prefer topScale.',
              },
              topWidth: {
                type: 'number',
                description:
                  'For pyramid, desired top width in meters for a flat top. Usually prefer topScale.',
              },
              sizeScale: {
                type: 'number',
                description:
                  'vehicle_body overall scale multiplier when exact dimensions are not specified. Use about 0.8 for a small car and 1.0 for a normal sedan.',
              },
              count: { type: 'number', description: 'Generic count, e.g. blade count.' },
              ringCount: { type: 'number', description: 'protective_grill curved concentric ring count. Use 4-5 for a fan guard.' },
              spokeCount: { type: 'number', description: 'protective_grill radial spoke count. Use 12-24 for a fan guard.' },
              wireRadius: { type: 'number', description: 'protective_grill wire thickness.' },
              warningStripes: {
                type: 'boolean',
                description:
                  'For chimney_stack, true adds red-white warning bands near the top like industrial smokestacks.',
              },
              stripeCount: {
                type: 'number',
                description: 'For chimney_stack, number of red-white warning bands. Use 4-7.',
              },
              stripeHeight: {
                type: 'number',
                description:
                  'For chimney_stack, vertical height in meters occupied by the warning band zone.',
              },
              wheelRadius: { type: 'number', description: 'vehicle_wheels/bicycle wheel radius alias.' },
              wheelWidth: { type: 'number', description: 'vehicle_wheels tire thickness along the axle.' },
              frontX: { type: 'number', description: 'vehicle_wheels optional front axle offset along the vehicle length axis.' },
              rearX: { type: 'number', description: 'vehicle_wheels optional rear axle offset along the vehicle length axis.' },
              frontZ: { type: 'number', description: 'Compatibility alias for frontX from older vehicle analysis; prefer frontX.' },
              rearZ: { type: 'number', description: 'Compatibility alias for rearX from older vehicle analysis; prefer rearX.' },
              overallHeight: { type: 'number', description: 'vehicle_body total car height in meters; height is also accepted.' },
              bodyHeight: { type: 'number', description: 'vehicle_body lower body shell height. Use a lower value for a sleeker sedan silhouette.' },
              cabinHeight: { type: 'number', description: 'vehicle_body cabin/roof block height. Use a compact value for a low roofline.' },
              roofCornerAngle: {
                type: 'number',
                description:
                  'vehicle_body cabin roof corner angle in degrees. Values below 90 create a tapered trapezoid-prism cabin; use about 85 when the user asks for roof corners that are not 90 degrees.',
              },
              cabinTopScale: {
                type: 'number',
                description:
                  'vehicle_body cabin top footprint scale. Values 0.85-0.95 make the roof slightly smaller than the cabin base for sloped, car-like roof pillars.',
              },
              cabinTopLengthScale: {
                type: 'number',
                description: 'vehicle_body optional X-only cabin top scale; prefer cabinTopScale unless the user asks for asymmetric proportions.',
              },
              cabinTopWidthScale: {
                type: 'number',
                description: 'vehicle_body optional Z-only cabin top scale; prefer cabinTopScale unless the user asks for asymmetric proportions.',
              },
              bladeRadius: { type: 'number', description: 'radial_blades/propeller_blade_set outer blade reach.' },
              bladeWidth: { type: 'number', description: 'radial_blades/propeller_blade_set/airfoil_blade max blade chord width. Use about 20-30% of bladeRadius or length.' },
              bladePitch: { type: 'number', description: 'radial_blades/propeller_blade_set/airfoil_blade blade pitch/twist hint in radians. Use 0.18-0.55 for visible real-fan, mixer, or propeller tilt.' },
              bladeSweep: { type: 'number', description: 'radial_blades/airfoil_blade tangential sweep/curvature amount. Positive values make the tips sweep back like real fan blades.' },
              bladeShape: {
                type: 'string',
                enum: ['taiji_half', 'airfoil'],
                description:
                  'propeller_blade_set shape. Use taiji_half for mud mixer/agitator/impeller paddles cut from a circular disk; use airfoil for aircraft/turbine propeller blades.',
              },
              verticalCurve: {
                type: 'number',
                description:
                  'propeller_blade_set longitudinal curve along the blade length in meters. Use 0.04-0.10 for mixer paddles so the blade bends along its radial spine, not just across its width.',
              },
              rootWidth: { type: 'number', description: 'airfoil_blade root chord width in meters; use wider roots for propeller/turbine/engine blades.' },
              tipWidth: { type: 'number', description: 'airfoil_blade tip chord width in meters; should be smaller than rootWidth for tapered blades.' },
              twist: { type: 'number', description: 'airfoil_blade twist hint in radians. Use 0.15-0.45 for propellers/engine fans.' },
              camber: { type: 'number', description: 'airfoil_blade/lens curvature amount in meters; gives a bent aerodynamic profile.' },
              pitch: { type: 'number', description: 'airfoil_blade pitch angle in radians. Use about 0.3-0.5 for visible propeller tilt.' },
              lensShape: {
                type: 'string',
                enum: ['frog', 'aviator', 'teardrop', 'rounded-rectangle'],
                description:
                  'curved_lens_panel outline style. Use frog for 铔よ焼澧ㄩ暅 / oversized sunglasses lenses, aviator/teardrop for drop-shaped lenses.',
              },
              curvature: {
                type: 'number',
                description:
                  'curved_lens_panel visible bend/curvature in radians. Use 0.06-0.16 for sunglasses, goggles, visors, or curved observation windows.',
              },
              noseSlope: { type: 'number', description: 'ergonomic_shell front/nose slope amount, 0-1. Use 0.35-0.55 for mouse-like shells.' },
              tailSlope: { type: 'number', description: 'ergonomic_shell rear/tail taper amount, 0-1.' },
              sideTaper: { type: 'number', description: 'ergonomic_shell side narrowing amount, 0-0.6. Use for mouse/controller streamlined sides.' },
              noseRoundness: { type: 'number', description: 'streamlined_body nose roundness, 0-1. Higher values create a softer aircraft/train/car nose.' },
              tailTaper: { type: 'number', description: 'streamlined_body tail taper amount, 0-0.9. Use for fuselages, sports bodies, train noses, and tapered appliance shells.' },
              roofArc: { type: 'number', description: 'streamlined_body roof/canopy arc hint, 0-0.8. Use for car rooflines, airplane canopies, and smooth upper highlights.' },
              sections: {
                type: 'array',
                description:
                  'lofted_panel section list for section-to-section transitions. Each section may include x, y, z, width, height. Use 3-5 sections for fairings, curved covers, ducts, and tapered panels.',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                    length: { type: 'number', description: 'Compatibility alias for section width.' },
                  },
                },
              },
              slatCount: { type: 'number', description: 'vent_slats count.' },
              boltCount: { type: 'number', description: 'flange_ring/bolt_pattern bolt count. Use 4-8 for pump flanges.' },
              includeBolts: {
                type: 'boolean',
                description:
                  'flange_ring only. Defaults to true. Set false when using a separate bolt_pattern or when a plain gasket flange is desired.',
              },
              material: {
                type: 'object',
                description: 'Optional part material, same shape as primitive material.',
              },
              materialPreset: { type: 'string', description: 'Optional material preset id.' },
              color: { type: 'string', description: 'Optional CSS color shortcut.' },
              primaryColor: {
                type: 'string',
                description:
                  'Part-level primary CSS color alias, useful for vehicle_body when the requested car color is specified on the body part.',
              },
              secondaryColor: { type: 'string', description: 'Part-level secondary CSS color alias.' },
              metalColor: { type: 'string', description: 'Part-level metal CSS color alias.' },
              darkColor: { type: 'string', description: 'Part-level rubber/shadow CSS color alias.' },
              accentColor: { type: 'string', description: 'Part-level accent/glass CSS color alias.' },
            },
          },
        },
      },
      required: ['parts'],
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
        axisCount: {
          type: 'number',
          description:
            'Requested visible axis count, e.g. 3 for a simple 3-axis linkage. Defaults to a readable 3-axis draft.',
        },
        baseShape: {
          type: 'string',
          enum: ['round', 'square', 'pedestal'],
          description: 'Base shape hint. Use round when the user asks for a round/circular base.',
        },
        endEffector: {
          type: 'string',
          enum: ['gripper', 'suction', 'tool-flange'],
          description:
            'End effector style. Use gripper by default unless the user asks for a suction cup or bare tool flange.',
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

const REVISION_SELECTOR_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'number', description: 'Exact current shape index; prefer semantic selectors when possible.' },
    semanticRole: { type: 'string', description: 'Semantic role such as vehicle_cabin, vehicle_roof, vehicle_window, vehicle_body.' },
    semanticGroup: { type: 'string', description: 'Semantic group id shared by related shapes.' },
    sourcePartKind: { type: 'string', description: 'Source part kind such as vehicle_body, vehicle_windows, vehicle_wheels.' },
    sourcePartId: { type: 'string', description: 'Source part id/name.' },
    kind: { type: 'string', description: 'Primitive kind filter.' },
    nameIncludes: { type: 'string', description: 'Case-insensitive name substring, e.g. "roof" or "side window".' },
  },
}

const REVISION_SHAPE_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'box',
        'cylinder',
        'hollow-cylinder',
        'cone',
        'frustum',
        'hemisphere',
        'torus',
        'wedge',
        'trapezoid-prism',
        'sphere',
        'lathe',
        'capsule',
        'half-cylinder',
        'rounded-panel',
        'ellipsoid',
        'ellipse-panel',
        'semi-ellipse-panel',
        'pyramid',
        'extrude',
        'sweep',
      ],
    },
    name: { type: 'string' },
    semanticRole: { type: 'string' },
    semanticGroup: { type: 'string' },
    sourcePartKind: { type: 'string' },
    sourcePartId: { type: 'string' },
    editableHints: {
      type: 'object',
      description:
        'Optional semantic edit contract for later revisions, e.g. {primaryDimension:"length", canScale:["length","width","height"]}.',
    },
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    length: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    depth: { type: 'number' },
    thickness: { type: 'number' },
    radius: { type: 'number' },
    radiusTop: { type: 'number' },
    radiusBottom: { type: 'number' },
    majorRadius: { type: 'number' },
    tubeRadius: { type: 'number' },
    topLengthScale: { type: 'number' },
    topWidthScale: { type: 'number' },
    slopeAxis: { type: 'string', enum: ['x', 'z'] },
    slopeDirection: { type: 'string', enum: ['positive', 'negative'] },
    axis: { type: 'string', enum: ['x', 'y', 'z'] },
    cornerRadius: { type: 'number' },
    cornerSegments: { type: 'number' },
    radialSegments: { type: 'number' },
    tubularSegments: { type: 'number' },
    widthSegments: { type: 'number' },
    heightSegments: { type: 'number' },
    profile: {
      type: 'array',
      items: { type: 'array', items: { type: 'number' } },
      description: 'Extrude/lathe profile points.',
    },
    holes: {
      type: 'array',
      items: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      description: 'Extrude inner cutout loops.',
    },
    path: {
      type: 'array',
      items: { type: 'array', items: { type: 'number' } },
      description: 'Sweep path points.',
    },
    material: {
      type: 'object',
      description: 'Optional material, e.g. {properties:{color:"#1e3a8a", opacity:0.75, transparent:true}}.',
    },
    materialPreset: { type: 'string' },
  },
  required: ['kind', 'position'],
}

const REVISE_GEOMETRY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'revise_geometry',
    description:
      'Patch the previous generated geometry artifact in response to user feedback. Prefer this for follow-up revision requests such as "roof looks wrong", "windows are detached", "make it smoother", "adjust proportions", or "keep the body but change the cabin". It preserves existing shapes unless operations remove/replace them. For simple color/material changes, use setMaterial with selectors by semanticRole; do not use replace or materialFrom.',
    parameters: {
      type: 'object',
      properties: {
        targetArtifactId: {
          type: 'string',
          description: 'The previous artifact id from the revision context. Omit only if there is exactly one current artifact.',
        },
        feedback: { type: 'string', description: 'User feedback being addressed.' },
        intent: {
          type: 'string',
          description:
            'Short internal plan, e.g. "replace separated cabin panels with integrated glasshouse and body-color pillars".',
        },
        userVisiblePlan: {
          type: 'string',
          description:
            'One concise Chinese sentence explaining what will be preserved and what will be changed.',
        },
        preserve: {
          type: 'array',
          items: { type: 'string' },
          description: 'Traits to preserve, e.g. body color, four wheels, overall scale, headlights.',
        },
        operations: {
          type: 'array',
          description:
            'Local edit operations. Use selectors by semanticRole/semanticGroup/sourcePartKind/nameIncludes. For color-only edits use setMaterial with color, e.g. belt_surface yellow and conveyor_frame/support_leg/drive_motor white. For "make blades/ports/feet longer/larger" prefer scaleSemantic with dimension:"primary" or "length" and factor such as 1.25.',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'add',
                  'remove',
                  'replace',
                  'transform',
                  'resize',
                  'scaleSemantic',
                  'materialFrom',
                  'setMaterial',
                  'align',
                ],
              },
              selector: REVISION_SELECTOR_SCHEMA,
              from: REVISION_SELECTOR_SCHEMA,
              to: REVISION_SELECTOR_SCHEMA,
              edge: {
                type: 'string',
                enum: ['top', 'bottom', 'front', 'back', 'left', 'right', 'center'],
              },
              toEdge: {
                type: 'string',
                enum: ['top', 'bottom', 'front', 'back', 'left', 'right', 'center'],
              },
              offset: { type: 'number' },
              position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              delta: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              factor: {
                type: 'number',
                description: 'scaleSemantic multiplier, e.g. 1.25 to enlarge selected semantic parts by 25%.',
              },
              dimension: {
                type: 'string',
                enum: [
                  'primary',
                  'uniform',
                  'length',
                  'width',
                  'height',
                  'depth',
                  'thickness',
                  'radius',
                  'diameter',
                  'majorRadius',
                  'tubeRadius',
                  'axisLength',
                  'profileX',
                  'profileY',
                ],
              },
              length: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              depth: { type: 'number' },
              thickness: { type: 'number' },
              radius: { type: 'number' },
              radiusTop: { type: 'number' },
              radiusBottom: { type: 'number' },
              majorRadius: { type: 'number' },
              tubeRadius: { type: 'number' },
              color: {
                type: 'string',
                description: 'Direct material color for setMaterial, e.g. "#FFFFFF" or "#f5c842".',
              },
              materialPreset: { type: 'string' },
              material: {
                type: 'object',
                description:
                  'Full PrimitiveMaterialInput for setMaterial. Prefer color for simple recoloring.',
              },
              shapes: { type: 'array', items: REVISION_SHAPE_SCHEMA },
            },
            required: ['op'],
          },
        },
      },
      required: ['feedback', 'intent', 'operations'],
    },
  },
}

type ComposeTool = typeof COMPOSE_RECIPE_TOOL | typeof COMPOSE_ASSEMBLY_TOOL | typeof COMPOSE_PARTS_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL | typeof COMPOSE_PRIMITIVE_TOOL | typeof REVISE_GEOMETRY_TOOL

const GEOMETRY_REPAIR_COMPRESSION_INTERVAL = 4
const GEOMETRY_REPAIR_STAGNATION_LIMIT = 4
const GEOMETRY_VISIBLE_RESULT_TAIL = 4

function geometryRepairIssues(content: string) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && !line.startsWith('- Warning:'))
}

function geometryRepairSignature(content: string) {
  const issues = geometryRepairIssues(content)
  if (issues.length > 0) return issues.slice().sort().join('|')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('|')
}

function compactGeometryRepairMemory(attempt: number, content: string) {
  const issues = geometryRepairIssues(content)
  const compactIssues = issues.length > 0 ? issues.slice(0, 10) : content.split('\n').slice(0, 6)
  return [`Attempt ${attempt} failed:`, ...compactIssues].join('\n')
}

function formatVisibleGeometryResults(results: string[]) {
  if (results.length <= GEOMETRY_VISIBLE_RESULT_TAIL + 1) return results.join('\n')
  return [
    `Auto-repaired ${results.length} times; keeping latest ${GEOMETRY_VISIBLE_RESULT_TAIL} compressed context entries.`,
    ...results.slice(-GEOMETRY_VISIBLE_RESULT_TAIL),
  ].join('\n')
}

function formatPrimitiveRunMessage(analysis: string | undefined, generate: string) {
  const trimmedAnalysis = analysis?.trim()
  return trimmedAnalysis
    ? `**Analysis:**\n${trimmedAnalysis}\n\n**Generate:**\n${generate}`
    : `**Generate:**\n${generate}`
}

function formatFactoryRunResult(data: unknown) {
  const result = isRecord(data) ? data : {}
  const patches = Array.isArray(result.patches) ? result.patches : []
  const nodeIds = Array.isArray(result.nodeIds)
    ? result.nodeIds.map((id) => String(id)).filter(Boolean)
    : []
  const missingAssets = Array.isArray(result.missingAssets) ? result.missingAssets : []
  const geometryRunId =
    typeof result.geometryRunId === 'string' ? result.geometryRunId : undefined
  const applied = result.applied === true
  const artifact = isRecord(result.artifact) ? result.artifact : undefined
  const artifactTitle =
    typeof artifact?.title === 'string'
      ? artifact.title
      : typeof artifact?.id === 'string'
        ? artifact.id
        : undefined
  const missingLines = missingAssets
    .map((item) => {
      if (!isRecord(item)) return null
      const name = typeof item.name === 'string' ? item.name : 'unknown'
      const reason = typeof item.reason === 'string' ? item.reason : 'not resolved'
      return `- ${name}: ${reason}`
    })
    .filter(Boolean)

  return [
    '**Factory draft:**',
    artifactTitle ? `- Geometry artifact: ${artifactTitle}` : '- Geometry artifact: none',
    `- Create patches: ${patches.length}`,
    nodeIds.length ? `- Node ids: ${nodeIds.join(', ')}` : '- Node ids: none',
    geometryRunId ? `- Geometry run: ${geometryRunId}` : undefined,
    `- Applied to canvas: ${applied ? 'yes' : 'no'}`,
    missingLines.length ? `\n**Missing assets:**\n${missingLines.join('\n')}` : undefined,
    applied
      ? '\nPatches were applied to the current canvas.'
      : '\nPatches are prepared for review only. Nothing was applied to the canvas.',
  ]
    .filter(Boolean)
    .join('\n')
}

function applyFactoryRunCreatePatchesToCanvas(data: unknown): string[] {
  const result = isRecord(data) ? data : {}
  if (result.applied === true) return []
  const patches = Array.isArray(result.patches) ? result.patches : []
  if (patches.length === 0) return []

  const scene = useScene.getState()
  const selectedLevelId = useViewer.getState().selection.levelId
  const createdIds: string[] = []

  for (const patch of patches) {
    if (!isRecord(patch) || patch.op !== 'create' || !isRecord(patch.node)) continue
    const node = patch.node as unknown as AnyNode
    if (typeof node.id !== 'string' || typeof node.type !== 'string') continue
    const patchParentId = typeof patch.parentId === 'string' ? patch.parentId : undefined
    const parentId = (patchParentId ?? selectedLevelId ?? undefined) as AnyNodeId | undefined
    scene.createNode(node, parentId)
    createdIds.push(node.id)
  }

  if (createdIds.length > 0) {
    useViewer.getState().setSelection({ selectedIds: [createdIds[0]!] })
  }
  return createdIds
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: ChatImageAttachment
  generationRun?: {
    id: string
    mode: 'articraft' | 'image-to-3d' | 'primitive' | 'factory'
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  }
  articraftResult?: ArticraftResult
  imageTo3dResult?: ImageTo3DResult
  geometryArtifact?: GeneratedGeometryArtifact
  modelArtifact?: GeneratedModelArtifact
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  isToolResult?: boolean
  toolCallId?: string
}

type GeneratedModelArtifact = {
  id: string
  title: string
  sourceTool: 'image-to-3d' | 'articraft'
  provider: string
  asset: AssetInput
  userPrompt: string
  createdAt: string
  placedAt?: string
  savedAt?: string
}

type ChatImageAttachment = {
  name: string
  type: string
  size: number
  dataUrl: string
}

type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ApiMessage = {
  role: string
  content: string | ApiContentPart[]
  tool_call_id?: string
  tool_calls?: unknown
}

type AiGenerationMode = 'primitive' | 'articraft' | 'image-to-3d'
type AiConversationPurpose = 'factory' | 'asset'

const AI_GENERATION_MODES: Array<{
  id: AiGenerationMode
  label: string
  tech: string
  description: string
}> = [
  {
    id: 'primitive',
    label: '\u51e0\u4f55\u642d\u5efa',
    tech: 'Primitive',
    description: 'LLM \u8c03\u7528 Pascal primitive \u5de5\u5177\uff0c\u751f\u6210\u53ef\u7f16\u8f91\u51e0\u4f55\u4f53\u3002',
  },
  {
    id: 'image-to-3d',
    label: '\u56fe\u751f\u5efa\u6a21',
    tech: 'Image to 3D',
    description: '\u4e0a\u4f20\u56fe\u7247\u8c03\u7528\u56fe\u751f 3D \u670d\u52a1\uff0c\u4fdd\u5b58\u4e3a\u7269\u54c1\u5e93\u6a21\u578b\u3002',
  },
  {
    id: 'articraft',
    label: '\u5173\u8282\u8d44\u4ea7',
    tech: 'Articraft',
    description: '\u751f\u6210\u5e26 links/joints \u7684\u53ef\u52a8\u8d44\u4ea7\uff0c\u53ef\u67e5\u770b\u3001\u5bfc\u5165\u548c\u8c03\u59ff\u6001\u3002',
  },
]

interface ArticraftResult {
  prompt: string
  status: 'ready' | 'imported'
  recordId: string
  recordPath: string
  name: string
  partCount: number
  jointCount: number
  assetId?: string
  asset?: AssetInput & { id: string; source: 'mine' }
  savedAt?: string
  previewError?: string
  links: ArticraftLink[]
  joints: ArticraftJoint[]
  data: ArticraftModelData
}

interface ImageTo3DResult {
  prompt: string
  asset: AssetInput & { id: string; source: 'mine' }
  saved: boolean
}

const ARTICRAFT_PROGRESS_LINE_LIMIT = 12
const AI_IMAGE_MAX_BYTES = 8 * 1024 * 1024
const AI_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const AI_CHAT_DEFAULT_CONVERSATION_ID = 'default'
const AI_CHAT_STORAGE_KEY = 'pascal-ai-chat-panel-state:v1'
const CONVERSATION_HISTORY_PAGE_SIZE = 15

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read image file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file'))
    reader.readAsDataURL(file)
  })
}

function imageAttachmentBaseName(image: ChatImageAttachment) {
  return image.name.replace(/\.[^.]+$/, '').trim() || 'Image to 3D asset'
}

function isImageTo3DAsset(value: unknown): value is AssetInput & { id: string; source: 'mine' } {
  if (typeof value !== 'object' || value === null) return false
  const asset = value as { id?: unknown; src?: unknown; thumbnail?: unknown; source?: unknown }
  return (
    typeof asset.id === 'string' &&
    typeof asset.src === 'string' &&
    typeof asset.thumbnail === 'string' &&
    asset.source === 'mine'
  )
}

function isMineAsset(value: unknown): value is AssetInput & { id: string; source: 'mine' } {
  return isImageTo3DAsset(value)
}

function isAbortError(error: unknown) {
  return isRecord(error) && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function isTerminalGenerationStatus(status: NonNullable<ChatMessage['generationRun']>['status']) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function isActiveGenerationRun(
  run: ChatMessage['generationRun'] | undefined,
): run is NonNullable<ChatMessage['generationRun']> {
  return Boolean(run && !isTerminalGenerationStatus(run.status))
}

function buildMultimodalContent(text: string, image?: ChatImageAttachment): string | ApiContentPart[] {
  const normalizedText =
    text.trim() || 'Describe the image and generate a 3D object.'
  if (!image) return normalizedText
  return [
    { type: 'text', text: normalizedText },
    { type: 'image_url', image_url: { url: image.dataUrl } },
  ]
}

function formatArticraftProgressMessage(header: string, lines: string[]) {
  const visibleLines = lines.map((line) => line.trim()).filter(Boolean).slice(-ARTICRAFT_PROGRESS_LINE_LIMIT)
  if (visibleLines.length === 0) return header
  return `${header}\n\n${visibleLines.map((line) => `- ${line}`).join('\n')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function findPendingPrimitiveRunMessageIndex(messages: readonly ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message?.role === 'assistant' &&
      !message.generationRun &&
      !message.geometryArtifact &&
      !message.modelArtifact &&
      !message.imageTo3dResult &&
      !message.articraftResult &&
      message.content.startsWith('**Generate:**')
    ) {
      return index
    }
  }
  return -1
}

function normalizeToolArgumentsSource(raw: string) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractFirstBalancedJsonObject(source: string) {
  const start = source.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return null
}

function requireToolArgumentsObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error('Tool arguments must be a JSON object.')
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const source = normalizeToolArgumentsSource(raw || '{}') || '{}'
  try {
    return requireToolArgumentsObject(JSON.parse(source))
  } catch (strictError) {
    const firstObject = extractFirstBalancedJsonObject(source)
    if (!firstObject || firstObject === source) {
      throw strictError
    }
    try {
      return requireToolArgumentsObject(JSON.parse(firstObject))
    } catch {
      throw strictError
    }
  }
}

function getShapeColor(shape: ShapeSpec) {
  if (shape.material?.properties?.color) return shape.material.properties.color
  if (shape.material?.preset === 'wood' || shape.materialPreset === 'wood') return '#a36b3f'
  if (shape.material?.preset === 'metal' || shape.materialPreset === 'metal') return '#9ca3af'
  if (shape.material?.preset === 'glass' || shape.materialPreset === 'glass') return '#8bd3ff'
  return '#a684ff'
}

const DEFAULT_EXTRUDE_PROFILE: [number, number][] = [
  [-0.5, -0.25],
  [0.5, -0.25],
  [0.5, 0.25],
  [-0.5, 0.25],
]

const DEFAULT_LATHE_PROFILE: [number, number][] = [
  [0, 0],
  [0.5, 1],
]

function profileBounds(profile: [number, number][]) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of profile) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, maxX, minY, maxY }
}

function centerPreviewGeometry(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return geometry
  const center = new THREE.Vector3()
  box.getCenter(center)
  geometry.translate(-center.x, -center.y, -center.z)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function extrudeProfileToShape(profile: [number, number][] | undefined) {
  const points = profile?.length ? profile : DEFAULT_EXTRUDE_PROFILE
  const first = points[0]
  const threeShape = new THREE.Shape()
  threeShape.moveTo(first?.[0] ?? -0.5, first?.[1] ?? -0.25)
  for (const [x, y] of points.slice(1)) threeShape.lineTo(x, y)
  threeShape.closePath()
  return threeShape
}

function addExtrudeHolesToShape(
  threeShape: THREE.Shape,
  holes: [number, number][][] | undefined,
) {
  for (const hole of holes ?? []) {
    const first = hole[0]
    if (!first) continue
    const path = new THREE.Path()
    path.moveTo(first[0], first[1])
    for (const [x, y] of hole.slice(1)) path.lineTo(x, y)
    path.closePath()
    threeShape.holes.push(path)
  }
  return threeShape
}

function getShapeDimensions(shape: ShapeSpec): Vec3 {
  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return [clampD(shape.length, 1), clampD(shape.height, 1), clampD(shape.width, 1)]
    case 'rounded-panel':
      return [clampD(shape.length, 1), clampD(shape.thickness ?? shape.height, 0.04), clampD(shape.width, 0.5)]
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'capsule':
    case 'half-cylinder': {
      const radius = clampR(shape.radius, 0.5)
      const height = clampD(shape.height, 1)
      const axis = shape.axis ?? 'y'
      if (axis === 'x') return [height, radius * 2, radius * 2]
      if (axis === 'z') return [radius * 2, radius * 2, height]
      return [radius * 2, height, radius * 2]
    }
    case 'frustum': {
      const radius = Math.max(clampD(shape.radiusTop, 0.25), clampD(shape.radiusBottom, 0.5))
      const height = clampD(shape.height, 1)
      const axis = shape.axis ?? 'y'
      if (axis === 'x') return [height, radius * 2, radius * 2]
      if (axis === 'z') return [radius * 2, radius * 2, height]
      return [radius * 2, height, radius * 2]
    }
    case 'torus': {
      const radius = (shape.majorRadius ?? shape.radius ?? 0.5) + (shape.tubeRadius ?? 0.08)
      return [radius * 2, radius * 2, radius * 2]
    }
    case 'sphere':
    case 'hemisphere': {
      const radius = clampR(shape.radius, 0.5)
      const scale = shape.scale ?? [1, 1, 1]
      return [radius * 2 * scale[0], radius * 2 * scale[1], radius * 2 * scale[2]]
    }
    case 'lathe': {
      const profile = (shape.profile as [number, number][] | undefined) ?? DEFAULT_LATHE_PROFILE
      const { minX, maxX, minY, maxY } = profileBounds(profile)
      const radius = Math.max(Math.abs(minX), Math.abs(maxX), 0.01)
      return [radius * 2, Math.max(0.01, maxY - minY), radius * 2]
    }
    case 'extrude': {
      const profile = (shape.profile as [number, number][] | undefined) ?? DEFAULT_EXTRUDE_PROFILE
      const { minX, maxX, minY, maxY } = profileBounds(profile)
      return [
        Math.max(0.01, maxX - minX),
        Math.max(0.01, maxY - minY),
        clampD(shape.depth ?? shape.width, 0.1, 0.005, 10),
      ]
    }
    case 'sweep': {
      const path = shape.path ?? [
        [-0.5, 0, 0],
        [0.5, 0, 0],
      ]
      const radius = clampR(shape.radius, 0.05)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      for (const [x, y, z] of path) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      return [
        Math.max(0.01, maxX - minX + radius * 2),
        Math.max(0.01, maxY - minY + radius * 2),
        Math.max(0.01, maxZ - minZ + radius * 2),
      ]
    }
    default:
      return [1, 1, 1]
  }
}

function GeneratedExtrudePreviewShape({
  color,
  position,
  rotation,
  shape,
}: {
  color: string
  position: Vec3
  rotation: Vec3
  shape: ShapeSpec
}) {
  const geometry = useMemo(() => {
    const bevelSize = shape.bevelSize ?? 0.001
    const bevelThickness = shape.bevelThickness ?? bevelSize
    const geometry = new THREE.ExtrudeGeometry(
      addExtrudeHolesToShape(
        extrudeProfileToShape(shape.profile as [number, number][] | undefined),
        shape.holes as [number, number][][] | undefined,
      ),
      {
        depth: clampD(shape.depth ?? shape.width, 0.1, 0.005, 10),
        bevelEnabled: bevelSize > 0 || bevelThickness > 0,
        bevelSize,
        bevelThickness,
        bevelSegments: shape.bevelSegments != null ? Math.round(clampD(shape.bevelSegments, 2, 0, 8)) : 1,
        curveSegments: shape.curveSegments != null ? Math.round(clampD(shape.curveSegments, 8, 1, 32)) : 8,
      },
    )
    return centerPreviewGeometry(geometry)
  }, [
    shape.profile,
    shape.holes,
    shape.depth,
    shape.width,
    shape.bevelSize,
    shape.bevelThickness,
    shape.bevelSegments,
    shape.curveSegments,
  ])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation}>
      <meshStandardMaterial color={color} metalness={0.25} roughness={0.55} />
    </mesh>
  )
}

function GeneratedLathePreviewShape({
  color,
  position,
  rotation,
  shape,
}: {
  color: string
  position: Vec3
  rotation: Vec3
  shape: ShapeSpec
}) {
  const geometry = useMemo(() => {
    const profile = (shape.profile as [number, number][] | undefined) ?? DEFAULT_LATHE_PROFILE
    const points = profile.map(([radius, y]) => new THREE.Vector2(radius, y))
    const geometry = new THREE.LatheGeometry(
      points,
      shape.segments != null ? Math.round(clampD(shape.segments, 32, 8, 96)) : 32,
      0,
      shape.arc != null ? clampD(shape.arc, Math.PI * 2, 0.01, Math.PI * 2) : Math.PI * 2,
    )
    return centerPreviewGeometry(geometry)
  }, [shape.profile, shape.segments, shape.arc])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation}>
      <meshStandardMaterial color={color} metalness={0.25} roughness={0.55} />
    </mesh>
  )
}

function GeneratedSweepPreviewShape({
  color,
  position,
  rotation,
  shape,
}: {
  color: string
  position: Vec3
  rotation: Vec3
  shape: ShapeSpec
}) {
  const geometry = useMemo(() => {
    const path = shape.path?.length
      ? shape.path
      : ([
          [-0.5, 0, 0],
          [0.5, 0, 0],
        ] as Vec3[])
    const curve = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
    const geometry = new THREE.TubeGeometry(
      curve,
      shape.tubularSegments != null ? Math.round(clampD(shape.tubularSegments, 32, 2, 128)) : 32,
      clampR(shape.radius, 0.05),
      shape.radialSegments != null ? Math.round(clampD(shape.radialSegments, 12, 3, 32)) : 12,
      Boolean(shape.closed),
    )
    return centerPreviewGeometry(geometry)
  }, [shape.path, shape.tubularSegments, shape.radius, shape.radialSegments, shape.closed])

  return (
    <mesh geometry={geometry} position={position} rotation={rotation}>
      <meshStandardMaterial color={color} roughness={0.72} />
    </mesh>
  )
}

function getArtifactMaxDimension(artifact: GeneratedGeometryArtifact) {
  let maxDimension = 1
  artifact.shapes.forEach((shape, index) => {
    const dims = getShapeDimensions(shape)
    const position = artifact.transforms[index]?.position ?? shape.position
    maxDimension = Math.max(
      maxDimension,
      Math.abs(position[0] - artifact.assemblyPosition[0]) + dims[0],
      Math.abs(position[1] - artifact.assemblyPosition[1]) + dims[1],
      Math.abs(position[2] - artifact.assemblyPosition[2]) + dims[2],
    )
  })
  return maxDimension
}

function GeneratedPreviewShape({
  artifact,
  index,
  shape,
}: {
  artifact: GeneratedGeometryArtifact
  index: number
  shape: ShapeSpec
}) {
  const transform = artifact.transforms[index]
  const position = transform
    ? toAssemblyLocalPosition(transform.position, artifact.assemblyPosition)
    : toAssemblyLocalPosition(shape.position, artifact.assemblyPosition)
  const rotation = transform?.rotation ?? shape.rotation ?? [0, 0, 0]
  const color = getShapeColor(shape)

  if (shape.kind === 'sphere' || shape.kind === 'hemisphere') {
    return (
      <mesh position={position} rotation={rotation} scale={shape.scale ?? [1, 1, 1]}>
        <sphereGeometry args={[clampR(shape.radius, 0.5), 24, shape.kind === 'hemisphere' ? 12 : 16]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
    )
  }

  if (shape.kind === 'cylinder' || shape.kind === 'hollow-cylinder' || shape.kind === 'capsule' || shape.kind === 'half-cylinder') {
    return (
      <mesh position={position} rotation={rotation}>
        <cylinderGeometry args={[clampR(shape.radius, 0.5), clampR(shape.radius, 0.5), clampD(shape.height, 1), 28]} />
        <meshStandardMaterial color={color} roughness={0.72} wireframe={shape.kind === 'hollow-cylinder'} />
      </mesh>
    )
  }

  if (shape.kind === 'cone') {
    return (
      <mesh position={position} rotation={rotation}>
        <coneGeometry args={[clampR(shape.radius, 0.5), clampD(shape.height, 1), 28]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
    )
  }

  if (shape.kind === 'frustum') {
    return (
      <mesh position={position} rotation={rotation}>
        <cylinderGeometry args={[clampD(shape.radiusTop, 0.25), clampD(shape.radiusBottom, 0.5), clampD(shape.height, 1), 28]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
    )
  }

  if (shape.kind === 'torus') {
    return (
      <mesh position={position} rotation={rotation}>
        <torusGeometry args={[clampD(shape.majorRadius ?? shape.radius, 0.5), clampD(shape.tubeRadius, 0.08), 12, 40]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
    )
  }

  if (shape.kind === 'extrude') {
    return <GeneratedExtrudePreviewShape color={color} position={position} rotation={rotation} shape={shape} />
  }

  if (shape.kind === 'lathe') {
    return <GeneratedLathePreviewShape color={color} position={position} rotation={rotation} shape={shape} />
  }

  if (shape.kind === 'sweep') {
    return <GeneratedSweepPreviewShape color={color} position={position} rotation={rotation} shape={shape} />
  }

  const [x, y, z] = getShapeDimensions(shape)
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={[x, y, z]} />
      <meshStandardMaterial color={color} roughness={0.72} />
    </mesh>
  )
}

function GeneratedGeometryPreview({ artifact }: { artifact: GeneratedGeometryArtifact }) {
  const cameraDistance = useMemo(() => Math.max(3, getArtifactMaxDimension(artifact) * 1.8), [artifact])

  return (
    <div
      aria-label={`Generated geometry preview for ${artifact.title}. Drag with the right mouse button to rotate.`}
      className="h-36 overflow-hidden rounded-lg border border-border/60 bg-black/20"
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas camera={{ position: [cameraDistance, cameraDistance * 0.7, cameraDistance], fov: 42 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.7} />
        <directionalLight intensity={1.8} position={[3, 5, 4]} />
        <group>
          {artifact.shapes.map((shape, index) => (
            <GeneratedPreviewShape artifact={artifact} index={index} key={`${artifact.id}-${index}`} shape={shape} />
          ))}
        </group>
        <OrbitControls
          enablePan={false}
          makeDefault
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        />
      </Canvas>
    </div>
  )
}

function getGeometryArtifactStatus(artifact: GeneratedGeometryArtifact) {
  if (artifact.supersededBy) return `Replaced by ${artifact.supersededBy.slice(-6)}`
  if (artifact.replacedAt) return 'Replaced on canvas'
  if (artifact.placedAt && artifact.savedAt) return 'Placed and saved'
  if (artifact.savedAt) return 'Saved'
  if (artifact.placedAt) return 'Placed'
  return 'Ready'
}

function GeneratedGeometryStaticPreview({ artifact }: { artifact: GeneratedGeometryArtifact }) {
  const colors = artifact.shapes.slice(0, 4).map(getShapeColor)

  return (
    <div className="relative h-36 overflow-hidden rounded-lg border border-border/50 bg-[radial-gradient(circle_at_30%_25%,rgba(166,132,255,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0))]">
      <div className="absolute inset-0 flex items-center justify-center gap-1.5">
        {(colors.length > 0 ? colors : ['#a684ff']).map((color, index) => (
          <span
            className="block rounded-md border border-white/15 shadow-lg"
            key={`${color}-${index}`}
            style={{
              backgroundColor: color,
              height: `${44 + index * 10}px`,
              transform: `translateY(${index % 2 === 0 ? -6 : 6}px) rotate(${index * 8}deg)`,
              width: `${34 + index * 8}px`,
            }}
          />
        ))}
      </div>
      <div className="absolute right-2 bottom-2 rounded-full border border-border/60 bg-background/75 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
        {'\u9759\u6001\u9884\u89c8'}
      </div>
    </div>
  )
}

function GeneratedArtifactCardShell({
  title,
  meta,
  status,
  preview,
  hint,
  actions,
}: {
  title: string
  meta: React.ReactNode
  status: string
  preview: React.ReactNode
  hint: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-2 text-foreground shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{title}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{meta}</div>
        </div>
        <span className="shrink-0 rounded-full border border-[#a684ff]/40 bg-[#a684ff]/10 px-1.5 py-0.5 text-[10px] text-[#c8b6ff]">
          {status}
        </span>
      </div>

      {preview}

      <div className="rounded-lg border border-border/50 bg-accent/20 px-2 py-1 text-[10px] text-muted-foreground">
        {hint}
      </div>

      {actions}
    </div>
  )
}

function GeneratedGeometryCard({
  artifact,
  disabled,
  interactivePreview = true,
  onPlace,
  onReplace,
  onSave,
}: {
  artifact: GeneratedGeometryArtifact
  disabled: boolean
  interactivePreview?: boolean
  onPlace: (artifact: GeneratedGeometryArtifact) => void
  onReplace: (artifact: GeneratedGeometryArtifact) => void
  onSave: (artifact: GeneratedGeometryArtifact) => void
}) {
  const canSave = !artifact.savedAt && !artifact.supersededBy
  const canPlace = !artifact.supersededBy
  const canReplace = Boolean(artifact.replaceNodeIds?.length && !artifact.replacedAt && !artifact.supersededBy)

  return (
    <GeneratedArtifactCardShell
      actions={
        <div className="grid grid-cols-2 gap-1.5">
          {canReplace ? (
            <button
              className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => onReplace(artifact)}
              type="button"
            >
              <Icon className="size-3.5" icon="mdi:swap-horizontal-bold" />
              Replace previous canvas version
            </button>
          ) : null}
          <button
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#a684ff]/50 bg-[#a684ff]/15 px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-[#a684ff]/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !canPlace}
            onClick={() => onPlace(artifact)}
            type="button"
          >
            <Icon className="size-3.5" icon="mdi:arrow-decision-outline" />
            {artifact.placedAt ? 'Place again' : 'Place on canvas'}
          </button>
          <button
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !canSave}
            onClick={() => onSave(artifact)}
            type="button"
          >
            <Icon className="size-3.5" icon="mdi:archive-plus-outline" />
            {artifact.savedAt ? 'Saved' : 'Save to library'}
          </button>
        </div>
      }
      hint={
        interactivePreview
          ? 'Drag the preview to rotate. If it is not right, keep typing revision notes and I will use this geometry as context.'
          : 'Older preview is static. The latest generated result remains interactive.'
      }
      meta={`${artifact.createdNames.length} parts 路 ${artifact.sourceTool} 路 v${artifact.version}`}
      preview={
        interactivePreview ? (
          <GeneratedGeometryPreview artifact={artifact} />
        ) : (
          <GeneratedGeometryStaticPreview artifact={artifact} />
        )
      }
      status={getGeometryArtifactStatus(artifact)}
      title={artifact.title}
    />
  )
}


function getModelArtifactStatus(artifact: GeneratedModelArtifact) {
  if (artifact.placedAt && artifact.savedAt) return '\u5df2\u653e\u7f6e \u00b7 \u5df2\u5b58\u5165\u8d44\u6599\u5e93'
  if (artifact.savedAt) return '\u5df2\u5b58\u5165\u8d44\u6599\u5e93'
  if (artifact.placedAt) return '\u5df2\u653e\u7f6e'
  return '\u8349\u7a3f'
}

function GeneratedModelScene({ asset }: { asset: AssetInput }) {
  const gltf = useGLTF(asset.src)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const dimensions = Array.isArray(asset.dimensions) ? asset.dimensions : [1, 1, 1]
  const maxDimension = Math.max(0.1, dimensions[0] ?? 1, dimensions[1] ?? 1, dimensions[2] ?? 1)
  const scale = 1.7 / maxDimension

  return <primitive object={scene} scale={scale} />
}

function GeneratedModelPreview({ artifact }: { artifact: GeneratedModelArtifact }) {
  return (
    <div
      aria-label={`Generated model preview for ${artifact.title}. Drag with the right mouse button to rotate.`}
      className="h-36 overflow-hidden rounded-lg border border-border/60 bg-black/20"
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas camera={{ position: [2.6, 1.8, 2.6], fov: 42 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.85} />
        <directionalLight intensity={1.8} position={[3, 5, 4]} />
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[0.8, 0.8, 0.8]} />
              <meshStandardMaterial color="#a684ff" wireframe />
            </mesh>
          }
        >
          <GeneratedModelScene asset={artifact.asset} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          makeDefault
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
        />
      </Canvas>
    </div>
  )
}

function articraftResultToModelArtifact(result: ArticraftResult): GeneratedModelArtifact | null {
  if (!result.asset) return null
  return {
    id: `articraft-${result.recordId}`,
    title: result.name,
    sourceTool: 'articraft',
    provider: 'Articraft',
    asset: result.asset,
    userPrompt: result.prompt,
    createdAt: result.savedAt ?? new Date().toISOString(),
    placedAt: result.status === 'imported' ? result.savedAt : undefined,
    savedAt: result.savedAt,
  }
}

function GeneratedModelCard({
  artifact,
  disabled,
  onPlace,
  onSave,
}: {
  artifact: GeneratedModelArtifact
  disabled: boolean
  onPlace: (artifact: GeneratedModelArtifact) => void
  onSave: (artifact: GeneratedModelArtifact) => void
}) {
  const canSave = !artifact.savedAt
  const toolLabel = 'Image to 3D'

  return (
    <GeneratedArtifactCardShell
      actions={
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#a684ff]/50 bg-[#a684ff]/15 px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-[#a684ff]/25 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => onPlace(artifact)}
              type="button"
            >
              <Icon className="size-3.5" icon="mdi:arrow-decision-outline" />
              {artifact.placedAt ? '\u518d\u6b21\u653e\u5230\u753b\u5e03' : '\u653e\u5230\u753b\u5e03'}
            </button>
            <button
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !canSave}
              onClick={() => onSave(artifact)}
              type="button"
            >
              <Icon className="size-3.5" icon="mdi:archive-plus-outline" />
              {artifact.savedAt ? '\u5df2\u4fdd\u5b58' : '\u5b58\u5230\u8d44\u6599\u5e93'}
            </button>
          </div>
        </div>
      }
      hint={'\u4fdd\u5b58\u5230\u8d44\u6599\u5e93\u540e\uff0c\u53ef\u4ee5\u5728\u51e0\u4f55\u642d\u5efa\u4e2d\u91cd\u590d\u4f7f\u7528\u8fd9\u4e2a\u6a21\u578b'}
      meta={`${toolLabel} \u00b7 ${artifact.asset.category ?? 'equipment'}`}
      preview={<GeneratedModelPreview artifact={artifact} />}
      status={getModelArtifactStatus(artifact)}
      title={artifact.title}
    />
  )
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

type AiChatPanelStateSnapshot = {
  conversationId: string
  messages: ChatMessage[]
  input: string
  generationMode: AiGenerationMode
  conversationPurpose?: AiConversationPurpose
  inputExpanded: boolean
  imageAttachment?: ChatImageAttachment
}

function readPersistedAiChatPanelState(): AiChatPanelStateSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AI_CHAT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AiChatPanelStateSnapshot>
    const messages = Array.isArray(parsed.messages) ? (parsed.messages as ChatMessage[]) : []
    const conversationPurpose =
      parsed.conversationPurpose === 'factory' || parsed.conversationPurpose === 'asset'
        ? parsed.conversationPurpose
        : messages.length > 0
          ? 'asset'
          : undefined
    return {
      conversationId:
        typeof parsed.conversationId === 'string'
          ? parsed.conversationId
          : AI_CHAT_DEFAULT_CONVERSATION_ID,
      messages,
      input: typeof parsed.input === 'string' ? parsed.input : '',
      generationMode:
        parsed.generationMode === 'articraft' || parsed.generationMode === 'image-to-3d'
          ? parsed.generationMode
          : 'primitive',
      conversationPurpose,
      inputExpanded: parsed.inputExpanded === true,
      imageAttachment: parsed.imageAttachment,
    }
  } catch {
    return null
  }
}

type AiConversationSummary = {
  id: string
  title: string
  messageCount: number
  activeRunCount: number
  updatedAt: string
}

function buildArticraftResultFromJobData(prompt: string, resultData: Record<string, unknown>) {
  const resultLinks = (resultData.links as Array<Record<string, unknown>>) ?? []
  const resultJoints = (resultData.joints as Array<Record<string, unknown>>) ?? []
  return {
    prompt,
    status: 'ready' as const,
    recordId: String(resultData.recordId ?? ''),
    recordPath: String(resultData.recordPath ?? ''),
    name: String(resultData.name ?? resultData.recordId ?? 'Articraft asset'),
    partCount: resultLinks.length,
    jointCount: resultJoints.length,
    links: resultLinks as unknown as ArticraftLink[],
    joints: resultJoints as unknown as ArticraftJoint[],
    data: resultData as unknown as ArticraftModelData,
  }
}

const aiChatPanelState: AiChatPanelStateSnapshot = {
  conversationId: AI_CHAT_DEFAULT_CONVERSATION_ID,
  messages: [],
  input: '',
  generationMode: 'primitive',
  conversationPurpose: undefined,
  inputExpanded: false,
}

export function AiChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(aiChatPanelState.messages)
  const [input, setInput] = useState(aiChatPanelState.input)
  const [loading, setLoading] = useState(false)
  const [articraftViewerModal, setArticraftViewerModal] = useState<{
    url: string
    title: string
  } | null>(null)
  const [conversationId, setConversationId] = useState(aiChatPanelState.conversationId)
  const [panelHydrated, setPanelHydrated] = useState(false)
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<AiConversationSummary[]>([])
  const [conversationHistoryLoading, setConversationHistoryLoading] = useState(false)
  const [generationMode, setGenerationMode] = useState<AiGenerationMode>(
    aiChatPanelState.generationMode,
  )
  const [conversationPurpose, setConversationPurpose] = useState<AiConversationPurpose | undefined>(
    aiChatPanelState.conversationPurpose,
  )
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(aiChatPanelState.inputExpanded)
  const [imageAttachment, setImageAttachment] = useState<ChatImageAttachment | undefined>(
    aiChatPanelState.imageAttachment,
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const activeRunEventSourcesRef = useRef<Map<string, EventSource>>(new Map())
  const appliedFactoryRunIdsRef = useRef<Set<string>>(new Set())
  const primitiveRunAnalysisRef = useRef<Map<string, string>>(new Map())
  const conversationHistoryNextCursorRef = useRef<string | null>(null)
  const conversationHistoryLoadingRef = useRef(false)
  const latestGeometryArtifactRef = useRef<GeneratedGeometryArtifact | null>(
    latestGeneratedGeometryArtifact(aiChatPanelState.messages),
  )

  const baseUrl = process.env.NEXT_PUBLIC_AI_BASE_URL ?? ''
  const apiKey = process.env.NEXT_PUBLIC_AI_API_KEY ?? ''
  const aiProxyUrl = process.env.NEXT_PUBLIC_AI_PROXY_URL ?? '/api/ai-chat/completions'
  const model = process.env.NEXT_PUBLIC_AI_MODEL ?? 'gpt-4o'
  const articraftViewerUrl = process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765'

  useEffect(() => {
    const persisted = readPersistedAiChatPanelState()
    if (persisted) {
      setConversationId(persisted.conversationId)
      setMessages(persisted.messages)
      setInput(persisted.input)
      setGenerationMode(persisted.generationMode)
      setConversationPurpose(persisted.conversationPurpose)
      setInputExpanded(persisted.inputExpanded)
      setImageAttachment(persisted.imageAttachment)
      latestGeometryArtifactRef.current = latestGeneratedGeometryArtifact(persisted.messages)
    }
    setPanelHydrated(true)
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    aiChatPanelState.messages = messages
    latestGeometryArtifactRef.current =
      latestGeneratedGeometryArtifact(messages) ?? latestGeometryArtifactRef.current
  }, [messages])

  useEffect(() => {
    if (!panelHydrated) return
    if (typeof window === 'undefined') return
    const snapshot: AiChatPanelStateSnapshot & { updatedAt: string } = {
      conversationId,
      messages,
      input,
      generationMode,
      conversationPurpose,
      inputExpanded,
      imageAttachment,
      updatedAt: new Date().toISOString(),
    }
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(snapshot))
  }, [
    conversationId,
    conversationPurpose,
    generationMode,
    imageAttachment,
    input,
    inputExpanded,
    messages,
    panelHydrated,
  ])

  useEffect(() => {
    if (!panelHydrated) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void fetch(`/api/ai-harness/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          activeRunIds: messages
            .map((message) => message.generationRun)
            .filter(
              (job): job is NonNullable<ChatMessage['generationRun']> =>
                job != null && !['succeeded', 'failed', 'cancelled'].includes(job.status),
            )
            .map((job) => job.id),
        }),
        signal: controller.signal,
      }).catch(() => {})
    }, 1000)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [conversationId, messages, panelHydrated])

  useEffect(() => {
    aiChatPanelState.input = input
  }, [input])

  useEffect(() => {
    aiChatPanelState.conversationId = conversationId
  }, [conversationId])

  useEffect(() => {
    aiChatPanelState.generationMode = generationMode
    if (generationMode === 'primitive') setImageAttachment(undefined)
  }, [generationMode])

  useEffect(() => {
    aiChatPanelState.conversationPurpose = conversationPurpose
  }, [conversationPurpose])

  useEffect(() => {
    aiChatPanelState.inputExpanded = inputExpanded
  }, [inputExpanded])

  useEffect(() => {
    aiChatPanelState.imageAttachment = imageAttachment
  }, [imageAttachment])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (loading) setModeMenuOpen(false)
  }, [loading])

  const markGenerationStopped = useCallback((content = 'Generation stopped.') => {
    setMessages((prev) => {
      let stoppedActiveRun = false
      const updated = prev.map((message) => {
        if (!isActiveGenerationRun(message.generationRun)) return message
        stoppedActiveRun = true
        return {
          ...message,
          content,
          generationRun: { ...message.generationRun!, status: 'cancelled' as const },
        }
      })
      if (stoppedActiveRun) return updated

      const next = [...prev]
      const lastIdx = next.length - 1
      const last = next[lastIdx]
      if (
        last?.role === 'assistant' &&
        !last.geometryArtifact &&
        !last.imageTo3dResult &&
        !last.modelArtifact &&
        !last.articraftResult
      ) {
        next[lastIdx] = { ...last, content }
        return next
      }
      return [...next, { role: 'assistant', content }]
    })
  }, [])

  const handleStopGeneration = useCallback(() => {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    const activeRunIds = new Set<string>()
    for (const message of messages) {
      const run = message.generationRun
      if (isActiveGenerationRun(run)) activeRunIds.add(run.id)
    }
    for (const runId of activeRunEventSourcesRef.current.keys()) {
      activeRunIds.add(runId)
    }
    for (const [runId, source] of activeRunEventSourcesRef.current.entries()) {
      source.close()
      activeRunEventSourcesRef.current.delete(runId)
    }
    for (const runId of activeRunIds) {
      void fetch(`/api/ai-harness/runs/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    setLoading(false)
    markGenerationStopped()
  }, [markGenerationStopped, messages])

  const updateGeometryArtifact = useCallback((
    artifactId: string,
    updater: (artifact: GeneratedGeometryArtifact) => GeneratedGeometryArtifact,
  ) => {
    setMessages((prev) => prev.map((message) => {
      if (!message.geometryArtifact || message.geometryArtifact.id !== artifactId) return message
      const nextArtifact = updater(message.geometryArtifact)
      if (latestGeometryArtifactRef.current?.id === artifactId) latestGeometryArtifactRef.current = nextArtifact
      return { ...message, geometryArtifact: nextArtifact }
    }))
  }, [])

  const updateModelArtifact = useCallback((
    artifactId: string,
    updater: (artifact: GeneratedModelArtifact) => GeneratedModelArtifact,
  ) => {
    setMessages((prev) => prev.map((message) => {
      if (!message.modelArtifact || message.modelArtifact.id !== artifactId) return message
      return { ...message, modelArtifact: updater(message.modelArtifact) }
    }))
  }, [])

  const handlePlaceGeometryArtifact = useCallback((artifact: GeneratedGeometryArtifact) => {
    const result = placeGeneratedGeometryArtifact(artifact, { startPlacement: true })
    if (result.nodeIds.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'No valid geometry nodes were created.' },
      ])
      return
    }
    updateGeometryArtifact(artifact.id, (current) => ({
      ...current,
      placedAt: new Date().toISOString(),
      placedNodeIds: result.nodeIds,
    }))
  }, [updateGeometryArtifact])

  const handleReplaceGeometryArtifact = useCallback((artifact: GeneratedGeometryArtifact) => {
    const result = replaceGeneratedGeometryArtifactOnCanvas(artifact)
    if (result.nodeIds.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Could not replace the previous canvas version.' },
      ])
      return
    }
    const replacedAt = new Date().toISOString()
    updateGeometryArtifact(artifact.id, (current) => ({
      ...current,
      placedAt: replacedAt,
      placedNodeIds: result.nodeIds,
      replacedAt,
    }))
  }, [updateGeometryArtifact])

  const handleSaveGeometryArtifact = useCallback((artifact: GeneratedGeometryArtifact) => {
    try {
      const savedAt = saveGeneratedGeometryArtifactToLocalLibrary(artifact)
      updateGeometryArtifact(artifact.id, (current) => ({ ...current, savedAt }))
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `瀛樺叆绱犳潗澶辫触锛?{error instanceof Error ? error.message : String(error)}`,
        },
      ])
    }
  }, [updateGeometryArtifact])


  const handlePlaceModelArtifact = useCallback((artifact: GeneratedModelArtifact) => {
    const editor = useEditor.getState()
    editor.enterFurnishBuildMode({ openItemsPanel: false })
    editor.setMode('select')

    const levelId = useViewer.getState().selection.levelId
    if (!levelId) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '\u65e0\u6cd5\u653e\u7f6e\u6a21\u578b\uff1a\u5f53\u524d\u573a\u666f\u6ca1\u6709\u53ef\u7528\u697c\u5c42\u3002' },
      ])
      return
    }

    const assetTags = artifact.asset.tags ?? []
    const hasExplicitOffset = Array.isArray(artifact.asset.offset)
    const fallbackY = !hasExplicitOffset && assetTags.includes('image-to-3d')
      ? (artifact.asset.dimensions?.[1] ?? 1) / 2
      : 0

    const node = ItemNode.parse({
      name: artifact.asset.name,
      asset: artifact.asset,
      position: [0, fallbackY, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      parentId: levelId,
      metadata: {
        generatedBy: 'ai-chat',
        sourceTool: artifact.sourceTool,
        artifactId: artifact.id,
        provider: artifact.provider,
      },
    })

    useScene.getState().createNode(node, levelId)
    useViewer.getState().setSelection({ selectedIds: [node.id] })
    updateModelArtifact(artifact.id, (current) => ({
      ...current,
      placedAt: new Date().toISOString(),
    }))
  }, [updateModelArtifact])

  const handleSaveModelArtifact = useCallback(async (artifact: GeneratedModelArtifact) => {
    try {
      const res = await fetch('/api/image-to-3d/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: artifact.asset }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const savedAt = isRecord(data) && typeof data.savedAt === 'string'
        ? data.savedAt
        : new Date().toISOString()
      updateModelArtifact(artifact.id, (current) => ({ ...current, savedAt }))
      window.dispatchEvent(new Event('generated-assets:updated'))
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `\u4fdd\u5b58\u5230\u8d44\u6599\u5e93\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}`,
        },
      ])
    }
  }, [updateModelArtifact])

  const handleImageSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!AI_IMAGE_TYPES.has(file.type)) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Please upload a PNG, JPG, or WebP image.' },
      ])
      return
    }
    if (file.size > AI_IMAGE_MAX_BYTES) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Image is too large. Please use an image under 8MB.' },
      ])
      return
    }
    try {
      setImageAttachment({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
      })
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `璇诲彇鍥剧墖澶辫触锛?{error instanceof Error ? error.message : String(error)}`,
        },
      ])
    }
  }, [])

  const executeToolCall = useCallback((
    name: string,
    args: Record<string, unknown>,
    context: { prompt: string; revisionOf?: string; revisionVersion?: number; replaceNodeIds?: string[]; revisionTarget?: GeneratedGeometryArtifact | null }
  ): GeometryToolExecutionResult => executeGeometryToolCall(name, args, context, {
    messages: {
      unknownTool: (toolName) => t('aiChat.unknownTool', { fallback: 'Unknown tool: {name}', params: { name: toolName } }),
      noShapes: t('aiChat.noShapes', 'No geometry could be created.'),
    },
  }), [])

  const callApi = useCallback(
    async (
      apiMessages: ApiMessage[],
      tools?: ComposeTool[],
      signal?: AbortSignal,
    ) => {
      throwIfAborted(signal)
      const hasTools = tools && tools.length > 0
      const body: Record<string, unknown> = {
        model,
        messages: apiMessages,
        ...(hasTools ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: 4096,
      }
      const bodyJson = JSON.stringify(body)
      let res: Response
      try {
        const useProxy = Boolean(aiProxyUrl)
        res = await fetch(useProxy ? aiProxyUrl : `${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(useProxy ? {} : { Authorization: `Bearer ${apiKey}` }),
          },
          signal,
          body: bodyJson,
        })
      } catch (error) {
        throwIfAborted(signal)
        const sizeKb = Math.ceil(bodyJson.length / 1024)
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(
          `AI request failed before sending. ${detail}. Payload size: ${sizeKb}KB. Check AI Base URL, CORS, and schema.`,
        )
      }
      throwIfAborted(signal)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[AI-Chat] API error: ${res.status} ${res.statusText}`, errText)
        throw new Error(`${res.status} ${res.statusText}${errText ? `: ${errText}` : ''}`)
      }

      const data = await res.json()
      throwIfAborted(signal)
      const msg = data.choices?.[0]?.message
      if (!msg) throw new Error('Empty response from AI.')
      return msg as {
        role: string
        content?: string
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
    },
    [baseUrl, model, apiKey, aiProxyUrl],
  )

  const importArticraftResult = useCallback((result: ArticraftResult): number => {
    const levelId = useViewer.getState().selection.levelId
    const scene = useScene.getState()

    if (result.asset) {
      const item = ItemNode.parse({
        name: result.name,
        asset: result.asset,
        position: [0, 0, 0],
        metadata: {
          articraft: {
            ...getArticraftMetadata(result, result.name),
            modelData: result.data,
            joints: result.joints,
            prompt: result.prompt,
          },
        },
      })
      scene.createNode(item, levelId ?? undefined)
      useViewer.getState().setSelection({ selectedIds: [item.id] })
      return 1
    }

    const created = createModelNodes(
      result.data,
      (node, parentId) => {
        scene.createNode(node, parentId)
        return node.id as AnyNodeId
      },
      {
        articulationMode: result.jointCount > 0,
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
        : {
            ...getArticraftMetadata(result, node.name ?? id),
            ...(created.rootNodeIds.includes(id) ? { modelData: result.data, joints: result.joints, prompt: result.prompt } : {}),
          }

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
  }, [])

  const getArticraftViewerUrl = useCallback((recordId: string, tab = 'inspect') => {
    const base = articraftViewerUrl.replace(/\/$/, '')
    return `${base}/viewer?record=${encodeURIComponent(recordId)}&tab=${encodeURIComponent(tab)}`
  }, [articraftViewerUrl])

  const openArticraftViewer = useCallback((recordId: string, tab?: string) => {
    const resolvedTab = tab ?? 'inspect'
    setArticraftViewerModal({
      url: getArticraftViewerUrl(recordId, resolvedTab),
      title: resolvedTab === 'code' ? 'Articraft Code' : 'Articraft Viewer',
    })
  }, [getArticraftViewerUrl])

  const closeArticraftViewerModal = useCallback(() => {
    setArticraftViewerModal(null)
  }, [])

  useEffect(() => {
    if (!articraftViewerModal) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeArticraftViewerModal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [articraftViewerModal, closeArticraftViewerModal])

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
          fallback: 'Imported {count} Articraft assets.',
          params: { count },
        }),
      },
    ])
  }, [importArticraftResult, markArticraftImported])

  const exportArticraftAsset = useCallback(async (result: ArticraftResult, save: boolean) => {
    const res = await fetch('/api/articraft/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordId: result.recordId,
        recordPath: result.recordPath,
        prompt: result.prompt,
        joints: result.joints,
        name: result.name,
        data: result.data,
        save,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
    }
    if (!isRecord(data) || !isMineAsset(data.asset)) {
      throw new Error('Articraft export did not return a usable asset')
    }
    return {
      asset: data.asset,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : save ? new Date().toISOString() : undefined,
    }
  }, [])

  const completeArticraftRun = useCallback(
    async (runId: string, prompt: string, resultData: Record<string, unknown>) => {
      const result: ArticraftResult = buildArticraftResultFromJobData(prompt, resultData)

      try {
        const { asset } = await exportArticraftAsset(result, false)
        result.asset = asset
        result.assetId = asset.id
      } catch (error) {
        result.previewError = error instanceof Error ? error.message : String(error)
      }

      setMessages((prev) => {
        const updated = [...prev]
        const jobMessageIndex = updated.findIndex((message) => message.generationRun?.id === runId)
        const resultMessage: ChatMessage = {
          role: 'assistant',
          content: t('aiChat.articraftReady', 'Articraft result is ready.'),
          generationRun: { id: runId, mode: 'articraft', status: 'succeeded' },
          articraftResult: result,
        }
        if (jobMessageIndex >= 0) {
          updated[jobMessageIndex] = resultMessage
          return updated
        }
        return [...updated, resultMessage]
      })
    },
    [exportArticraftAsset],
  )

  const completeImageTo3DRun = useCallback(
    (runId: string, prompt: string, image: ChatImageAttachment | undefined, resultData: unknown) => {
      const asset = isRecord(resultData) ? resultData.asset : undefined
      if (!isImageTo3DAsset(asset)) {
        throw new Error('Image-to-3D did not return a valid asset.')
      }

      const provider =
        asset.tags?.find((tag) => !['floor', 'generated', 'image-to-3d'].includes(tag)) ??
        'image-to-3d'
      const artifact: GeneratedModelArtifact = {
        id: asset.id,
        title: asset.name ?? asset.id,
        sourceTool: 'image-to-3d',
        provider,
        asset,
        userPrompt: prompt,
        createdAt: new Date().toISOString(),
      }

      setMessages((prev) => {
        const updated = [...prev]
        const runMessageIndex = updated.findIndex((message) => message.generationRun?.id === runId)
        const resultMessage: ChatMessage = {
          role: 'assistant',
          content: `\u56fe\u751f\u5efa\u6a21\u5b8c\u6210\uff1a${asset.name ?? asset.id}`,
          image,
          generationRun: { id: runId, mode: 'image-to-3d', status: 'succeeded' },
          modelArtifact: artifact,
        }
        if (runMessageIndex >= 0) {
          updated[runMessageIndex] = resultMessage
          return updated
        }
        return [...updated, resultMessage]
      })
    },
    [],
  )

  const closeRunEventSource = useCallback((runId: string) => {
    activeRunEventSourcesRef.current.get(runId)?.close()
    activeRunEventSourcesRef.current.delete(runId)
    if (activeRunEventSourcesRef.current.size === 0) setLoading(false)
  }, [])

  const markRunCancelledFromServer = useCallback((runId: string, content = 'Generation cancelled.') => {
    closeRunEventSource(runId)
    setMessages((prev) =>
      prev.map((messageItem) =>
        messageItem.generationRun?.id === runId
          ? {
              ...messageItem,
              content,
              generationRun: { ...messageItem.generationRun!, status: 'cancelled' as const },
            }
          : messageItem,
      ),
    )
  }, [closeRunEventSource])

  const subscribeImageTo3DRun = useCallback(
    (run: { id: string; prompt: string; status?: string; image?: ChatImageAttachment }) => {
      if (activeRunEventSourcesRef.current.has(run.id)) return
      setLoading(true)

      const progressHeader = '正在使用图生建模生成 3D 模型，完成后会保存到物品库...'
      setMessages((prev) => {
        if (prev.some((message) => message.generationRun?.id === run.id)) return prev
        return [
          ...prev,
          {
            role: 'assistant',
            content: progressHeader,
            image: run.image,
            generationRun: {
              id: run.id,
              mode: 'image-to-3d',
              status: run.status === 'queued' ? 'queued' : 'running',
            },
          },
        ]
      })

      const progressLines: string[] = []
      const source = new EventSource(`/api/ai-harness/runs/${encodeURIComponent(run.id)}/events`)
      activeRunEventSourcesRef.current.set(run.id, source)

      source.addEventListener('progress', (event) => {
        const parsed = JSON.parse(event.data) as { message?: string }
        const message = String(parsed.message ?? '').trim()
        if (message) {
          progressLines.push(message)
          if (progressLines.length > ARTICRAFT_PROGRESS_LINE_LIMIT) {
            progressLines.splice(0, progressLines.length - ARTICRAFT_PROGRESS_LINE_LIMIT)
          }
        }
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: formatArticraftProgressMessage(progressHeader, progressLines),
                  generationRun: { id: run.id, mode: 'image-to-3d', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('result', (event) => {
        const parsed = JSON.parse(event.data) as { data?: unknown }
        closeRunEventSource(run.id)
        try {
          completeImageTo3DRun(run.id, run.prompt, run.image, parsed.data)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setMessages((prev) =>
            prev.map((messageItem) =>
              messageItem.generationRun?.id === run.id
                ? {
                    role: 'assistant',
                    content: `鍥剧敓寤烘ā澶辫触锛?{message}`,
                    generationRun: { id: run.id, mode: 'image-to-3d', status: 'failed' },
                  }
                : messageItem,
            ),
          )
          return
        }
      })

      source.addEventListener('error', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        if (!parsed || !isRecord(parsed) || typeof parsed.message !== 'string') return
        closeRunEventSource(run.id)
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  role: 'assistant',
                  content: `鍥剧敓寤烘ā澶辫触锛?{String(parsed.message)}`,
                  generationRun: { id: run.id, mode: 'image-to-3d', status: 'failed' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('status', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        const status =
          isRecord(parsed) && isRecord(parsed.data) && typeof parsed.data.status === 'string'
            ? parsed.data.status
            : undefined
        if (status === 'cancelled') {
          markRunCancelledFromServer(run.id, 'Image-to-3D run cancelled.')
        }
      })
    },
    [closeRunEventSource, completeImageTo3DRun, markRunCancelledFromServer],
  )

  const subscribeArticraftRun = useCallback(
    (job: { id: string; prompt: string; status?: string }) => {
      if (activeRunEventSourcesRef.current.has(job.id)) return
      setLoading(true)

      setMessages((prev) => {
        if (prev.some((message) => message.generationRun?.id === job.id)) return prev
        return [
          ...prev,
          {
            role: 'assistant',
            content: formatArticraftProgressMessage(
              t('aiChat.articraftGenerating', '正在使用 Articraft 生成...'),
              ['已恢复后台生成任务，正在继续读取进度...'],
            ),
            generationRun: {
              id: job.id,
              mode: 'articraft',
              status: job.status === 'queued' ? 'queued' : 'running',
            },
          },
        ]
      })

      const progressHeader = t('aiChat.articraftGenerating', '正在使用 Articraft 生成...')
      const progressLines: string[] = []
      const source = new EventSource(`/api/ai-harness/runs/${encodeURIComponent(job.id)}/events`)
      activeRunEventSourcesRef.current.set(job.id, source)

      source.addEventListener('progress', (event) => {
        const parsed = JSON.parse(event.data) as { message?: string }
        const message = String(parsed.message ?? '').trim()
        if (message) {
          progressLines.push(message)
          if (progressLines.length > ARTICRAFT_PROGRESS_LINE_LIMIT) {
            progressLines.splice(0, progressLines.length - ARTICRAFT_PROGRESS_LINE_LIMIT)
          }
        }
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === job.id
              ? {
                  ...messageItem,
                  content: formatArticraftProgressMessage(progressHeader, progressLines),
                  generationRun: { id: job.id, mode: 'articraft', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('result', (event) => {
        const parsed = JSON.parse(event.data) as { data?: Record<string, unknown> }
        closeRunEventSource(job.id)
        void completeArticraftRun(job.id, job.prompt, parsed.data ?? {})
      })

      source.addEventListener('error', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        if (parsed && isRecord(parsed) && typeof parsed.message === 'string') {
          closeRunEventSource(job.id)
          setMessages((prev) =>
            prev.map((messageItem) =>
              messageItem.generationRun?.id === job.id
                ? {
                    role: 'assistant',
                    content: t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
                      params: { message: String(parsed.message) },
                    }),
                    generationRun: { id: job.id, mode: 'articraft', status: 'failed' },
                  }
                : messageItem,
            ),
          )
          return
        }
      })

      source.addEventListener('status', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        const status =
          isRecord(parsed) && isRecord(parsed.data) && typeof parsed.data.status === 'string'
            ? parsed.data.status
            : undefined
        if (status === 'cancelled') {
          markRunCancelledFromServer(job.id, 'Articraft run cancelled.')
        }
      })
    },
    [closeRunEventSource, completeArticraftRun, markRunCancelledFromServer],
  )

  const completePrimitiveRun = useCallback(
    (runId: string, resultData: unknown) => {
      const data = isRecord(resultData) ? resultData : {}
      const artifact = isRecord(data.artifact)
        ? (data.artifact as unknown as GeneratedGeometryArtifact)
        : undefined
      const results = Array.isArray(data.results)
        ? data.results.map((item) => String(item)).filter(Boolean)
        : []
      const lastContent = typeof data.lastContent === 'string' ? data.lastContent : ''
      const analysis =
        typeof data.analysis === 'string' ? data.analysis : primitiveRunAnalysisRef.current.get(runId)

      setMessages((prev) => {
        const updated = [...prev]
        const runMessageIndex = updated.findIndex((message) => message.generationRun?.id === runId)
        const generate =
          results.length > 0
            ? formatVisibleGeometryResults(results)
            : lastContent || '(no output)'
        const content = formatPrimitiveRunMessage(analysis, generate)
        const resultMessage: ChatMessage = {
          role: 'assistant',
          content,
          generationRun: { id: runId, mode: 'primitive', status: 'succeeded' },
          ...(artifact ? { geometryArtifact: artifact } : {}),
        }
        if (runMessageIndex >= 0) {
          updated[runMessageIndex] = resultMessage
        } else {
          updated.push(resultMessage)
        }
        if (artifact) {
          latestGeometryArtifactRef.current = artifact
          const revisionOf = artifact.revisionOf
          if (revisionOf) {
            for (let i = 0; i < updated.length; i += 1) {
              const message = updated[i]
              if (message?.geometryArtifact?.id === revisionOf) {
                updated[i] = {
                  ...message,
                  geometryArtifact: { ...message.geometryArtifact, supersededBy: artifact.id },
                }
              }
            }
          }
        }
        primitiveRunAnalysisRef.current.delete(runId)
        return updated
      })
    },
    [],
  )

  const subscribePrimitiveRun = useCallback(
    (run: { id: string; prompt: string; status?: string }) => {
      if (activeRunEventSourcesRef.current.has(run.id)) {
        return
      }
      setLoading(true)

      const progressLines: string[] = []
      setMessages((prev) => {
        if (prev.some((message) => message.generationRun?.id === run.id)) return prev
        const pendingIndex = findPendingPrimitiveRunMessageIndex(prev)
        if (pendingIndex >= 0) {
          const next = [...prev]
          next[pendingIndex] = {
            ...next[pendingIndex]!,
            generationRun: {
              id: run.id,
              mode: 'primitive',
              status: run.status === 'queued' ? 'queued' : 'running',
            },
          }
          return next
        }
        return [
          ...prev,
          {
            role: 'assistant',
            content: '**Generate:**\n_恢复后台几何体生成任务，正在读取进度..._',
            generationRun: {
              id: run.id,
              mode: 'primitive',
              status: run.status === 'queued' ? 'queued' : 'running',
            },
          },
        ]
      })

      const source = new EventSource(`/api/ai-harness/runs/${encodeURIComponent(run.id)}/events`)
      activeRunEventSourcesRef.current.set(run.id, source)

      source.addEventListener('progress', (event) => {
        const parsed = JSON.parse(event.data) as { message?: string }
        const message = String(parsed.message ?? '').trim()
        if (message) {
          progressLines.push(message)
          if (progressLines.length > ARTICRAFT_PROGRESS_LINE_LIMIT) {
            progressLines.splice(0, progressLines.length - ARTICRAFT_PROGRESS_LINE_LIMIT)
          }
        }
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: formatPrimitiveRunMessage(
                    primitiveRunAnalysisRef.current.get(run.id),
                    formatArticraftProgressMessage('', progressLines).trim(),
                  ),
                  generationRun: { id: run.id, mode: 'primitive', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('message', (event) => {
        const parsed = safeParseJson(event.data)
        if (!isRecord(parsed) || !isRecord(parsed.data) || parsed.data.stage !== 'analysis') return
        const analysis = typeof parsed.message === 'string' ? parsed.message : ''
        primitiveRunAnalysisRef.current.set(run.id, analysis)
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: formatPrimitiveRunMessage(analysis, '_Generating..._'),
                  generationRun: { id: run.id, mode: 'primitive', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('tool-result', (event) => {
        const parsed = safeParseJson(event.data)
        if (!isRecord(parsed)) return
        const message = typeof parsed.message === 'string' ? parsed.message : ''
        if (!message) return
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: formatPrimitiveRunMessage(
                    primitiveRunAnalysisRef.current.get(run.id),
                    message,
                  ),
                  generationRun: { id: run.id, mode: 'primitive', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('result', (event) => {
        const parsed = JSON.parse(event.data) as { data?: unknown }
        closeRunEventSource(run.id)
        completePrimitiveRun(run.id, parsed.data)
      })

      source.addEventListener('error', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        if (parsed && isRecord(parsed) && typeof parsed.message === 'string') {
          closeRunEventSource(run.id)
          setMessages((prev) =>
            prev.map((messageItem) =>
              messageItem.generationRun?.id === run.id
                ? {
                    role: 'assistant',
                    content: t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
                      params: { message: String(parsed.message) },
                    }),
                    generationRun: { id: run.id, mode: 'primitive', status: 'failed' },
                  }
                : messageItem,
            ),
          )
          return
        }
        void fetch(`/api/ai-harness/runs/${encodeURIComponent(run.id)}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            const currentRun = isRecord(data) && isRecord(data.run) ? data.run : null
            const status =
              currentRun && typeof currentRun.status === 'string' ? currentRun.status : undefined
            if (status === 'succeeded' && currentRun) {
              closeRunEventSource(run.id)
              completePrimitiveRun(run.id, currentRun.result)
              return
            }
            if (status !== 'failed' && status !== 'cancelled') return
            closeRunEventSource(run.id)
            const message =
              currentRun && typeof currentRun.error === 'string'
                ? currentRun.error
                : status === 'cancelled'
                  ? '生成已取消'
                  : '\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'
            setMessages((prev) =>
              prev.map((messageItem) =>
                messageItem.generationRun?.id === run.id
                  ? {
                      role: 'assistant',
                      content:
                        status === 'cancelled'
                          ? message
                          : t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
                              params: { message },
                            }),
                      generationRun: {
                        id: run.id,
                        mode: 'primitive',
                        status: status as 'failed' | 'cancelled',
                      },
                    }
                  : messageItem,
              ),
            )
          })
          .catch(() => {})
      })

      source.addEventListener('status', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        const status =
          isRecord(parsed) && isRecord(parsed.data) && typeof parsed.data.status === 'string'
            ? parsed.data.status
            : undefined
        if (status === 'cancelled') {
          markRunCancelledFromServer(run.id)
        }
      })
    },
    [closeRunEventSource, completePrimitiveRun, markRunCancelledFromServer],
  )

  const completeFactoryRun = useCallback((runId: string, data: unknown) => {
    const appliedNodeIds = appliedFactoryRunIdsRef.current.has(runId)
      ? []
      : applyFactoryRunCreatePatchesToCanvas(data)
    if (appliedNodeIds.length > 0) appliedFactoryRunIdsRef.current.add(runId)
    const displayData =
      isRecord(data) && appliedNodeIds.length > 0
        ? {
            ...data,
            applied: true,
            nodeIds: Array.from(
              new Set([
                ...(Array.isArray(data.nodeIds) ? data.nodeIds.map(String) : []),
                ...appliedNodeIds,
              ]),
            ),
          }
        : data
    setMessages((prev) => {
      const updated = [...prev]
      const runMessageIndex = updated.findIndex((message) => message.generationRun?.id === runId)
      const requiredMissingAssets =
        isRecord(displayData) && Array.isArray(displayData.missingAssets)
          ? displayData.missingAssets.some(
              (item) => isRecord(item) && item.required === true,
            )
          : false
      const succeeded =
        isRecord(displayData) &&
        isRecord(displayData.intent) &&
        displayData.intent.action !== 'missing' &&
        !requiredMissingAssets
      const resultMessage: ChatMessage = {
        role: 'assistant',
        content: formatFactoryRunResult(displayData),
        generationRun: { id: runId, mode: 'factory', status: succeeded ? 'succeeded' : 'failed' },
      }
      if (runMessageIndex >= 0) {
        updated[runMessageIndex] = resultMessage
      } else {
        updated.push(resultMessage)
      }
      return updated
    })
  }, [])

  const subscribeFactoryRun = useCallback(
    (run: { id: string; prompt: string; status?: string }) => {
      if (activeRunEventSourcesRef.current.has(run.id)) return
      setLoading(true)

      const progressLines: string[] = []
      setMessages((prev) => {
        if (prev.some((message) => message.generationRun?.id === run.id)) return prev
        return [
          ...prev,
          {
            role: 'assistant',
            content: '**Factory draft:**\nPreparing factory patch plan...',
            generationRun: {
              id: run.id,
              mode: 'factory',
              status: run.status === 'queued' ? 'queued' : 'running',
            },
          },
        ]
      })

      const source = new EventSource(`/api/ai-harness/runs/${encodeURIComponent(run.id)}/events`)
      activeRunEventSourcesRef.current.set(run.id, source)

      source.addEventListener('progress', (event) => {
        const parsed = safeParseJson(event.data)
        const message = isRecord(parsed) && typeof parsed.message === 'string' ? parsed.message : ''
        if (message.trim()) {
          progressLines.push(message.trim())
          if (progressLines.length > ARTICRAFT_PROGRESS_LINE_LIMIT) {
            progressLines.splice(0, progressLines.length - ARTICRAFT_PROGRESS_LINE_LIMIT)
          }
        }
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: formatArticraftProgressMessage(
                    '**Factory draft:**\nGenerating equipment and patch plan...',
                    progressLines,
                  ),
                  generationRun: { id: run.id, mode: 'factory', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('message', (event) => {
        const parsed = safeParseJson(event.data)
        if (!isRecord(parsed) || !isRecord(parsed.data) || parsed.data.stage !== 'patch-plan') return
        const patchCount =
          typeof parsed.data.patchCount === 'number' ? parsed.data.patchCount : undefined
        const missingAssets = Array.isArray(parsed.data.missingAssets)
          ? parsed.data.missingAssets.length
          : 0
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: [
                    '**Factory draft:**',
                    patchCount == null ? '- Patch plan ready.' : `- Create patches: ${patchCount}`,
                    `- Missing assets: ${missingAssets}`,
                    '- Waiting for final run result...',
                  ].join('\n'),
                  generationRun: { id: run.id, mode: 'factory', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('result', (event) => {
        const parsed = safeParseJson(event.data)
        closeRunEventSource(run.id)
        completeFactoryRun(run.id, isRecord(parsed) ? parsed.data : undefined)
      })

      source.addEventListener('error', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        if (parsed && isRecord(parsed) && typeof parsed.message === 'string') {
          closeRunEventSource(run.id)
          setMessages((prev) =>
            prev.map((messageItem) =>
              messageItem.generationRun?.id === run.id
                ? {
                    role: 'assistant',
                    content: t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
                      params: { message: String(parsed.message) },
                    }),
                    generationRun: { id: run.id, mode: 'factory', status: 'failed' },
                  }
                : messageItem,
            ),
          )
          return
        }
        void fetch(`/api/ai-harness/runs/${encodeURIComponent(run.id)}`, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            const currentRun = isRecord(data) && isRecord(data.run) ? data.run : null
            const status =
              currentRun && typeof currentRun.status === 'string' ? currentRun.status : undefined
            if (status === 'succeeded' && currentRun) {
              closeRunEventSource(run.id)
              completeFactoryRun(run.id, currentRun.result)
              return
            }
            if (status !== 'failed' && status !== 'cancelled') return
            closeRunEventSource(run.id)
            const message =
              currentRun && typeof currentRun.error === 'string'
                ? currentRun.error
                : status === 'cancelled'
                  ? '已取消'
                  : '生成失败，请重试'
            setMessages((prev) =>
              prev.map((messageItem) =>
                messageItem.generationRun?.id === run.id
                  ? {
                      role: 'assistant',
                      content:
                        status === 'cancelled'
                          ? message
                          : t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
                              params: { message },
                            }),
                      generationRun: {
                        id: run.id,
                        mode: 'factory',
                        status: status as 'failed' | 'cancelled',
                      },
                    }
                  : messageItem,
              ),
            )
          })
          .catch(() => {})
      })

      source.addEventListener('status', (event) => {
        const parsed = event instanceof MessageEvent ? safeParseJson(event.data) : null
        const status =
          isRecord(parsed) && isRecord(parsed.data) && typeof parsed.data.status === 'string'
            ? parsed.data.status
            : undefined
        if (status === 'cancelled') {
          markRunCancelledFromServer(run.id)
        }
      })
    },
    [closeRunEventSource, completeFactoryRun, markRunCancelledFromServer, t],
  )

  useEffect(() => {
    if (!panelHydrated) return
    const controller = new AbortController()
    void fetch(`/api/ai-harness/conversations/${encodeURIComponent(conversationId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || controller.signal.aborted) return
        const conversationMessages = Array.isArray(data.conversation?.messages)
          ? (data.conversation.messages as ChatMessage[])
          : []
        if (conversationMessages.length > 0) {
          setMessages((current) =>
            current.length >= conversationMessages.length ? current : conversationMessages,
          )
        }
        const activeRuns = Array.isArray(data.activeRuns) ? data.activeRuns : []
        for (const activeRun of activeRuns) {
          if (!isRecord(activeRun) || typeof activeRun.id !== 'string') continue
          if (activeRun.mode === 'articraft' && typeof activeRun.prompt === 'string') {
            subscribeArticraftRun({
              id: activeRun.id,
              prompt: activeRun.prompt,
              status: typeof activeRun.status === 'string' ? activeRun.status : undefined,
            })
          } else if (activeRun.mode === 'image-to-3d') {
            subscribeImageTo3DRun({
              id: activeRun.id,
              prompt: typeof activeRun.prompt === 'string' ? activeRun.prompt : 'Image to 3D asset',
              status: typeof activeRun.status === 'string' ? activeRun.status : undefined,
            })
          } else if (activeRun.mode === 'primitive') {
            subscribePrimitiveRun({
              id: activeRun.id,
              prompt: typeof activeRun.prompt === 'string' ? activeRun.prompt : 'Geometry object',
              status: typeof activeRun.status === 'string' ? activeRun.status : undefined,
            })
          } else if (activeRun.mode === 'factory') {
            subscribeFactoryRun({
              id: activeRun.id,
              prompt: typeof activeRun.prompt === 'string' ? activeRun.prompt : 'Factory draft',
              status: typeof activeRun.status === 'string' ? activeRun.status : undefined,
            })
          }
        }
      })
      .catch(() => {})

    return () => controller.abort()
  }, [
    conversationId,
    panelHydrated,
    subscribeArticraftRun,
    subscribeFactoryRun,
    subscribeImageTo3DRun,
    subscribePrimitiveRun,
  ])

  useEffect(() => {
    return () => {
      for (const source of activeRunEventSourcesRef.current.values()) {
        source.close()
      }
      activeRunEventSourcesRef.current.clear()
    }
  }, [])

  const refreshConversationHistory = useCallback(async (options?: { append?: boolean }) => {
    const append = options?.append === true
    if (
      append &&
      (!conversationHistoryNextCursorRef.current || conversationHistoryLoadingRef.current)
    )
      return
    const cursor = append ? conversationHistoryNextCursorRef.current : null
    if (!append) conversationHistoryNextCursorRef.current = null
    conversationHistoryLoadingRef.current = true
    setConversationHistoryLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(CONVERSATION_HISTORY_PAGE_SIZE),
      })
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`/api/ai-harness/conversations?${params}`, {
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      const conversations =
        isRecord(data) && Array.isArray(data.conversations)
          ? (data.conversations as AiConversationSummary[])
          : []
      const nextCursor =
        isRecord(data) && typeof data.nextCursor === 'string' ? data.nextCursor : null
      setConversationHistory((prev) => {
        if (!append) return conversations
        const byId = new Map(prev.map((conversation) => [conversation.id, conversation]))
        for (const conversation of conversations) byId.set(conversation.id, conversation)
        return Array.from(byId.values())
      })
      conversationHistoryNextCursorRef.current = nextCursor
    } catch {
      if (!append) {
        setConversationHistory([])
        conversationHistoryNextCursorRef.current = null
      }
    } finally {
      conversationHistoryLoadingRef.current = false
      setConversationHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!panelHydrated) return
    void refreshConversationHistory()
  }, [conversationId, panelHydrated, refreshConversationHistory])

  const closeActiveRunSources = useCallback(() => {
    for (const source of activeRunEventSourcesRef.current.values()) {
      source.close()
    }
    activeRunEventSourcesRef.current.clear()
    setLoading(false)
  }, [])

  const switchConversation = useCallback(
    (nextConversationId: string) => {
      if (!nextConversationId || nextConversationId === conversationId) {
        setConversationHistoryOpen(false)
        return
      }
      closeActiveRunSources()
      setConversationId(nextConversationId)
      setMessages([])
      setInput('')
      setImageAttachment(undefined)
      setConversationPurpose(undefined)
      latestGeometryArtifactRef.current = null
      setConversationHistoryOpen(false)
    },
    [closeActiveRunSources, conversationId],
  )

  const createNewConversation = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-harness/conversations', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      const nextConversationId =
        isRecord(data) && typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!nextConversationId) throw new Error('missing conversationId')
      closeActiveRunSources()
      setConversationId(nextConversationId)
      setMessages([])
      setInput('')
      setImageAttachment(undefined)
      setConversationPurpose(undefined)
      latestGeometryArtifactRef.current = null
      setConversationHistoryOpen(false)
      void refreshConversationHistory()
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Failed to create conversation.' }])
    }
  }, [closeActiveRunSources, refreshConversationHistory])

  const deleteConversation = useCallback(
    async (targetConversationId: string) => {
      try {
        const response = await fetch(
          `/api/ai-harness/conversations/${encodeURIComponent(targetConversationId)}`,
          { method: 'DELETE' },
        )
        if (!response.ok) throw new Error('delete failed')
        setConversationHistory((prev) =>
          prev.filter((conversation) => conversation.id !== targetConversationId),
        )
        if (targetConversationId !== conversationId) return

        const nextResponse = await fetch('/api/ai-harness/conversations', { method: 'POST' })
        const data = await nextResponse.json().catch(() => ({}))
        const nextConversationId =
          isRecord(data) && typeof data.conversationId === 'string' ? data.conversationId : ''
        if (!nextConversationId) throw new Error('missing conversationId')
        closeActiveRunSources()
        setConversationId(nextConversationId)
        setMessages([])
        setInput('')
        setImageAttachment(undefined)
        setConversationPurpose(undefined)
        latestGeometryArtifactRef.current = null
        void refreshConversationHistory()
      } catch {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Failed to delete conversation.' }])
      }
    },
    [closeActiveRunSources, conversationId, refreshConversationHistory],
  )

  const updateArticraftResult = useCallback((
    recordId: string,
    updater: (result: ArticraftResult) => ArticraftResult,
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.articraftResult?.recordId === recordId
          ? { ...message, articraftResult: updater(message.articraftResult) }
          : message,
      ),
    )
  }, [])

  const handleSaveArticraftAsset = useCallback(async (result: ArticraftResult) => {
    try {
      const { asset, savedAt } = await exportArticraftAsset(result, true)
      updateArticraftResult(result.recordId, (current) => ({
        ...current,
        asset,
        assetId: asset.id,
        savedAt,
        previewError: undefined,
      }))
      window.dispatchEvent(new Event('articraft:assets-updated'))
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: asset.id ? `\u5df2\u4fdd\u5b58\u5230\u8d44\u6599\u5e93\uff1a${asset.id}` : '\u5df2\u4fdd\u5b58\u5230\u8d44\u6599\u5e93',
        },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, { role: 'assistant', content: `\u4fdd\u5b58\u5931\u8d25\uff1a${message}` }])
    }
  }, [exportArticraftAsset, updateArticraftResult])

  const handleApplyArticraftPose = useCallback(async (result: ArticraftResult) => {
    let pose = parseArticraftPose(window.location.href, result.recordId)
    if (pose.size === 0 && navigator.clipboard?.readText) {
      try {
        pose = parseArticraftPose(await navigator.clipboard.readText(), result.recordId)
      } catch {
        pose = new Map()
      }
    }
    if (pose.size === 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'No Articraft pose data found. Open the Articraft Viewer and try again.',
        },
      ])
      return
    }

    const scene = useScene.getState()
    const updates = Object.values(scene.nodes).flatMap((node) => {
      const metadata = isRecord(node.metadata) ? node.metadata : {}
      const articraft = isRecord(metadata.articraft) ? metadata.articraft : {}
      const joint = isRecord(metadata.articraftJoint) ? metadata.articraftJoint : null
      const jointName = typeof joint?.jointName === 'string' ? joint.jointName : null
      if (articraft.recordId !== result.recordId || !jointName || !pose.has(jointName) || !joint) {
        return []
      }
      return [
        {
          id: node.id as AnyNodeId,
          data: applyArticraftJointValue(node, joint as ArticraftJointMetadata, pose.get(jointName)!),
        },
      ]
    })

    if (updates.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'No matching Articraft joint metadata was found on the canvas.' },
      ])
      return
    }

    useScene.getState().updateNodes(updates)
    useViewer.getState().setSelection({ selectedIds: [updates[0]!.id] })
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: `Applied Articraft pose to ${updates.length} nodes.` },
    ])
  }, [])

  const handleSelectImageTo3DAsset = useCallback((asset: ImageTo3DResult['asset']) => {
    const editor = useEditor.getState()
    editor.enterFurnishBuildMode({ openItemsPanel: true })
    editor.setCatalogCategory('mine')
    editor.setSelectedItem(asset)
    window.dispatchEvent(new Event('generated-assets:updated'))
  }, [])

  const sendImageTo3DMessage = useCallback(async (text: string, image?: ChatImageAttachment) => {
    if (!image) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '\u8bf7\u5148\u4e0a\u4f20\u4e00\u5f20\u56fe\u7247\uff0c\u518d\u4f7f\u7528\u56fe\u751f\u5efa\u6a21\u3002' },
      ])
      return
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)

    const prompt = text.trim() || '\u6839\u636e\u56fe\u7247\u751f\u6210\u4e00\u4e2a 3D \u6a21\u578b'
    const assetName = text.trim().slice(0, 48) || imageAttachmentBaseName(image)
    const userMsg: ChatMessage = { role: 'user', content: prompt, image }
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: '\u6b63\u5728\u4f7f\u7528\u56fe\u751f\u5efa\u6a21\u751f\u6210 3D \u6a21\u578b\uff0c\u5b8c\u6210\u540e\u4f1a\u4fdd\u5b58\u5230\u7269\u54c1\u5e93...',
    }
    setMessages((prev) => [...prev, userMsg, progressMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          mode: 'image-to-3d',
          prompt,
          image,
          params: {
            displayName: assetName,
            category: 'equipment',
            save: false,
          },
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const runId = isRecord(data) && typeof data.runId === 'string' ? data.runId : ''
      if (!runId) throw new Error('Image-to-3D run was not created')

      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (
          lastIdx >= 0 &&
          updated[lastIdx]?.role === 'assistant' &&
          !updated[lastIdx]?.imageTo3dResult &&
          !updated[lastIdx]?.modelArtifact
        ) {
          updated[lastIdx] = {
            ...updated[lastIdx]!,
            content: formatArticraftProgressMessage(progressMsg.content, ['后台任务已创建，正在等待生成日志...']),
            generationRun: { id: runId, mode: 'image-to-3d', status: 'queued' },
          }
          return updated
        }
        return updated
      })
      subscribeImageTo3DRun({ id: runId, prompt, status: 'queued', image })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped('\u5df2\u505c\u6b62\u56fe\u751f\u5efa\u6a21\u3002')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        const result: ChatMessage = { role: 'assistant', content: `\u56fe\u751f\u5efa\u6a21\u5931\u8d25\uff1a${message}` }
        if (
          lastIdx >= 0 &&
          updated[lastIdx]?.role === 'assistant' &&
          !updated[lastIdx]?.imageTo3dResult
        ) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        if (activeRunEventSourcesRef.current.size === 0) setLoading(false)
      }
    }
  }, [conversationId, markGenerationStopped, subscribeImageTo3DRun])

  const sendArticraftMessage = useCallback(async (text: string, image?: ChatImageAttachment) => {
    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const prompt = text.trim() || '\u8bf7\u6839\u636e\u56fe\u7247\u751f\u6210\u4e00\u4e2a\u53ef\u52a8\u7684\u00203D\u0020\u6a21\u578b'
    const userMsg: ChatMessage = { role: 'user', content: prompt, image }
    const progressHeader = t('aiChat.articraftGenerating', '\u6b63\u5728\u751f\u6210\u0020Articraft\u0020\u6a21\u578b...')
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: progressHeader,
    }
    setMessages((prev) => [...prev, userMsg, progressMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          mode: 'articraft',
          prompt,
          articraftMode: 'articulated',
          ...(image ? { image } : {}),
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const runId = isRecord(data) && typeof data.runId === 'string' ? data.runId : ''
      if (!runId) throw new Error('Articraft job was not created')

      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        if (lastIdx >= 0 && updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx]!,
            content: formatArticraftProgressMessage(progressHeader, ['\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u6b63\u5728\u6392\u961f...']),
            generationRun: { id: runId, mode: 'articraft', status: 'queued' },
          }
        }
        return updated
      })
      subscribeArticraftRun({ id: runId, prompt, status: 'queued' })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped('已取消 Articraft 生成')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        const result: ChatMessage = { role: 'assistant', content: `Articraft 生成失败：${message}` }
        if (
          lastIdx >= 0 &&
          updated[lastIdx]?.role === 'assistant' &&
          !updated[lastIdx]?.articraftResult
        ) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        if (activeRunEventSourcesRef.current.size === 0) setLoading(false)
      }
    }
  }, [conversationId, markGenerationStopped, subscribeArticraftRun])

  // Helper: execute tool_calls from an API response, return result strings.
  // Updates chat messages in-place via setMessages callback.
  const processToolCalls = useCallback(
    async (
      response: { role: string; content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> },
      apiMessages: ApiMessage[],
      tools: ComposeTool[],
      label: string,
      context: { prompt: string; revisionTarget?: GeneratedGeometryArtifact | null },
      signal?: AbortSignal,
    ): Promise<{ results: string[]; lastContent: string; artifact?: GeneratedGeometryArtifact }> => {
      const allResults: string[] = []
      let createdArtifact: GeneratedGeometryArtifact | undefined
      let currentResponse = response
      let lastContent = response.content ?? ''
      let repairAttempt = 0
      let stagnantAttempts = 0
      let bestIssueCount = Number.POSITIVE_INFINITY
      let lastFailureSignature = ''
      const repairMemory: string[] = []
      const seedApiMessages = apiMessages.slice()

      while (currentResponse.tool_calls?.length) {
        throwIfAborted(signal)
        repairAttempt += 1
        const toolResultApiMsgs: ApiMessage[] = []
        const geometryToolCalls = currentResponse.tool_calls.filter((tc) =>
          tc.function.name === 'compose_primitive' ||
          tc.function.name === 'compose_recipe' ||
          tc.function.name === 'compose_assembly' ||
          tc.function.name === 'compose_parts' ||
          tc.function.name === 'compose_robot_arm' ||
          tc.function.name === 'revise_geometry'
        )

        if (geometryToolCalls.length > 1) {
          for (const tc of currentResponse.tool_calls) {
            const result = [
              'Invalid generation plan. Nothing was created.',
              'Call exactly ONE geometry tool for the complete object.',
              'Do not split one object across compose_assembly + compose_recipe + compose_parts + compose_primitive, because attachTo indexes are local to a single tool call.',
            ].join('\n')
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
            allResults.push(result)
          }
        } else {
          for (const tc of currentResponse.tool_calls) {
            throwIfAborted(signal)
            let toolArgs: Record<string, unknown>
            try {
              toolArgs = parseToolArguments(tc.function.arguments)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              const result = [
                'Invalid tool arguments JSON. Nothing was created.',
                `Tool "${tc.function.name}" arguments could not be parsed: ${message}`,
                'Call exactly one geometry tool again with strict JSON arguments only.',
                'Do not include comments, formulas, markdown, trailing commas, or text outside JSON.',
                'Precompute all polygon/profile coordinates as numeric literals before calling the tool.',
              ].join('\n')
              toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
              allResults.push(result)
              continue
            }
            const isRevisionTool = tc.function.name === 'revise_geometry'
            const result = executeToolCall(tc.function.name, toolArgs, {
              prompt: context.prompt,
              revisionOf: isRevisionTool ? context.revisionTarget?.id : undefined,
              revisionVersion: isRevisionTool ? context.revisionTarget?.version : undefined,
              replaceNodeIds: isRevisionTool ? context.revisionTarget?.placedNodeIds : undefined,
              revisionTarget: context.revisionTarget,
            })
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
            allResults.push(result.content)
            if (result.artifact) {
              createdArtifact = result.artifact
              if (
                context.revisionTarget?.placedNodeIds?.length &&
                result.artifact.replaceNodeIds?.length &&
                !result.artifact.replacedAt
              ) {
                const replacement = replaceGeneratedGeometryArtifactOnCanvas(result.artifact)
                if (replacement.nodeIds.length > 0) {
                  const replacedAt = new Date().toISOString()
                  createdArtifact = {
                    ...result.artifact,
                    placedAt: replacedAt,
                    placedNodeIds: replacement.nodeIds,
                    replacedAt,
                  }
                  allResults[allResults.length - 1] = `${result.content}\nAuto-replaced previous canvas version.`
                }
              }
            }
          }
        }

        // Update the placeholder message with results so far
        setMessages((prev) => {
          const updated = [...prev]
          const content = `**${label}:**\n${formatVisibleGeometryResults(allResults)}`
          if (createdArtifact) {
            updated[updated.length - 1] = { role: 'assistant', content, geometryArtifact: createdArtifact }
            if (context.revisionTarget) {
              for (let i = 0; i < updated.length - 1; i += 1) {
                const message = updated[i]
                if (message?.geometryArtifact?.id === context.revisionTarget.id) {
                  updated[i] = {
                    ...message,
                    geometryArtifact: { ...message.geometryArtifact, supersededBy: createdArtifact.id },
                  }
                }
              }
            }
            latestGeometryArtifactRef.current = createdArtifact
          } else {
            updated[updated.length - 1] = { role: 'assistant', content }
          }
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

        if (
          toolResultApiMsgs.some(
            (msg) => typeof msg.content === 'string' && msg.content.startsWith('Created '),
          )
        ) {
          break
        }

        const roundFailureContent = toolResultApiMsgs
          .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
          .filter(Boolean)
          .join('\n')
        const currentIssueCount = Math.max(1, geometryRepairIssues(roundFailureContent).length)
        const currentSignature = geometryRepairSignature(roundFailureContent)
        if (currentIssueCount < bestIssueCount) {
          bestIssueCount = currentIssueCount
          stagnantAttempts = 0
        } else if (currentSignature === lastFailureSignature || currentIssueCount >= bestIssueCount) {
          stagnantAttempts += 1
        } else {
          stagnantAttempts = Math.max(0, stagnantAttempts - 1)
        }
        lastFailureSignature = currentSignature
        repairMemory.push(compactGeometryRepairMemory(repairAttempt, roundFailureContent))

        if (stagnantAttempts >= GEOMETRY_REPAIR_STAGNATION_LIMIT) {
          allResults.push(
            buildPrimitiveRepairStopMessage({
              failureContent: roundFailureContent,
              stagnantLimit: GEOMETRY_REPAIR_STAGNATION_LIMIT,
              compressedMemoryKept: true,
            }),
          )
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              role: 'assistant',
              content: `**${label}:**\n${formatVisibleGeometryResults(allResults)}`,
            }
            return updated
          })
          break
        }

        if (repairAttempt % GEOMETRY_REPAIR_COMPRESSION_INTERVAL === 0) {
          apiMessages.splice(
            0,
            apiMessages.length,
            ...seedApiMessages,
            {
              role: 'user',
              content: [
                'Compressed geometry repair memory from prior invalid tool calls:',
                ...repairMemory.slice(-GEOMETRY_REPAIR_COMPRESSION_INTERVAL),
                '',
                'Use this memory to produce one complete replacement geometry tool call.',
                'Do not repeat a missing semantic role; add the required part, switch to compose_assembly for open-ended complete objects, or switch to the supported compose_parts blueprint for explicit reusable parts.',
              ].join('\n'),
            },
          )
        }

        currentResponse = await callApi(apiMessages, tools, signal)
        if (currentResponse.content) lastContent = currentResponse.content
      }

      return { results: allResults, lastContent, artifact: createdArtifact }
    },
    [callApi, executeToolCall],
  )

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    const attachedImage = generationMode === 'primitive' ? undefined : imageAttachment
    if (loading) return
    if (generationMode === 'image-to-3d' && !attachedImage) {
      await sendImageTo3DMessage(text, attachedImage)
      return
    }
    if ((!text && !attachedImage) || loading) return

    if (generationMode === 'image-to-3d') {
      await sendImageTo3DMessage(text, attachedImage)
      return
    }

    if (generationMode === 'articraft') {
      await sendArticraftMessage(text, attachedImage)
      return
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const userContent =
      text || 'Describe the image and generate a 3D object.'
    const latestGeometryArtifactCandidate =
      latestGeneratedGeometryArtifact(messages) ?? latestGeometryArtifactRef.current
    if (latestGeometryArtifactCandidate) {
      latestGeometryArtifactRef.current = latestGeometryArtifactCandidate
    }
    const preliminaryContextDecision: GeometryContextDecision | null = latestGeometryArtifactCandidate
      ? {
          relationshipToLatestArtifact: 'ambiguous',
          contextPolicy: 'summary_only',
          recommendedRoute: 'model_decide',
          confidence: 0,
          reason: 'Preliminary client context; server-side context resolver makes the final decision.',
        }
      : null
    const modelUserContent = buildGeometryHarnessContext({
      messages,
      latestArtifact: latestGeometryArtifactCandidate,
      userRequest: userContent,
      contextDecision: preliminaryContextDecision,
    })
    const analysisContext = buildGeometryAnalysisContext({
      messages,
      latestArtifact: latestGeometryArtifactCandidate,
      userRequest: userContent,
      contextDecision: preliminaryContextDecision,
    })
    const userMsg: ChatMessage = { role: 'user', content: userContent }
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: '**Generate:**\n_后台几何体生成任务已创建，正在等待分析..._',
    }
    setMessages((prev) => [...prev, userMsg, progressMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          mode: 'primitive',
          prompt: userContent,
          context: {
            analysisContext,
            harnessContext: modelUserContent,
            latestArtifact: null,
            latestArtifactCandidate: latestGeometryArtifactCandidate,
            recentMessages: messages,
          },
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const runId = isRecord(data) && typeof data.runId === 'string' ? data.runId : ''
      if (!runId) throw new Error('Primitive run was not created')
      setMessages((prev) => {
        const updated = [...prev]
        const pendingIndex = findPendingPrimitiveRunMessageIndex(updated)
        const targetIndex =
          pendingIndex >= 0
            ? pendingIndex
            : updated.length > 0 && updated[updated.length - 1]?.role === 'assistant'
              ? updated.length - 1
              : -1
        if (targetIndex >= 0) {
          updated[targetIndex] = {
            ...updated[targetIndex]!,
            generationRun: { id: runId, mode: 'primitive', status: 'queued' },
          }
        }
        return updated
      })
      subscribePrimitiveRun({ id: runId, prompt: userContent, status: 'queued' })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped()
        return
      }
      const errorMsg = String((err as { message?: unknown } | null)?.message ?? err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: t('aiChat.error', {
            fallback: '\u51fa\u9519\u4e86\uff1a{message}',
            params: { message: errorMsg },
          }),
        },
      ])
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        if (activeRunEventSourcesRef.current.size === 0) setLoading(false)
      }
    }
    return
  }, [conversationId, input, messages, loading, generationMode, sendImageTo3DMessage, sendArticraftMessage, subscribePrimitiveRun, markGenerationStopped])

  const selectConversationPurpose = useCallback((purpose: AiConversationPurpose) => {
    setConversationPurpose(purpose)
    setConversationHistoryOpen(false)
    if (purpose === 'factory') {
      setModeMenuOpen(false)
      setImageAttachment(undefined)
    }
  }, [])

  const sendFactoryMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      {
        role: 'assistant',
        content: '**Factory draft:**\nPreparing factory patch plan...',
      },
    ])
    setLoading(true)

    try {
      const res = await fetch('/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          mode: 'factory',
          prompt: text,
          context: {
            recentMessages: messages,
          },
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const runId = isRecord(data) && typeof data.runId === 'string' ? data.runId : ''
      if (!runId) throw new Error('Factory run was not created')

      setMessages((prev) => {
        const updated = [...prev]
        const targetIndex =
          updated.length > 0 && updated[updated.length - 1]?.role === 'assistant'
            ? updated.length - 1
            : -1
        if (targetIndex >= 0) {
          updated[targetIndex] = {
            ...updated[targetIndex]!,
            generationRun: { id: runId, mode: 'factory', status: 'queued' },
          }
        }
        return updated
      })
      subscribeFactoryRun({ id: runId, prompt: text, status: 'queued' })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped()
        return
      }
      const errorMsg = String((err as { message?: unknown } | null)?.message ?? err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: t('aiChat.error', {
                      fallback: '\u51fa\u9519\u4e86\uff1a{message}',
            params: { message: errorMsg },
          }),
        },
      ])
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        if (activeRunEventSourcesRef.current.size === 0) setLoading(false)
      }
    }
  }, [conversationId, input, loading, markGenerationStopped, messages, subscribeFactoryRun, t])

  const handleFactoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendFactoryMessage()
      }
    },
    [sendFactoryMessage],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  const currentMode = AI_GENERATION_MODES.find((mode) => mode.id === generationMode) ?? AI_GENERATION_MODES[0]!
  const resolvedConversationPurpose =
    conversationPurpose ?? (messages.length > 0 ? 'asset' : undefined)
  const showConversationPicker = !resolvedConversationPurpose && messages.length === 0
  const isFactoryConversation = resolvedConversationPurpose === 'factory'
  const isAssetConversation = resolvedConversationPurpose === 'asset'
  const primitiveHasConfig = Boolean(aiProxyUrl || (baseUrl && apiKey))
  const showImageUpload = generationMode === 'image-to-3d' || generationMode === 'articraft'
  const canSend =
    !loading &&
    (generationMode === 'image-to-3d'
      ? true
      : generationMode === 'primitive'
        ? Boolean(input.trim())
        : Boolean(input.trim() || imageAttachment))
  const inputPlaceholder =
    generationMode === 'primitive'
      ? '\u63cf\u8ff0\u8981\u642d\u5efa\u7684\u51e0\u4f55\u4f53...'
      : generationMode === 'image-to-3d'
        ? '\u4e0a\u4f20\u56fe\u7247\u5e76\u63cf\u8ff0\u6a21\u578b...'
        : '\u63cf\u8ff0\u8981\u751f\u6210\u7684\u53ef\u52a8\u6a21\u578b...'
  const latestVisibleGeometryArtifactId = [...messages]
    .reverse()
    .find((message) => message.geometryArtifact && !message.geometryArtifact.supersededBy)
    ?.geometryArtifact?.id



  const articraftViewerModalElement =
    articraftViewerModal && typeof document !== 'undefined'
      ? createPortal(
          <div
            aria-label={articraftViewerModal.title}
            aria-modal="true"
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/62 backdrop-blur-sm"
            role="dialog"
          >
            <div className="relative h-[99vh] w-[99vw] overflow-hidden rounded-2xl border border-white/12 bg-[#09090b] shadow-2xl shadow-black/50">
              <iframe
                className="h-full w-full border-0 bg-[#09090b]"
                src={articraftViewerModal.url}
                title={articraftViewerModal.title}
              />
              <button
                aria-label="关闭 Articraft Viewer"
                className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black text-white shadow-lg shadow-black/35 ring-1 ring-white/20 transition-transform hover:scale-105 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-white/70"
                onClick={closeArticraftViewerModal}
                type="button"
              >
                <Icon className="size-5" icon="mdi:close" />
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className="flex h-full flex-col">
      {articraftViewerModalElement}
      <div className="relative flex items-center justify-end gap-1.5 border-border/50 border-b px-3 py-2.5">
        <button
          aria-expanded={conversationHistoryOpen}
          aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-accent/25 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff]"
          onClick={() => {
            setConversationHistoryOpen((open) => !open)
            void refreshConversationHistory()
          }}
          type="button"
        >
          <Icon className="size-3.5" icon="mdi:history" />
          {t('aiChat.conversationHistory', 'History')}
          <Icon
            className={cn('size-3.5 transition-transform', conversationHistoryOpen && 'rotate-180')}
            icon="mdi:chevron-down"
          />
        </button>
        <button
          aria-label={t('aiChat.newConversation', 'New conversation')}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-accent/25 text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff]"
          onClick={() => void createNewConversation()}
          type="button"
        >
          <Icon className="size-4" icon="mdi:plus" />
        </button>
        {isAssetConversation && !primitiveHasConfig && generationMode === 'primitive' && (
          <span className="text-[10px] text-orange-400">
            {t('aiChat.notConfigured', 'Not configured')}
          </span>
        )}
        {conversationHistoryOpen ? (
          <div className="absolute top-full right-3 z-30 mt-1.5 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-border/70 bg-background/95 p-1.5 shadow-xl backdrop-blur">
            {conversationHistory.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                {t('aiChat.noConversationHistory', 'No history yet')}
              </div>
            ) : (
              <div
                className="max-h-[27rem] overflow-y-auto [scrollbar-color:#3a3a3d_#050505] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a3d] [&::-webkit-scrollbar-track]:bg-[#050505]"
                onScroll={(event) => {
                  const target = event.currentTarget
                  const distanceToBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight
                  if (distanceToBottom < 24) void refreshConversationHistory({ append: true })
                }}
              >
                {conversationHistory.map((conversation) => {
                  const active = conversation.id === conversationId
                  return (
                    <div
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/50',
                        active && 'bg-[#a684ff]/10 text-[#a684ff]',
                      )}
                      key={conversation.id}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        onClick={() => switchConversation(conversation.id)}
                        type="button"
                      >
                        <Icon
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          icon={conversation.activeRunCount > 0 ? 'mdi:progress-clock' : 'mdi:chat-outline'}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium">
                            {conversation.title || t('aiChat.newConversation', 'New conversation')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {conversation.messageCount} {t('aiChat.messageCountLabel', 'messages')} ?{' '}
                            {new Date(conversation.updatedAt).toLocaleString()}
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={t('aiChat.deleteConversation', 'Delete conversation')}
                        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          void deleteConversation(conversation.id)
                        }}
                        type="button"
                      >
                        <Icon className="size-3.5" icon="mdi:trash-can-outline" />
                      </button>
                    </div>
                  )
                })}
                {conversationHistoryLoading ? (
                  <div className="px-2 py-2 text-center text-[10px] text-muted-foreground">
                    {t('aiChat.loadingConversationHistory', 'Loading history...')}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-2 [scrollbar-color:#3a3a3d_#050505] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a3d] [&::-webkit-scrollbar-track]:bg-[#050505]"
      >
        {showConversationPicker && (
          <div className="flex min-h-full items-center justify-center py-8">
            <div className="w-full max-w-sm space-y-3 text-center">
              <div>
                <Icon className="mx-auto mb-2 size-8 text-[#a684ff]" icon="mdi:robot-industrial-outline" />
                <h3 className="font-medium text-foreground text-sm">开始新的 AI 会话</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  选择你要让 AI 帮你完成的任务类型。
                </p>
              </div>
              <button
                className="group w-full rounded-2xl border border-border/70 bg-accent/25 p-3 text-left transition-colors hover:border-[#a684ff]/60 hover:bg-[#a684ff]/10"
                onClick={() => selectConversationPurpose('factory')}
                type="button"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#a684ff]/40 bg-[#a684ff]/10 text-[#a684ff]">
                    <Icon className="size-5" icon="mdi:factory" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground text-sm">
                      创建与修改工厂
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      创建厂房、车间、房间、区域布局，并持续修改当前画布内容。
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground/80">
                      例：创建一个化工车间 / 把刚才房间改成 4m × 4m
                    </span>
                  </span>
                  <Icon
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[#a684ff]"
                    icon="mdi:chevron-right"
                  />
                </div>
              </button>
              <button
                className="group w-full rounded-2xl border border-border/70 bg-accent/25 p-3 text-left transition-colors hover:border-[#a684ff]/60 hover:bg-[#a684ff]/10"
                onClick={() => selectConversationPurpose('asset')}
                type="button"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-400/10 text-violet-300">
                    <Icon className="size-5" icon="mdi:cube-scan" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground text-sm">
                      生成工厂品件与设备
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      生成单个设备、机器、部件或图生模型，可放到画布或保存为品件。
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground/80">
                      例：生成一个水泵 / 生成一个反应釜 / 上传图片生成设备模型
                    </span>
                  </span>
                  <Icon
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[#a684ff]"
                    icon="mdi:chevron-right"
                  />
                </div>
              </button>
            </div>
          </div>
        )}
        {isAssetConversation && messages.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <Icon className="mx-auto mb-2 size-8 opacity-30" icon="mdi:cube-scan" />
            <p>{t('aiChat.placeholder', 'Describe the object you want to create.')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {['Industrial pump', 'Control cabinet', 'Pipe system', 'Conveyor'].map((hint) => (
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
        {isFactoryConversation && messages.length === 0 && (
          <div className="space-y-3 py-5">
            <div className="rounded-2xl border border-[#a684ff]/30 bg-[#a684ff]/10 p-3">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-[#a684ff]" icon="mdi:factory" />
                <span className="font-medium text-foreground text-sm">创建与修改工厂</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                这里将用于通过自然语言创建厂房、车间、房间和工厂布局，并连续修改当前 AI 目标。
              </p>
              <p className="mt-2 text-[10px] leading-relaxed text-amber-300/90">
                当前已接入工厂草稿执行：会生成几何 artifact 与 create patches，但不会自动应用到画布。
              </p>
            </div>
            <div className="grid gap-1.5 text-[11px] text-muted-foreground">
              {['创建一个 20m × 30m 的车间', '把刚才房间改成 4m × 4m', '加一个仓储区和设备区'].map((hint) => (
                <button
                  className="rounded-lg border border-border/60 px-2.5 py-1.5 text-left transition-colors hover:bg-accent hover:text-foreground"
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
              <div className="space-y-1.5">
                {msg.image ? (
                  <img
                    alt={msg.image.name}
                    className="max-h-32 rounded-md border border-border/50 object-contain"
                    src={msg.image.dataUrl}
                  />
                ) : null}
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            ) : msg.modelArtifact ? (
              <GeneratedModelCard
                artifact={msg.modelArtifact}
                disabled={loading}
                onPlace={handlePlaceModelArtifact}
                onSave={handleSaveModelArtifact}
              />
            ) : msg.geometryArtifact ? (
              <GeneratedGeometryCard
                artifact={msg.geometryArtifact}
                disabled={loading}
                interactivePreview={msg.geometryArtifact.id === latestVisibleGeometryArtifactId}
                onPlace={handlePlaceGeometryArtifact}
                onReplace={handleReplaceGeometryArtifact}
                onSave={handleSaveGeometryArtifact}
              />
            ) : msg.toolCalls ? (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="size-3.5 shrink-0" icon="mdi:tools" />
                <span>
                  {t('aiChat.calling', 'Calling tools...')} {msg.toolCalls.map((tc) => tc.name).join(', ')}
                </span>
              </div>
            ) : msg.imageTo3dResult ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2 text-foreground">
                <div className="flex items-start gap-2">
                  <img
                    alt={msg.imageTo3dResult.asset.name ?? msg.imageTo3dResult.asset.id}
                    className="size-14 shrink-0 rounded-md border border-border/50 object-cover"
                    src={msg.imageTo3dResult.asset.thumbnail}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{msg.imageTo3dResult.asset.name ?? msg.imageTo3dResult.asset.id}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {msg.imageTo3dResult.asset.id}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {msg.imageTo3dResult.saved ? '\u5df2\u4fdd\u5b58\u5230\u7269\u54c1\u5e93' : '\u672a\u4fdd\u5b58'} {'\u00b7'} {msg.imageTo3dResult.asset.category ?? 'equipment'}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-violet-400/40 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                    {'\u56fe\u751f\u5efa\u6a21'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => handleSelectImageTo3DAsset(msg.imageTo3dResult!.asset)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:package-variant-closed" />
                    {'\u5728\u7269\u54c1\u5e93\u4e2d\u4f7f\u7528'}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading}
                    onClick={() => sendImageTo3DMessage(msg.imageTo3dResult!.prompt, msg.image)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:refresh" />
                    {'\u91cd\u65b0\u751f\u6210'}
                  </button>
                </div>
              </div>
            ) : msg.articraftResult ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2 text-foreground">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{msg.articraftResult.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      Record: {msg.articraftResult.recordId || '-'}
                    </div>
                    {msg.articraftResult.recordPath ? (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={msg.articraftResult.recordPath}>
                        Path: {msg.articraftResult.recordPath}
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
                    {msg.articraftResult.status === 'imported' ? 'Imported' : 'Ready'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[11px]">
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">Parts</div>
                    <div className="font-medium">{msg.articraftResult.partCount}</div>
                  </div>
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">Joints</div>
                    <div className="font-medium">{msg.articraftResult.jointCount}</div>
                  </div>
                  <div className="rounded border border-border/50 bg-accent/20 px-2 py-1">
                    <div className="text-muted-foreground">Status</div>
                    <div className="font-medium">
                      {msg.articraftResult.status === 'imported' ? 'Imported' : 'Ready'}
                    </div>
                  </div>
                </div>
                {(() => {
                  const artifact = articraftResultToModelArtifact(msg.articraftResult!)
                  if (artifact) return <GeneratedModelPreview artifact={artifact} />
                  if (msg.articraftResult!.previewError) {
                    return (
                      <div className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200">
                        Preview failed: {msg.articraftResult!.previewError}
                      </div>
                    )
                  }
                  return (
                    <div className="rounded border border-border/50 bg-accent/20 px-2 py-3 text-center text-[11px] text-muted-foreground">
                      Preparing the 3D preview, or save to the library to generate a GLB.
                    </div>
                  )
                })()}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => openArticraftViewer(msg.articraftResult!.recordId)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:open-in-new" />
                    Open Articraft Viewer
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => openArticraftViewer(msg.articraftResult!.recordId, 'code')}
                    title={msg.articraftResult.recordPath || undefined}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:file-document-outline" />
                    View source record
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={msg.articraftResult.status === 'imported'}
                    onClick={() => handleImportArticraftResult(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:import" />
                    {msg.articraftResult.asset ? 'Place on canvas' : 'Place on canvas (available after import)'}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId || !!msg.articraftResult.savedAt}
                    onClick={() => handleSaveArticraftAsset(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:archive-plus-outline" />
                    {msg.articraftResult.savedAt ? 'Saved to library' : 'Save to library'}
                  </button>
                  {msg.articraftResult.asset ? (
                    <button
                      className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleSelectImageTo3DAsset(msg.articraftResult!.asset!)}
                      type="button"
                    >
                      <Icon className="size-3.5" icon="mdi:package-variant-closed" />
                      Select generated asset
                    </button>
                  ) : null}
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-cyan-400/50 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => handleApplyArticraftPose(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:axis-arrow" />
                    Apply pose
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading}
                    onClick={() => sendArticraftMessage(msg.articraftResult!.prompt)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:refresh" />
                    Regenerate
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
            {t('aiChat.thinking', 'Thinking...')}
          </div>
        )}
      </div>

      {isAssetConversation ? (
      <div className="border-border/50 border-t px-3 py-2">
        <div className="relative mb-2">
          <button
            aria-expanded={modeMenuOpen}
            aria-haspopup="listbox"
            className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-accent/25 px-2.5 py-2 text-left transition-colors hover:border-[#a684ff]/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loading}
            onClick={() => setModeMenuOpen((open) => !open)}
            type="button"
          >
            <Icon className="size-4 shrink-0 text-[#a684ff]" icon="mdi:tune-variant" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[11px] font-medium text-foreground">{currentMode.label}</span>
                <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                  {currentMode.tech}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{currentMode.description}</div>
            </div>
            <Icon
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform', modeMenuOpen && 'rotate-180')}
              icon="mdi:chevron-down"
            />
          </button>
          {modeMenuOpen ? (
            <div
              className="absolute bottom-full left-0 z-20 mb-1.5 w-full rounded-xl border border-border/70 bg-background/95 p-1.5 shadow-xl backdrop-blur"
              role="listbox"
            >
              {AI_GENERATION_MODES.map((mode) => {
                const active = mode.id === generationMode
                return (
                  <button
                    aria-selected={active}
                    className={cn(
                      'w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'bg-[#a684ff]/15 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                    key={mode.id}
                    onClick={() => {
                      setGenerationMode(mode.id)
                      if (mode.id === 'primitive') setImageAttachment(undefined)
                      setModeMenuOpen(false)
                    }}
                    role="option"
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium">{mode.label}</span>
                      <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                        {mode.tech}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug opacity-80">{mode.description}</div>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        {showImageUpload && imageAttachment ? (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/60 bg-accent/30 p-1.5">
            <img
              alt={imageAttachment.name}
              className="size-10 rounded border border-border/50 object-cover"
              src={imageAttachment.dataUrl}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-foreground">{imageAttachment.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {(imageAttachment.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={loading}
              onClick={() => setImageAttachment(undefined)}
              type="button"
            >
              <Icon className="size-3.5" icon="mdi:close" />
            </button>
          </div>
        ) : null}
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={loading}
          onChange={handleImageSelected}
          ref={imageInputRef}
          type="file"
        />
        <div className="relative">
          <textarea
            className={cn(
              'w-full resize-none rounded-lg border border-border/60 bg-accent/30 px-2.5 py-1.5 pr-8 pb-11 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-[#a684ff]/50 focus:outline-none focus:ring-1 focus:ring-[#a684ff]/30',
              inputExpanded ? 'min-h-[132px]' : 'min-h-[72px]',
            )}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiChat.inputPlaceholder', inputPlaceholder)}
            ref={inputRef}
            rows={inputExpanded ? 6 : 3}
            value={input}
          />
          <button
            className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-[#a684ff]"
            onClick={() => setInputExpanded((expanded) => !expanded)}
            title={inputExpanded ? 'Collapse to 3 rows' : 'Expand to 6 rows'}
            type="button"
          >
            <Icon className="size-3.5" icon={inputExpanded ? 'mdi:arrow-collapse-vertical' : 'mdi:arrow-expand-vertical'} />
          </button>
          {showImageUpload ? (
            <button
              className={cn(
                'absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
                loading ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent hover:text-[#a684ff]',
              )}
              disabled={loading}
              onClick={() => imageInputRef.current?.click()}
              title="Upload image"
              type="button"
            >
              <Icon className="size-4" icon="mdi:image-plus-outline" />
            </button>
          ) : null}
          <button
            className={cn(
              'absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
              loading
                ? 'hover:bg-red-500/10 hover:text-red-400'
                : !canSend
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-accent hover:text-[#a684ff]',
            )}
            disabled={!loading && !canSend}
            onClick={loading ? handleStopGeneration : sendMessage}
            title={loading ? 'Stop generation' : 'Send'}
            type="button"
          >
            <Icon className="size-4" icon={loading ? 'mdi:stop' : 'mdi:send'} />
          </button>
        </div>
      </div>
      ) : isFactoryConversation ? (
        <div className="border-border/50 border-t px-3 py-2">
          <div className="mb-2 rounded-xl border border-border/60 bg-accent/20 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-foreground">
              <Icon className="size-3.5 text-[#a684ff]" icon="mdi:factory" />
              <span className="font-medium">创建与修改工厂</span>
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground">
              当前目标：生成 factory patch plan · 不自动应用到画布
            </div>
          </div>
          <div className="relative">
            <textarea
              className={cn(
                'w-full resize-none rounded-lg border border-border/60 bg-accent/30 px-2.5 py-1.5 pr-8 pb-11 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-[#a684ff]/50 focus:outline-none focus:ring-1 focus:ring-[#a684ff]/30',
                inputExpanded ? 'min-h-[132px]' : 'min-h-[72px]',
              )}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleFactoryKeyDown}
              placeholder="描述你想创建或修改的工厂布局…"
              ref={inputRef}
              rows={inputExpanded ? 6 : 3}
              value={input}
            />
            <button
              className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-[#a684ff]"
              onClick={() => setInputExpanded((expanded) => !expanded)}
              title={inputExpanded ? 'Collapse to 3 rows' : 'Expand to 6 rows'}
              type="button"
            >
              <Icon className="size-3.5" icon={inputExpanded ? 'mdi:arrow-collapse-vertical' : 'mdi:arrow-expand-vertical'} />
            </button>
            <button
              className={cn(
                'absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
                !input.trim() || loading
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-accent hover:text-[#a684ff]',
              )}
              disabled={!input.trim() || loading}
              onClick={sendFactoryMessage}
              title="Send"
              type="button"
            >
              <Icon className="size-4" icon="mdi:send" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default AiChatPanel
