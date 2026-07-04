'use client'

import {
  type AnyNode,
  type AssetInput,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  ItemNode,
  pauseSpaceDetection,
  resumeSpaceDetection,
  sceneRegistry,
  type LevelNode,
  type Vec3,
  useLiveData,
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
import { buildFactoryScenePatchOperations } from '../../../../../lib/factory-scene-patch-apply'
import { validateFactoryScenePatches } from '../../../../../lib/factory-scene-patch-safety'
import { seedFixedFactoryLiveDataSource } from '../../../../../lib/fixed-live-data-source'
import { computeSceneBoundsXZ, pickSceneCameraFocusBounds } from '../../../../../lib/scene-bounds'
import useViewer from '@pascal-app/viewer/store'
import { Icon } from '@iconify/react'
import { Box, Factory } from 'lucide-react'
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
import { buildSelectionCapabilityContext } from '../../../../../lib/object-capabilities'
import { planSemanticLiveDataBinding } from '../../../../../lib/semantic-live-data-bindings'
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
                  'Optional material. Prefer {properties:{color:"#C4956A", roughness:0.6, metalness:0, opacity:0.8, transparent:true}}. For gradients use {properties:{color:"#ef4444", opacity:0.8, transparent:true}, gradient:{type:"linear", space:"uv", axis:"y", stops:[{offset:0,color:"#ef4444",opacity:1},{offset:1,color:"#111827",opacity:1}]}}. Also accepted: {color:"#C4956A"} or {preset:"wood"}.',
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
                'Reusable parts to procedurally expand into primitives. Complete family objects and family components are different intents: car steering wheel, car wheel, aircraft wing, pump impeller, and fan blade are single-component requests, not parent assemblies. For industrial families, prefer family:"pump", family:"conveyor", family:"electrical", or family:"pipe_system" with top-level length/width/height or diameter plus optional parts[].params; the registry fills required parts and clamps unsafe values. For kiosks, booths, ticket booths, vendor stalls, newsstands, small pavilions, and small sheds, use family:"kiosk" with kiosk_body, kiosk_roof, kiosk_opening, kiosk_counter, kiosk_sign, and kiosk_awning. If no dedicated part kind exists for a component, use family:"generic" with generic_body/generic_base/generic_panel/generic_handle/generic_spout/generic_control_panel/generic_display/generic_foot_set/generic_opening/generic_detail_accent before raw compose_primitive. For a standing fan use circular_base + vertical_pole + support_bracket + motor_housing + radial_blades + protective_grill + optional control_knob. For shaft + hub + propeller/impeller/mud-mixer blades use cylinder-like support parts plus propeller_blade_set; do not create a new recipe. For chimneys/smokestacks use chimney_stack with height/radius and warningStripes:true for red-white bands. For desks with visible drawers use desk_top + leg_set + drawer_stack. For electrical/control cabinets use electrical_cabinet + cable_tray + nameplate/warning details. For pipe systems use pipe_run + pipe_elbow + flange_ring/valve_body. For a complete bicycle use wheel_set semanticRole:bicycle_tire count:2 + tube_frame semanticRole:bicycle_frame + fork semanticRole:bicycle_fork + handlebar + saddle + chain_loop; do not invent bicycle_crank/chainring/pedals part kinds. For a complete car use body_shell semanticRole:vehicle_body + wheel_set count:4 semanticRole:vehicle_tire + window_strip semanticRole:vehicle_window variant:vehicle_glasshouse + light_pair + bar_pair; legacy vehicle_* aliases remain accepted. For complete aircraft/airplanes/airliners, use family:"aircraft" with top-level length/primaryColor and optional aircraft_* parts with params; the registry fills fuselage, wings, engines, T-tail, windows, and landing gear. Do not hand-place generic airfoil_blade/streamlined_body/wheel_set parts for complete aircraft. For a water pump / centrifugal blower use skid_base + ribbed_motor_body or rounded_machine_body + volute_casing + inlet_port + outlet_port + flange_ring + optional impeller_blades + control_box. For conveyors use conveyor_frame + roller_array + belt_surface. For tanks use cylindrical_tank plus pipe/flange details. For valves use valve_body plus optional handwheel; set valveStyle/handleStyle for variants such as ball valves instead of inventing internal parts. For factory scenes use gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, platform_ladder, helical_ladder, electrical_cabinet, cable_tray, pipe_run, and pipe_elbow.',
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
                  'helical_ladder',
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
                  'mobile_platform_chassis',
                  'lidar_sensor',
                  'emergency_stop_button',
                  'status_light_strip',
                  'operator_panel',
                  'guard_fence',
                  'pallet_table',
                  'bearing_block',
                  'coupling_guard',
                  'motor_gearbox_unit',
                  'pipe_manifold',
                  'hopper_body',
                  'service_platform',
                ],
                description:
                  'Reusable procedural part. kiosk_body/kiosk_roof/kiosk_opening/kiosk_counter/kiosk_sign/kiosk_awning build small kiosks, ticket booths, vendor stalls, newsstands, small pavilions, and sheds. generic_body/generic_base/generic_panel/generic_handle/generic_spout/generic_control_panel/generic_display/generic_foot_set/generic_opening/generic_detail_accent cover unknown long-tail equipment, simple objects, and devices while preserving semantic part roles. mobile_platform_chassis/lidar_sensor/status_light_strip/emergency_stop_button build AGV/AMR mobile platforms. operator_panel/guard_fence/pallet_table/bearing_block/coupling_guard/motor_gearbox_unit/pipe_manifold/hopper_body/service_platform are reusable industrial equipment accessories for workcells, conveyors, process machines, and packaged equipment. aircraft_fuselage/aircraft_wing/aircraft_engine/aircraft_vertical_stabilizer/aircraft_horizontal_stabilizer/aircraft_landing_gear are family-registry parts for complete aircraft; use parts[].params to tune length, span, engine count/radius, window count, colors, and landing gear. chimney_stack creates a tall tapered industrial chimney with base, rim, lift seams, access door, and optional red-white warning bands. pyramid creates a four-sided pyramid from length/width/height; set truncated:true or topScale/topRadius to make a flat-top truncated pyramid/frustum. vent_grill creates framed grille/louver panels; bolt_pattern creates screws/fasteners; leg_set creates support feet; nameplate creates rating plates; pipe_port/inlet_port/outlet_port create nozzles. propeller_blade_set creates count-based radial propeller/impeller/mixer paddle sets, including taiji-half circular-cropped blades with longitudinal curve; airfoil_blade creates continuous swept/tapered aircraft/turbine-like blades for local blade details, not complete aircraft layout; curved_lens_panel creates tinted non-rectangular lenses/visors; ergonomic_shell creates smooth mouse/controller/appliance shells; streamlined_body creates aerodynamic fuselage/car/train/appliance bodies; lofted_panel creates section-to-section transition fairings/panels. protective_grill creates a shallow domed fan cage; radial_blades creates airfoil-like fan blades; desk_top/leg_set/drawer_stack build office desks; electrical_cabinet/cable_tray build power/control cabinets and tray routes; pipe_run/pipe_elbow build process piping; wheel/wheel_set/window_panel/window_strip/body_shell/tube_frame/fork/light_pair/bar_pair are generic building blocks whose meaning comes from semanticRole; bicycle_* and vehicle_* aliases remain accepted but new calls should prefer generic parts; volute_casing creates pump/blower scroll casing; impeller_blades creates pump/turbine vanes; pipe/inlet/outlet/flange/bolt parts create industrial connection details; ribbed_motor_body, conveyor_frame, roller_array, belt_surface, cylindrical_tank, valve_body, handwheel, gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, platform_ladder, and helical_ladder cover common factory equipment.',
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
                  'LLM-safe adjustable part parameters. Prefer params for family parts instead of raw coordinates. Kiosk examples: kiosk_body {length,width,height,primaryColor}; kiosk_roof {length,width,height,variant:pitch|flat}; kiosk_opening {length,height}; kiosk_counter {length,width,thickness}; kiosk_sign {length,height,accentColor}. Generic examples: generic_body {length,width,height,primaryColor,cornerRadius}; generic_base {length,width,thickness}; generic_spout {length,radius}; generic_control_panel/generic_display/generic_opening {length,height,thickness}. Industrial accessory examples: bearing_block {length,width,height,radius}; coupling_guard {length,radius,thickness}; motor_gearbox_unit {length,height,radius}; pipe_manifold {length,radius,count}; hopper_body {length,width,height}; service_platform {length,width,height,overallHeight}. Vehicle examples: body_shell {length,width,height,primaryColor,vehicleStyle}; wheel_set {count:2|4|6,radius,width,hubColor}; window_strip {height,tint,opacity}. Aircraft examples: aircraft_fuselage {length,width,height,count,primaryColor,accentColor,noseRoundness}; aircraft_wing {length,width,thickness,bladeSweep}; aircraft_engine {count,radius,length,width}; aircraft_landing_gear {length,width,radius}. Values are normalized and clamped by the tool.',
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
                description:
                  'Optional part material, same shape as primitive material, including properties.opacity/transparent and optional gradient stops.',
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
      description:
        'Optional material, e.g. {properties:{color:"#1e3a8a", opacity:0.75, transparent:true}}. For gradients use {properties:{color:"#ef4444", opacity:0.8, transparent:true}, gradient:{type:"linear", space:"uv", axis:"y", stops:[{offset:0,color:"#ef4444",opacity:1},{offset:1,color:"#111827",opacity:1}]}}.',
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
                  'Full PrimitiveMaterialInput for setMaterial. Prefer color for simple recoloring. For gradients use material.gradient with 2-8 stops and material.properties.opacity for whole-material transparency.',
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
  const createPatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'create').length
  const updatePatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'update').length
  const deletePatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'delete').length
  const nodeIds = Array.isArray(result.nodeIds)
    ? result.nodeIds.map((id) => String(id)).filter(Boolean)
    : []
  const missingAssets = Array.isArray(result.missingAssets) ? result.missingAssets : []
  const editSummary = Array.isArray(result.editSummary)
    ? result.editSummary.map(String).filter(Boolean).slice(0, 6)
    : []
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
  const layoutDiagnostics = isRecord(result.layoutDiagnostics)
    ? result.layoutDiagnostics
    : undefined
  const layoutDiagnosticCount = Array.isArray(layoutDiagnostics?.diagnostics)
    ? layoutDiagnostics.diagnostics.length
    : 0
  const layoutStrategy = isRecord(result.layoutStrategy) ? result.layoutStrategy : undefined
  const layoutStyle =
    typeof layoutStrategy?.style === 'string' ? ` via ${layoutStrategy.style}` : ''
  const layoutLine = layoutDiagnostics
    ? `- Layout: ${layoutDiagnostics.fits === true ? 'fits' : 'needs review'}${layoutStyle} (${layoutDiagnosticCount} diagnostics)`
    : undefined
  const qualityReport = isRecord(result.qualityReport) ? result.qualityReport : undefined
  const qualityScore =
    typeof qualityReport?.score === 'number' ? Math.round(qualityReport.score) : undefined
  const qualityPassed =
    typeof qualityReport?.passed === 'boolean' ? qualityReport.passed : undefined
  const qualityIssues = Array.isArray(qualityReport?.issues) ? qualityReport.issues : []
  const qualityIssueLines = qualityIssues
    .slice(0, 3)
    .map((item) => {
      if (!isRecord(item)) return null
      const severity = typeof item.severity === 'string' ? item.severity : 'issue'
      const message = typeof item.message === 'string' ? item.message : undefined
      return message ? `- ${severity}: ${message}` : null
    })
    .filter(Boolean)
  const qualityLine =
    qualityScore == null
      ? undefined
      : `- Quality: ${qualityPassed ? 'passed' : 'needs review'} (${qualityScore}/100, ${qualityIssues.length} issues)`

  return [
    '**Factory draft:**',
    artifactTitle ? `- Geometry artifact: ${artifactTitle}` : '- Geometry artifact: none',
    updatePatchCount > 0 || deletePatchCount > 0
      ? `- Scene patches: ${patches.length} (${createPatchCount} create, ${updatePatchCount} update, ${deletePatchCount} delete)`
      : `- Create patches: ${createPatchCount}`,
    layoutLine,
    qualityLine,
    nodeIds.length ? `- Node ids: ${nodeIds.join(', ')}` : '- Node ids: none',
    geometryRunId ? `- Geometry run: ${geometryRunId}` : undefined,
    `- Applied to canvas: ${applied ? 'yes' : 'no'}`,
    editSummary.length ? `\n**Edits:**\n${editSummary.map((line) => `- ${line}`).join('\n')}` : undefined,
    missingLines.length ? `\n**Missing assets:**\n${missingLines.join('\n')}` : undefined,
    qualityIssueLines.length ? `\n**Quality issues:**\n${qualityIssueLines.join('\n')}` : undefined,
    applied
      ? '\nPatches were applied to the current canvas.'
      : '\nPatches are prepared for review only. Nothing was applied to the canvas.',
  ]
    .filter(Boolean)
    .join('\n')
}

type FactoryRunSummary = {
  title: string
  icon?: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'needs_input'
  description: string
  steps: Array<{ label: string; status: 'done' | 'running' | 'pending' | 'failed' }>
  metrics: Array<{ label: string; value: string }>
  resourceOptions?: Array<{
    id: string
    label: string
    description: string
    recommended?: boolean
    prompt: string
  }>
  details?: string
}

type DeviceGenerationRoute = 'primitive' | 'image-to-3d' | 'articraft'

function deviceRouteLabel(mode: DeviceGenerationRoute) {
  if (mode === 'primitive') return '几何搭建'
  if (mode === 'image-to-3d') return '图生建模'
  return '关节资产'
}

function deviceRunIcon(mode: DeviceGenerationRoute) {
  if (mode === 'primitive') return 'mdi:shape-plus'
  if (mode === 'image-to-3d') return 'mdi:image-sync-outline'
  return 'mdi:axis-arrow'
}

function deviceResultTitle(mode: DeviceGenerationRoute) {
  if (mode === 'primitive') return '设备几何已生成'
  if (mode === 'image-to-3d') return '设备模型已生成'
  return '关节设备已生成'
}

function buildDeviceProgressSummary(input: {
  mode: DeviceGenerationRoute
  message?: string
  detailLines?: string[]
  analysis?: string
}): FactoryRunSummary {
  const details = [
    ...(input.analysis ? [`Analysis: ${input.analysis}`] : []),
    ...(input.detailLines ?? []),
  ]
    .filter(Boolean)
    .slice(-6)
    .join('\n')
  const routeLabel = deviceRouteLabel(input.mode)
  const description =
    input.message?.trim() ||
    `正在按“${routeLabel}”路线创建设备，生成过程会先拆解需求，再输出可应用到画布的资产。`

  if (input.mode === 'image-to-3d') {
    return {
      title: '正在创建设备',
      icon: deviceRunIcon(input.mode),
      status: 'running',
      description,
      steps: [
        { label: '理解设备需求', status: 'done' },
        { label: '图像理解', status: 'done' },
        { label: '图生建模', status: 'running' },
        { label: '资产检查', status: 'pending' },
        { label: '应用到画布', status: 'pending' },
      ],
      metrics: [{ label: '路线', value: routeLabel }],
      ...(details ? { details } : {}),
    }
  }

  if (input.mode === 'articraft') {
    return {
      title: '正在创建设备',
      icon: deviceRunIcon(input.mode),
      status: 'running',
      description,
      steps: [
        { label: '理解设备需求', status: 'done' },
        { label: '结构拆解/连杆拓扑', status: 'done' },
        { label: '关节资产', status: 'running' },
        { label: '姿态/关节检查', status: 'pending' },
        { label: '应用到画布', status: 'pending' },
      ],
      metrics: [{ label: '路线', value: routeLabel }],
      ...(details ? { details } : {}),
    }
  }

  return {
    title: '正在创建设备',
    icon: deviceRunIcon(input.mode),
    status: 'running',
    description,
    steps: [
      { label: '理解设备需求', status: 'done' },
      { label: '设备画像/Profile 匹配', status: 'done' },
      { label: '结构拆解/部件拓扑', status: input.analysis ? 'done' : 'running' },
      { label: '几何搭建', status: 'running' },
      { label: '质量检查', status: 'pending' },
      { label: '应用到画布', status: 'pending' },
    ],
    metrics: [{ label: '路线', value: routeLabel }],
    ...(details ? { details } : {}),
  }
}

function buildPrimitiveResultSummary(artifact: GeneratedGeometryArtifact | undefined): FactoryRunSummary {
  const quality = artifact?.profileQuality
  const qualityScore = typeof quality?.overallScore === 'number' ? Math.round(quality.overallScore * 100) : undefined
  const hasIssues = Boolean(quality?.issues?.length)
  const shapeCount = artifact?.shapes.length ?? 0
  const createdCount = artifact?.createdNames.length ?? 0
  const sourceArgs = artifact?.sourceArgs ?? {}
  const profileId =
    typeof sourceArgs.deviceProfile === 'string'
      ? sourceArgs.deviceProfile
      : typeof sourceArgs.profile === 'string'
        ? sourceArgs.profile
        : undefined
  const metrics: FactoryRunSummary['metrics'] = [
    { label: '几何体', value: `${shapeCount}` },
    { label: '部件', value: `${createdCount}` },
  ]
  if (profileId) metrics.push({ label: 'Profile', value: profileId })
  if (qualityScore != null) metrics.push({ label: '质量', value: `${qualityScore}/100` })

  return {
    title: artifact ? deviceResultTitle('primitive') : '设备几何需要检查',
    icon: deviceRunIcon('primitive'),
    status: artifact && !hasIssues ? 'succeeded' : artifact ? 'failed' : 'failed',
    description: artifact
      ? '已生成可编辑的设备几何，可继续修改、保存到资料库，或应用到当前画布。'
      : '这次几何生成没有返回可用设备资产。',
    steps: [
      { label: '理解设备需求', status: 'done' },
      { label: profileId ? `设备画像/Profile ${profileId}` : '设备画像/Profile 匹配', status: 'done' },
      { label: '结构拆解/部件拓扑', status: 'done' },
      { label: '几何搭建', status: artifact ? 'done' : 'failed' },
      {
        label: `质量检查 ${hasIssues ? '需复核' : '通过'}`,
        status: hasIssues ? 'failed' : 'done',
      },
      { label: '应用到画布', status: artifact?.placedAt ? 'done' : 'pending' },
    ],
    metrics,
  }
}

function buildPrimitiveResourceSelectionSummary(resourceSelection: unknown): FactoryRunSummary {
  const candidates =
    isRecord(resourceSelection) && Array.isArray(resourceSelection.candidates)
      ? resourceSelection.candidates
      : []
  const resourceOptions = candidates
    .map((candidate) => {
      if (!isRecord(candidate)) return null
      const id = typeof candidate.profileId === 'string' ? candidate.profileId : ''
      const label =
        typeof candidate.matchedLabel === 'string' && candidate.matchedLabel.trim()
          ? candidate.matchedLabel
          : typeof candidate.name === 'string'
            ? candidate.name
            : id
      const description =
        typeof candidate.usageHint === 'string'
          ? candidate.usageHint
          : typeof candidate.description === 'string'
            ? candidate.description
            : '适合该行业包中同名或近义设备场景。'
      return id
        ? {
            id,
            label,
            description,
            recommended: candidate.recommended === true,
            prompt: `生成一个${label}（${id}）`,
          }
        : null
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
  return {
    title: '需要选择设备资源',
    icon: deviceRunIcon('primitive'),
    status: 'needs_input',
    description:
      '已从行业资源包找到多个可能设备。默认建议选带“推荐”的设备；如果你的工艺语义更具体，再选择对应设备。',
    steps: [
      { label: '理解设备需求', status: 'done' },
      { label: '行业资源匹配', status: 'done' },
      { label: '等待选择设备', status: 'pending' },
      { label: '几何搭建', status: 'pending' },
      { label: '应用到画布', status: 'pending' },
    ],
    metrics: [
      { label: '候选', value: `${candidates.length}` },
      { label: '路线', value: deviceRouteLabel('primitive') },
    ],
    resourceOptions,
  }
}

function buildImageTo3DResultSummary(artifact: GeneratedModelArtifact): FactoryRunSummary {
  return {
    title: deviceResultTitle('image-to-3d'),
    icon: deviceRunIcon('image-to-3d'),
    status: 'succeeded',
    description: '图生建模已生成设备外观资产，可应用到画布或保存到资料库。',
    steps: [
      { label: '理解设备需求', status: 'done' },
      { label: '图像理解', status: 'done' },
      { label: '图生建模', status: 'done' },
      { label: '资产检查 通过', status: 'done' },
      { label: '应用到画布', status: artifact.placedAt ? 'done' : 'pending' },
    ],
    metrics: [
      { label: '路线', value: deviceRouteLabel('image-to-3d') },
      { label: 'Provider', value: artifact.provider },
      { label: '资产', value: artifact.asset.id },
    ],
  }
}

function buildArticraftResultSummary(result: ArticraftResult): FactoryRunSummary {
  return {
    title: deviceResultTitle('articraft'),
    icon: deviceRunIcon('articraft'),
    status: 'succeeded',
    description: '已生成带 links/joints 的设备资产，可查看源记录、导入画布并应用姿态。',
    steps: [
      { label: '理解设备需求', status: 'done' },
      { label: '结构拆解/连杆拓扑', status: 'done' },
      { label: '关节资产', status: result.jointCount > 0 ? 'done' : 'failed' },
      { label: `姿态/关节检查 ${result.jointCount > 0 ? '通过' : '需复核'}`, status: result.jointCount > 0 ? 'done' : 'failed' },
      { label: '应用到画布', status: result.status === 'imported' ? 'done' : 'pending' },
    ],
    metrics: [
      { label: '路线', value: deviceRouteLabel('articraft') },
      { label: 'Parts', value: `${result.partCount}` },
      { label: 'Joints', value: `${result.jointCount}` },
    ],
  }
}

function factoryPlanKindLabel(value: unknown) {
  if (value === 'layout') return '工厂/建筑布局'
  if (value === 'process_line') return '工艺产线'
  if (value === 'catalog_item') return '固定资产'
  if (value === 'geometry') return '设备几何'
  if (value === 'missing') return '未匹配需求'
  return '工厂任务'
}

function factoryStageLabel(value: unknown) {
  if (value === 'factory-plan') return '规划工厂方案'
  if (value === 'selection-edit') return '修改已选对象'
  if (value === 'patch-plan') return '生成场景变更'
  return '处理工厂请求'
}

function hasReadableHanText(value: string | undefined) {
  return typeof value === 'string' && /[\u4e00-\u9fff]/.test(value)
}

function buildFactoryProgressSummary(input: {
  stage?: unknown
  planKind?: unknown
  message?: string
  patchCount?: number
  missingAssetCount?: number
  detailLines?: string[]
}): FactoryRunSummary {
  const stageLabel = factoryStageLabel(input.stage)
  const planLabel = factoryPlanKindLabel(input.planKind)
  const details = input.detailLines?.filter(Boolean).slice(-6).join('\n')
  const description = hasReadableHanText(input.message)
    ? input.message!.trim()
    : input.stage === 'patch-plan'
      ? '场景变更已经生成，正在等待最终结果。'
      : `${stageLabel}中，系统会把机器数据隐藏在后台。`
  const metrics: FactoryRunSummary['metrics'] = []
  if (input.patchCount != null) metrics.push({ label: '场景变更', value: `${input.patchCount}` })
  if (input.missingAssetCount != null) {
    metrics.push({ label: '未解析资产', value: `${input.missingAssetCount}` })
  }
  return {
    title: '正在创建工厂',
    status: 'running',
    description,
    steps: [
      { label: '理解需求', status: 'done' },
      {
        label: planLabel === '工厂任务' ? stageLabel : planLabel,
        status: input.stage === 'patch-plan' ? 'done' : 'running',
      },
      { label: '生成场景变更', status: input.stage === 'patch-plan' ? 'running' : 'pending' },
      { label: '应用到画布', status: 'pending' },
    ],
    metrics,
    ...(details ? { details } : {}),
  }
}

function buildFactoryResultSummary(data: unknown): FactoryRunSummary {
  const result = isRecord(data) ? data : {}
  const patches = Array.isArray(result.patches) ? result.patches : []
  const createPatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'create').length
  const updatePatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'update').length
  const deletePatchCount = patches.filter((patch) => isRecord(patch) && patch.op === 'delete').length
  const nodeIds = Array.isArray(result.nodeIds)
    ? result.nodeIds.map((id) => String(id)).filter(Boolean)
    : []
  const created = Array.isArray(result.created)
    ? result.created.map((item) => String(item)).filter(Boolean)
    : []
  const missingAssets = Array.isArray(result.missingAssets) ? result.missingAssets : []
  const requiredMissingAssets = missingAssets.some((item) => isRecord(item) && item.required === true)
  const qualityReport = isRecord(result.qualityReport) ? result.qualityReport : undefined
  const qualityScore =
    typeof qualityReport?.score === 'number' ? Math.round(qualityReport.score) : undefined
  const qualityPassed =
    typeof qualityReport?.passed === 'boolean' ? qualityReport.passed : undefined
  const qualityIssues = Array.isArray(qualityReport?.issues) ? qualityReport.issues : []
  const layoutDiagnostics = isRecord(result.layoutDiagnostics)
    ? result.layoutDiagnostics
    : undefined
  const layoutFits = typeof layoutDiagnostics?.fits === 'boolean' ? layoutDiagnostics.fits : undefined
  const artifact = isRecord(result.artifact) ? result.artifact : undefined
  const artifactTitle =
    typeof artifact?.title === 'string'
      ? artifact.title
      : typeof artifact?.id === 'string'
        ? artifact.id
        : undefined
  const intent = isRecord(result.intent) ? result.intent : undefined
  const action = typeof intent?.action === 'string' ? intent.action : undefined
  const succeeded = action !== 'missing' && !requiredMissingAssets
  const applied = result.applied === true
  const details = formatFactoryRunResult(result)

  const readableCreated = created.slice(0, 4).join('、')
  const description = succeeded
    ? applied
      ? `已生成并应用到画布${readableCreated ? `：${readableCreated}` : ''}。`
      : '已生成场景变更，等待应用到画布。'
    : '这次请求没有完全生成，可查看缺失项或质量提示。'

  const metrics: FactoryRunSummary['metrics'] = [
    { label: '新增', value: `${createPatchCount}` },
    { label: '修改', value: `${updatePatchCount}` },
    { label: '删除', value: `${deletePatchCount}` },
    { label: '节点', value: `${nodeIds.length}` },
  ]
  if (qualityScore != null) metrics.push({ label: '质量', value: `${qualityScore}/100` })
  if (missingAssets.length > 0) metrics.push({ label: '缺失', value: `${missingAssets.length}` })

  return {
    title: succeeded ? '工厂已创建' : '工厂创建需要检查',
    status: succeeded ? 'succeeded' : 'failed',
    description,
    steps: [
      { label: '理解需求', status: 'done' },
      { label: factoryPlanKindLabel(isRecord(result.plan) ? result.plan.kind : undefined), status: 'done' },
      {
        label: artifactTitle ? `生成 ${artifactTitle}` : '生成场景变更',
        status: patches.length > 0 ? 'done' : succeeded ? 'done' : 'failed',
      },
      { label: '应用到画布', status: applied ? 'done' : succeeded ? 'pending' : 'failed' },
      ...(qualityScore == null
        ? []
        : [
            {
              label: `质量检查 ${qualityPassed ? '通过' : '需复核'}`,
              status: qualityPassed ? ('done' as const) : ('failed' as const),
            },
          ]),
      ...(layoutFits == null
        ? []
        : [
            {
              label: `布局检查 ${layoutFits ? '通过' : '需复核'}`,
              status: layoutFits ? ('done' as const) : ('failed' as const),
            },
          ]),
      ...(qualityIssues.length > 0
        ? [
            {
              label: `质量提示 ${qualityIssues.length} 条`,
              status: qualityPassed ? ('done' as const) : ('failed' as const),
            },
          ]
        : []),
    ],
    metrics,
    details,
  }
}

function buildFactorySelectionSnapshot() {
  const scene = useScene.getState()
  const selectedIds = useViewer.getState().selection.selectedIds.map(String).filter(Boolean)
  if (!selectedIds.length) return undefined
  const capabilityContext = buildSelectionCapabilityContext({ nodes: scene.nodes, selectedIds })

  const nodes: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  const collect = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = scene.nodes[id as AnyNodeId]
    if (!node) return
    const record = node as unknown as Record<string, unknown>
    nodes.push({
      id: node.id,
      type: node.type,
      name: typeof node.name === 'string' ? node.name : undefined,
      parentId: typeof node.parentId === 'string' ? node.parentId : undefined,
      children: Array.isArray(record.children) ? record.children.map(String) : undefined,
      color: typeof record.color === 'string' ? record.color : undefined,
      kind: typeof record.kind === 'string' ? record.kind : undefined,
      shellColor: typeof record.shellColor === 'string' ? record.shellColor : undefined,
      length: typeof record.length === 'number' ? record.length : undefined,
      width: typeof record.width === 'number' ? record.width : undefined,
      height: typeof record.height === 'number' ? record.height : undefined,
      depth: typeof record.depth === 'number' ? record.depth : undefined,
      thickness: typeof record.thickness === 'number' ? record.thickness : undefined,
      radius: typeof record.radius === 'number' ? record.radius : undefined,
      majorRadius: typeof record.majorRadius === 'number' ? record.majorRadius : undefined,
      tubeRadius: typeof record.tubeRadius === 'number' ? record.tubeRadius : undefined,
      position: Array.isArray(record.position) ? record.position : undefined,
      rotation: Array.isArray(record.rotation) ? record.rotation : undefined,
      scale: Array.isArray(record.scale) ? record.scale : undefined,
      material: isRecord(record.material) ? record.material : undefined,
      materialPreset: typeof record.materialPreset === 'string' ? record.materialPreset : undefined,
      metadata: isRecord(record.metadata) ? record.metadata : undefined,
    })
    if (node.type === 'assembly' && Array.isArray(record.children)) {
      for (const childId of record.children) {
        if (typeof childId === 'string') collect(childId)
      }
    }
  }

  for (const id of selectedIds) collect(id)
  return nodes.length
    ? {
        selectedIds,
        nodes,
        capabilities: capabilityContext?.profiles ?? [],
        capabilitySummary: capabilityContext?.summary,
      }
    : undefined
}

function buildCurrentSelectionCapabilityProfiles() {
  const scene = useScene.getState()
  const selectedIds = useViewer.getState().selection.selectedIds.map(String).filter(Boolean)
  return buildSelectionCapabilityContext({ nodes: scene.nodes, selectedIds })?.profiles
}

function finiteSitePoint(value: unknown): [number, number] | null {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return null
}

function boundsFromSitePoints(points: unknown[]) {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hasPoint = false
  for (const point of points) {
    const parsed = finiteSitePoint(point)
    if (!parsed) continue
    minX = Math.min(minX, parsed[0])
    maxX = Math.max(maxX, parsed[0])
    minZ = Math.min(minZ, parsed[1])
    maxZ = Math.max(maxZ, parsed[1])
    hasPoint = true
  }
  if (!hasPoint) return null
  return {
    min: [minX, minZ],
    max: [maxX, maxZ],
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxZ - minZ],
  }
}

function isDefaultSitePoints(points: unknown[]) {
  const expected = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
  return (
    points.length === expected.length &&
    points.every((point, index) => {
      const parsed = finiteSitePoint(point)
      const expectedPoint = expected[index]
      return Boolean(
        parsed && expectedPoint && parsed[0] === expectedPoint[0] && parsed[1] === expectedPoint[1],
      )
    })
  )
}

function buildFactorySiteContext(nodes: Record<AnyNodeId, AnyNode>) {
  const site = Object.values(nodes).find((node) => node?.type === 'site')
  const polygon = (site as unknown as { polygon?: { points?: unknown } } | undefined)?.polygon
  const points = Array.isArray(polygon?.points) ? polygon.points : null
  if (!site || !points) return null
  const bounds = boundsFromSitePoints(points)
  if (!bounds) return null
  return {
    id: site.id,
    bounds,
    isDefault: isDefaultSitePoints(points),
  }
}

function buildFactorySceneContext() {
  const scene = useScene.getState()
  const bounds = computeSceneBoundsXZ(scene.nodes as Parameters<typeof computeSceneBoundsXZ>[0])
  const site = buildFactorySiteContext(scene.nodes)
  if (!bounds && !site) return undefined
  return {
    ...(bounds ? { bounds } : {}),
    ...(site ? { site } : {}),
    nodeCount: Object.keys(scene.nodes).length,
  }
}

function resolveBuildingIdForLevel(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string | null | undefined,
  preferredBuildingId?: string | null,
) {
  if (
    preferredBuildingId &&
    nodes[preferredBuildingId as AnyNodeId]?.type === 'building'
  ) {
    return preferredBuildingId
  }
  if (!levelId) return null

  const level = nodes[levelId as AnyNodeId]
  const parentId = typeof level?.parentId === 'string' ? level.parentId : null
  if (parentId && nodes[parentId as AnyNodeId]?.type === 'building') {
    return parentId
  }

  const owner = Object.values(nodes).find(
    (node): node is BuildingNode =>
      node?.type === 'building' &&
      Array.isArray(node.children) &&
      node.children.includes(levelId as LevelNode['id']),
  )
  return owner?.id ?? null
}

function buildFactoryPlacementContextSnapshot() {
  const scene = useScene.getState()
  const selection = useViewer.getState().selection
  let parentId = selection.levelId
  let buildingId = resolveBuildingIdForLevel(scene.nodes, parentId, selection.buildingId)

  if (!parentId) {
    const fallbackBuilding =
      (buildingId ? scene.nodes[buildingId as AnyNodeId] : undefined) ??
      Object.values(scene.nodes).find((node): node is BuildingNode => node?.type === 'building')
    if (fallbackBuilding?.type === 'building') {
      buildingId = fallbackBuilding.id
      const fallbackLevelId = fallbackBuilding.children.find(
        (childId): childId is LevelNode['id'] =>
          scene.nodes[childId as AnyNodeId]?.type === 'level',
      )
      parentId = fallbackLevelId ?? null
    }
  }

  return {
    ...(parentId ? { parentId } : {}),
    ...(buildingId ? { buildingId } : {}),
  }
}

function applyFactoryRunPatchesToCanvas(data: unknown): string[] {
  const result = isRecord(data) ? data : {}
  if (result.applied === true) return []
  const qualityReport = isRecord(result.qualityReport) ? result.qualityReport : undefined
  if (qualityReport?.passed === false) {
    console.warn('[factory-agent] Refused factory patches that failed quality gate', qualityReport)
    return []
  }
  const patches = Array.isArray(result.patches) ? result.patches : []
  if (patches.length === 0) return []

  const scene = useScene.getState()
  const selectedLevelId = useViewer.getState().selection.levelId
  const safety = validateFactoryScenePatches(patches, {
    allowProcessLineCatalogItems: true,
    existingNodeIds: Object.keys(scene.nodes),
    fallbackParentId: selectedLevelId,
  })
  if (!safety.safe) {
    console.warn('[factory-agent] Refused unsafe scene patches', safety.issues)
    return []
  }

  const { createOps, createdIds, deleteIds, updateOps, updatedIds } =
    buildFactoryScenePatchOperations(patches, {
      existingNodeIds: Object.keys(scene.nodes),
      fallbackParentId: selectedLevelId,
    })
  const createdLevelNodes = createOps
    .map(({ node }) => node)
    .filter((node): node is LevelNode => node.type === 'level')
    .sort((a, b) => a.level - b.level)

  pauseSpaceDetection()
  try {
    if (createOps.length > 0) {
      scene.createNodes(createOps)
    }
    if (updateOps.length > 0) {
      scene.updateNodes(updateOps)
    }
    if (deleteIds.length > 0) {
      scene.deleteNodes(deleteIds)
    }
  } finally {
    resumeSpaceDetection()
  }

  if (createdLevelNodes.length > 0) {
    const topLevel = createdLevelNodes[createdLevelNodes.length - 1]!
    const nodes = useScene.getState().nodes
    const buildingId = resolveBuildingIdForLevel(
      nodes,
      topLevel.id,
      typeof topLevel.parentId === 'string' ? topLevel.parentId : null,
    )
    const viewer = useViewer.getState()
    viewer.setLevelMode('stacked')
    viewer.setSelection({
      ...(buildingId ? { buildingId: buildingId as BuildingNode['id'] } : {}),
      levelId: topLevel.id,
    })
  } else if (createdIds.length > 0) {
    useViewer.getState().setSelection({ selectedIds: [createdIds[0]!] })
  } else if (deleteIds.length > 0) {
    const deleted = new Set(deleteIds.map(String))
    const remainingSelectedIds = useViewer
      .getState()
      .selection.selectedIds.map(String)
      .filter((id) => !deleted.has(id))
    useViewer.getState().setSelection({ selectedIds: remainingSelectedIds as AnyNodeId[] })
  }
  return [...createdIds, ...updatedIds, ...deleteIds.map(String)]
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
  factoryRunSummary?: FactoryRunSummary
  generationPlanPreview?: ChatGenerationPlanPreview
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

type AiIntentRouteEvidence = {
  kind: string
  confidence: number
  reason: string
  previewId?: string
  requiredPack?: {
    id: string
    version?: string
    installed: boolean
    reason?: string
  }
}

type AiIntentRequiredPack = {
  id: string
  version: string
  industry: string
  label: string
  installed: boolean
  installState: 'installed' | 'missing'
  reason: string
  matchedKeyword: string
}

type AiIntentRoute = {
  kind:
    | 'create-factory'
    | 'create-equipment'
    | 'edit-selected-equipment'
    | 'edit-selected-part'
    | 'bind-live-data'
    | 'create-asset-from-image'
    | 'create-joint-asset'
    | 'generic-geometry'
    | 'ask-or-explain'
  confidence: number
  prompt: string
  reason: string
  requiresPreview: boolean
  execution: 'factory' | 'primitive' | 'image-to-3d' | 'articraft' | 'data-binding' | 'none'
  requiredPack?: AiIntentRequiredPack
  blockers: readonly string[]
}

type GenerationPlanPreviewStep = {
  id: string
  label: string
  status: 'ready' | 'blocked' | 'info'
  detail: string
}

type GenerationPlanPreview = {
  id: string
  routeKind: AiIntentRoute['kind']
  execution: AiIntentRoute['execution']
  applyMode: 'direct' | 'confirm' | 'blocked'
  canvasImpact: 'none' | 'low' | 'medium' | 'high'
  summary: string
  blockers: readonly string[]
  steps: readonly GenerationPlanPreviewStep[]
  requiredPack?: AiIntentRequiredPack
  selectedNodeIds: readonly string[]
}

type ChatGenerationPlanPreview = GenerationPlanPreview & {
  prompt: string
  image?: ChatImageAttachment
  route: AiIntentRoute
}

type AiIntentPreviewResponse = {
  route: AiIntentRoute
  preview: GenerationPlanPreview
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

type ProfilePackSummary = {
  id: string
  name: string
  industry: string
  version: string
  profileCount: number
  enabled: boolean
  path: string
}

type ProfilePackDebugSummary = {
  id: string
  name: string
  source: string
  sourcePack?: { id?: string; version?: string }
  family: string
  layoutFamily?: string
  primarySemanticRole: string
  partCount: number
  overrides?: unknown[]
}

type ProfilePackApiSummary = {
  enabledCount?: number
  profileCount?: number
  loadedProfileCount?: number
  conflictCount?: number
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

function shouldRouteAssetPromptToFactory(input: {
  generationMode: AiGenerationMode
  hasImageAttachment: boolean
  text: string
}) {
  if (input.generationMode !== 'primitive' || input.hasImageAttachment) return false
  const text = input.text.trim().toLowerCase()
  if (!text) return false
  return (
    /\b(factory|plant|workshop|refinery|process\s+line|production\s+line)\b/i.test(text) ||
    /(?:\u70bc\u6cb9\u5382|\u5de5\u5382|\u5382\u533a|\u8f66\u95f4|\u751f\u4ea7\u7ebf|\u5de5\u827a\u7ebf)/.test(text)
  )
}

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
const AI_CHAT_STORAGE_MESSAGE_LIMIT = 40
const AI_CHAT_STORAGE_FALLBACK_MESSAGE_LIMIT = 12
const AI_CHAT_STORAGE_CONTENT_MAX_LENGTH = 20_000
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
  details,
  hint,
  actions,
}: {
  title: string
  meta: React.ReactNode
  status: string
  preview: React.ReactNode
  details?: React.ReactNode
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

      {details}

      <div className="rounded-lg border border-border/50 bg-accent/20 px-2 py-1 text-[10px] text-muted-foreground">
        {hint}
      </div>

      {actions}
    </div>
  )
}

type GeometryProfileDetailsModel = {
  profileId?: string
  profileSource?: string
  sourcePack?: string
  family?: string
  layoutFamily?: string
  quality?: number
  requiredCoverage?: number
  primaryPresent?: boolean
  requiredRoles: string[]
  missingRoles: string[]
  warnings: string[]
  issues: string[]
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sourcePackLabel(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const version = stringValue(record.version)
  return id ? `${id}${version ? `@${version}` : ''}` : undefined
}

function roleTokens(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized ? [normalized, ...normalized.split('_').filter((token) => token.length > 2)] : []
}

function buildGeometryProfileDetails(artifact: GeneratedGeometryArtifact): GeometryProfileDetailsModel | null {
  const sourceArgs = artifact.sourceArgs ?? {}
  const draft = sourceArgs.deviceProfileDraft
  const embedded = sourceArgs.__deviceProfileDefinition
  const profileId =
    stringValue(sourceArgs.deviceProfile) ??
    (draft && typeof draft === 'object' ? stringValue((draft as Record<string, unknown>).id) : undefined) ??
    (embedded && typeof embedded === 'object'
      ? stringValue((embedded as Record<string, unknown>).id)
      : undefined)
  const profileSource = stringValue(sourceArgs.profileSource)
  const quality = artifact.profileQuality
  const sourcePack = sourcePackLabel(sourceArgs.sourcePack)
  const parts = Array.isArray(sourceArgs.parts) ? (sourceArgs.parts as Record<string, unknown>[]) : []
  const requiredRoles = parts
    .filter((part) => part && typeof part === 'object' && part.required === true)
    .map((part) => stringValue(part.semanticRole))
    .filter(Boolean) as string[]
  const shapeTokens = artifact.shapes.flatMap((shape) => [
    ...roleTokens(shape.semanticRole),
    ...roleTokens(shape.sourcePartKind),
  ])
  const missingRoles = requiredRoles.filter((role) => {
    const tokens = roleTokens(role)
    return !tokens.some((token) => shapeTokens.includes(token))
  })
  const hasAnyDetails =
    profileId ||
    profileSource ||
    quality ||
    requiredRoles.length > 0 ||
    stringValue(sourceArgs.family) ||
    stringValue(sourceArgs.layoutFamily)
  if (!hasAnyDetails) return null
  return {
    profileId,
    profileSource,
    sourcePack,
    family: stringValue(sourceArgs.family),
    layoutFamily: stringValue(sourceArgs.layoutFamily),
    quality: typeof quality?.overallScore === 'number' ? quality.overallScore : undefined,
    requiredCoverage:
      typeof quality?.metrics?.requiredCoverage === 'number'
        ? quality.metrics.requiredCoverage
        : requiredRoles.length > 0
          ? (requiredRoles.length - missingRoles.length) / requiredRoles.length
          : undefined,
    primaryPresent:
      typeof quality?.metrics?.primaryPresent === 'number'
        ? quality.metrics.primaryPresent >= 1
        : undefined,
    requiredRoles,
    missingRoles,
    warnings: quality?.warnings ?? [],
    issues: quality?.issues ?? [],
  }
}

function percentLabel(value: number | undefined) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

function GeometryProfileDetails({ details }: { details: GeometryProfileDetailsModel }) {
  const sourceLabel = details.sourcePack
    ? `${details.profileSource ?? 'profile'} · ${details.sourcePack}`
    : details.profileSource
  return (
    <div className="space-y-1.5 rounded-lg border border-sky-400/20 bg-sky-400/5 px-2 py-1.5 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-sky-200">
          <Icon className="size-3" icon="mdi:database-search-outline" />
          {details.profileId ?? 'draft profile'}
        </span>
        {sourceLabel ? <span>{sourceLabel}</span> : null}
        {details.family ? <span>family={details.family}</span> : null}
        {details.layoutFamily ? <span>layout={details.layoutFamily}</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div>质量 {percentLabel(details.quality)}</div>
        <div>必需角色 {percentLabel(details.requiredCoverage)}</div>
        <div>主形体 {details.primaryPresent === false ? '缺失' : '命中'}</div>
      </div>
      {details.requiredRoles.length > 0 ? (
        <div className="truncate">
          required: {details.requiredRoles.slice(0, 6).join(', ')}
          {details.requiredRoles.length > 6 ? '...' : ''}
        </div>
      ) : null}
      {details.missingRoles.length > 0 ? (
        <div className="text-amber-300">缺失: {details.missingRoles.slice(0, 5).join(', ')}</div>
      ) : null}
      {details.issues.length > 0 || details.warnings.length > 0 ? (
        <div className="truncate text-amber-300">
          {details.issues[0] ?? details.warnings[0]}
        </div>
      ) : null}
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
  const profileDetails = buildGeometryProfileDetails(artifact)

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
      details={profileDetails ? <GeometryProfileDetails details={profileDetails} /> : undefined}
      meta={`${artifact.createdNames.length} parts · ${artifact.sourceTool} · v${artifact.version}`}
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

function FactoryRunSummaryCard({
  disabled,
  onResourceOptionSelect,
  summary,
}: {
  disabled?: boolean
  onResourceOptionSelect?: (option: NonNullable<FactoryRunSummary['resourceOptions']>[number]) => void
  summary: FactoryRunSummary
}) {
  const statusClass =
    summary.status === 'succeeded'
      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
      : summary.status === 'failed'
        ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
        : summary.status === 'cancelled'
          ? 'border-border/60 bg-accent/30 text-muted-foreground'
          : 'border-sky-400/40 bg-sky-400/10 text-sky-200'
  const statusIcon =
    summary.status === 'succeeded'
      ? 'mdi:check-circle-outline'
      : summary.status === 'failed'
        ? 'mdi:alert-circle-outline'
        : summary.status === 'cancelled'
          ? 'mdi:cancel'
          : summary.status === 'needs_input'
            ? 'mdi:cursor-default-click-outline'
          : 'mdi:progress-clock'
  const statusLabel =
    summary.status === 'running'
      ? '进行中'
      : summary.status === 'succeeded'
        ? '完成'
        : summary.status === 'cancelled'
          ? '已取消'
          : summary.status === 'needs_input'
            ? '待选择'
            : '需检查'
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-2 text-foreground shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Icon className="size-3.5 text-[#a684ff]" icon={summary.icon ?? 'mdi:factory'} />
            <span className="truncate">{summary.title}</span>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {summary.description}
          </div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]', statusClass)}>
          <Icon className={cn('size-3', summary.status === 'running' && 'animate-spin')} icon={statusIcon} />
          {statusLabel}
        </span>
      </div>

      <div className="space-y-1">
        {summary.steps.map((step, index) => {
          const stepClass =
            step.status === 'done'
              ? 'text-emerald-300'
              : step.status === 'failed'
                ? 'text-amber-300'
                : step.status === 'running'
                  ? 'text-sky-300'
                  : 'text-muted-foreground'
          const icon =
            step.status === 'done'
              ? 'mdi:check'
              : step.status === 'failed'
                ? 'mdi:alert'
                : step.status === 'running'
                  ? 'mdi:loading'
                  : 'mdi:circle-outline'
          return (
            <div className={cn('flex items-center gap-1.5 text-[11px]', stepClass)} key={`${step.label}-${index}`}>
              <Icon className={cn('size-3.5 shrink-0', step.status === 'running' && 'animate-spin')} icon={icon} />
              <span className="min-w-0 flex-1 truncate">{step.label}</span>
            </div>
          )
        })}
      </div>

      {summary.metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {summary.metrics.map((metric) => (
            <div className="rounded-lg border border-border/50 bg-accent/20 px-2 py-1" key={metric.label}>
              <div className="text-[9px] text-muted-foreground">{metric.label}</div>
              <div className="truncate text-[11px] font-medium text-foreground">{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {summary.resourceOptions?.length ? (
        <div className="space-y-1.5">
          {summary.resourceOptions.map((option) => (
            <div
              className={cn(
                'rounded-lg border px-2 py-1.5',
                option.recommended
                  ? 'border-sky-400/40 bg-sky-400/10'
                  : 'border-border/50 bg-accent/15',
              )}
              key={option.id}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <span className="truncate">{option.label}</span>
                {option.recommended ? (
                  <span className="shrink-0 rounded border border-sky-400/40 px-1 py-0.5 text-[9px] text-sky-200">
                    推荐
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {option.description}
              </div>
              {onResourceOptionSelect ? (
                <button
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-sky-400/35 bg-sky-400/10 px-2 py-1 text-[10px] font-medium text-sky-100 transition-colors hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => onResourceOptionSelect(option)}
                  type="button"
                >
                  <Icon className="size-3" icon="mdi:cube-send" />
                  生成{option.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {summary.details ? (
        <details className="rounded-lg border border-border/50 bg-accent/15 px-2 py-1 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
            调试详情
          </summary>
          <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-relaxed">
            {summary.details}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function intentRouteLabel(kind: AiIntentRoute['kind']) {
  switch (kind) {
    case 'create-factory':
      return '工厂生成'
    case 'create-equipment':
      return '设备生成'
    case 'edit-selected-equipment':
      return '编辑设备'
    case 'edit-selected-part':
      return '编辑部件'
    case 'bind-live-data':
      return '数据绑定'
    case 'create-asset-from-image':
      return '图生建模'
    case 'create-joint-asset':
      return '关节资产'
    case 'generic-geometry':
      return '几何搭建'
    case 'ask-or-explain':
      return '说明回答'
  }
}

function generationPlanImpactLabel(impact: GenerationPlanPreview['canvasImpact']) {
  if (impact === 'high') return '高影响'
  if (impact === 'medium') return '中影响'
  if (impact === 'low') return '低影响'
  return '不改画布'
}

function generationPlanApplyLabel(applyMode: GenerationPlanPreview['applyMode']) {
  if (applyMode === 'blocked') return '需处理'
  if (applyMode === 'confirm') return '待确认'
  return '可直接执行'
}

function buildIntentRouteEvidence(preview: ChatGenerationPlanPreview): AiIntentRouteEvidence {
  return {
    kind: preview.route.kind,
    confidence: preview.route.confidence,
    reason: preview.route.reason,
    previewId: preview.id,
    requiredPack: preview.route.requiredPack
      ? {
          id: preview.route.requiredPack.id,
          version: preview.route.requiredPack.version,
          installed: preview.route.requiredPack.installed,
          reason: preview.route.requiredPack.reason,
        }
      : undefined,
  }
}

function GenerationPlanPreviewCard({
  disabled,
  onApply,
  onCancel,
  onEditPrompt,
  onInstallPack,
  preview,
}: {
  disabled?: boolean
  onApply: () => void
  onCancel: () => void
  onEditPrompt: () => void
  onInstallPack: () => void
  preview: ChatGenerationPlanPreview
}) {
  const blocked = preview.applyMode === 'blocked'
  const confirm = preview.applyMode === 'confirm'
  const statusClass = blocked
    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
    : confirm
      ? 'border-[#a684ff]/40 bg-[#a684ff]/10 text-[#d6c5ff]'
      : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
  const statusIcon = blocked
    ? 'mdi:alert-circle-outline'
    : confirm
      ? 'mdi:clipboard-check-outline'
      : 'mdi:play-circle-outline'

  return (
    <div
      className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-2 text-foreground shadow-sm"
      data-testid={`generation-plan-preview-${preview.routeKind}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Icon className="size-3.5 text-[#a684ff]" icon="mdi:routes" />
            <span className="truncate">{intentRouteLabel(preview.routeKind)}</span>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {preview.summary}
          </div>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]',
            statusClass,
          )}
        >
          <Icon className="size-3" icon={statusIcon} />
          {generationPlanApplyLabel(preview.applyMode)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-border/50 bg-accent/20 px-2 py-1">
          <div className="text-[9px] text-muted-foreground">影响</div>
          <div className="truncate text-[11px] font-medium text-foreground">
            {generationPlanImpactLabel(preview.canvasImpact)}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-accent/20 px-2 py-1">
          <div className="text-[9px] text-muted-foreground">执行</div>
          <div className="truncate text-[11px] font-medium text-foreground">
            {preview.execution}
          </div>
        </div>
      </div>

      {preview.requiredPack ? (
        <div
          className={cn(
            'rounded-lg border px-2 py-1.5 text-[11px]',
            preview.requiredPack.installed
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
              : 'border-amber-400/30 bg-amber-400/10 text-amber-200',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{preview.requiredPack.label}</span>
            <span className="shrink-0 font-mono text-[10px]">
              {preview.requiredPack.id}@{preview.requiredPack.version}
            </span>
          </div>
          <div className="mt-1 leading-snug opacity-80">{preview.requiredPack.reason}</div>
        </div>
      ) : null}

      <div className="space-y-1">
        {preview.steps.map((step) => {
          const stepClass =
            step.status === 'blocked'
              ? 'text-amber-300'
              : step.status === 'ready'
                ? 'text-emerald-300'
                : 'text-muted-foreground'
          const icon =
            step.status === 'blocked'
              ? 'mdi:alert'
              : step.status === 'ready'
                ? 'mdi:check'
                : 'mdi:information-outline'
          return (
            <div className={cn('flex items-center gap-1.5 text-[11px]', stepClass)} key={step.id}>
              <Icon className="size-3.5 shrink-0" icon={icon} />
              <span className="min-w-0 flex-1 truncate" title={step.detail}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {blocked && preview.requiredPack && !preview.requiredPack.installed ? (
          <button
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-amber-400/35 bg-amber-400/10 px-2 py-1 text-[10px] font-medium text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={onInstallPack}
            type="button"
          >
            <Icon className="size-3" icon="mdi:cloud-download-outline" />
            安装资源包
          </button>
        ) : (
          <button
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-[#a684ff]/35 bg-[#a684ff]/10 px-2 py-1 text-[10px] font-medium text-[#e5d8ff] transition-colors hover:bg-[#a684ff]/20 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`generation-plan-preview-apply-${preview.routeKind}`}
            disabled={disabled}
            onClick={onApply}
            type="button"
          >
            <Icon className="size-3" icon="mdi:play" />
            Apply
          </button>
        )}
        <button
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-sky-400/50 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onEditPrompt}
          type="button"
        >
          <Icon className="size-3" icon="mdi:pencil-outline" />
          编辑
        </button>
        <button
          className="inline-flex items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          <Icon className="size-3" icon="mdi:close" />
          取消
        </button>
      </div>
    </div>
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

function truncateAiChatStorageText(value: string) {
  if (value.length <= AI_CHAT_STORAGE_CONTENT_MAX_LENGTH) return value
  return `${value.slice(0, AI_CHAT_STORAGE_CONTENT_MAX_LENGTH)}\u2026`
}

function compactAiChatMessageForLocalStorage(message: ChatMessage): ChatMessage {
  const compact: ChatMessage = {
    ...message,
    content: truncateAiChatStorageText(message.content),
  }
  delete compact.image
  delete compact.generationPlanPreview
  return compact
}

function minimalAiChatMessageForLocalStorage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: truncateAiChatStorageText(message.content),
    ...(message.generationRun ? { generationRun: message.generationRun } : {}),
  }
}

function isStorageQuotaExceeded(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  )
}

function writeAiChatPanelStateSnapshot(snapshot: AiChatPanelStateSnapshot & { updatedAt: string }) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(snapshot))
    return
  } catch (error) {
    if (!isStorageQuotaExceeded(error)) return
  }

  const fallbackSnapshot: AiChatPanelStateSnapshot & { updatedAt: string } = {
    ...snapshot,
    messages: snapshot.messages
      .slice(-AI_CHAT_STORAGE_FALLBACK_MESSAGE_LIMIT)
      .map(minimalAiChatMessageForLocalStorage),
    imageAttachment: undefined,
  }

  try {
    window.localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(fallbackSnapshot))
  } catch {
    window.localStorage.removeItem(AI_CHAT_STORAGE_KEY)
  }
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
        : inferConversationPurposeFromMessages(messages)
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
  conversationPurpose?: AiConversationPurpose
  updatedAt: string
}

function isAiConversationPurpose(value: unknown): value is AiConversationPurpose {
  return value === 'factory' || value === 'asset'
}

function inferConversationPurposeFromMessages(
  messages: readonly ChatMessage[],
): AiConversationPurpose | undefined {
  if (messages.some((message) => message.generationRun?.mode === 'factory')) return 'factory'
  return messages.length > 0 ? 'asset' : undefined
}

function conversationHistoryIcon(conversation: AiConversationSummary) {
  if (conversation.conversationPurpose === 'factory') {
    return {
      icon: 'mdi:factory',
      label: t('aiChat.factoryConversation', 'Factory conversation'),
      className: 'border-[#a684ff]/20 bg-[#a684ff]/5 text-[#a684ff]/70',
    }
  }
  if (conversation.conversationPurpose === 'asset') {
    return {
      icon: 'mdi:robot-industrial-outline',
      label: t('aiChat.assetConversation', 'Equipment conversation'),
      className: 'border-sky-400/20 bg-sky-400/5 text-sky-300/70',
    }
  }
  return {
    icon: 'mdi:chat-outline',
    label: t('aiChat.conversation', 'Conversation'),
    className: 'border-border/60 bg-accent/35 text-muted-foreground',
  }
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

type FactoryE2eBridge = {
  sceneNodes: () => Record<string, unknown>
  applyFactoryRun: (data: unknown) => string[]
  cameraView: (view: 'isometric' | 'top' | 'side') => void
  clearSelection: () => void
  liveDataValue: (path: string) => unknown
  nodeTransform: (nodeId: string) => {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    visible: boolean
  } | null
  selectNode: (nodeId: string) => void
  resetLiveDataSource: () => void
  reseedFixedLiveDataSource: () => void
  setSelectMode: () => void
  setPreviewMode: (enabled: boolean) => void
  selectedIds: () => string[]
  viewerFlags: () => { cameraDragging: boolean; inputDragging: boolean; spacePanning: boolean }
}

declare global {
  interface Window {
    __pascalFactoryE2e?: FactoryE2eBridge
  }
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
  const [factorySelectionCardOpen, setFactorySelectionCardOpen] = useState(false)
  const [factoryProfilePackCardOpen, setFactoryProfilePackCardOpen] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(aiChatPanelState.inputExpanded)
  const [imageAttachment, setImageAttachment] = useState<ChatImageAttachment | undefined>(
    aiChatPanelState.imageAttachment,
  )
  const [profilePacks, setProfilePacks] = useState<ProfilePackSummary[]>([])
  const [profilePackDebug, setProfilePackDebug] = useState<ProfilePackDebugSummary[]>([])
  const [profilePackSummary, setProfilePackSummary] = useState<ProfilePackApiSummary>({})
  const [profilePackWarningCount, setProfilePackWarningCount] = useState(0)
  const [profilePackImporting, setProfilePackImporting] = useState(false)
  const [profilePackStatus, setProfilePackStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const profilePackInputRef = useRef<HTMLInputElement>(null)
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
  const selectedCanvasIds = useViewer((state) => state.selection.selectedIds)
  const sceneNodes = useScene((state) => state.nodes)
  const factorySelectionLabel = useMemo(() => {
    const selectedNodes = selectedCanvasIds
      .map((id) => sceneNodes[id as AnyNodeId])
      .filter((node): node is AnyNode => Boolean(node))
    if (!selectedNodes.length) return 'none'

    const nodeLabel = (node: AnyNode) =>
      typeof node.name === 'string' && node.name.trim() ? node.name.trim() : node.type
    const containingAssembly = (node: AnyNode): AnyNode | undefined => {
      let parentId = (node as { parentId?: unknown }).parentId
      const visited = new Set<string>()
      while (typeof parentId === 'string' && !visited.has(parentId)) {
        visited.add(parentId)
        const parent = sceneNodes[parentId as AnyNodeId]
        if (!parent) return undefined
        if (parent.type === 'assembly') return parent
        parentId = (parent as { parentId?: unknown }).parentId
      }
      return undefined
    }

    const firstAssembly = containingAssembly(selectedNodes[0]!)
    if (
      firstAssembly &&
      selectedNodes.every((node) => containingAssembly(node)?.id === firstAssembly.id)
    ) {
      const partLabels = selectedNodes.slice(0, 4).map(nodeLabel)
      const extra =
        selectedNodes.length > partLabels.length
          ? ` +${selectedNodes.length - partLabels.length}`
          : ''
      if (selectedNodes.length === 1) return `${nodeLabel(firstAssembly)} > ${partLabels[0]}`
      return `${nodeLabel(firstAssembly)} > ${selectedNodes.length} parts: ${partLabels.join(', ')}${extra}`
    }

    const labels = selectedNodes.slice(0, 3).map((node) => `${nodeLabel(node)} (${node.type})`)
    const extra = selectedNodes.length > labels.length ? ` +${selectedNodes.length - labels.length}` : ''
    return labels.join(', ') + extra
  }, [sceneNodes, selectedCanvasIds])

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
      messages: messages.slice(-AI_CHAT_STORAGE_MESSAGE_LIMIT).map(compactAiChatMessageForLocalStorage),
      input,
      generationMode,
      conversationPurpose,
      inputExpanded,
      imageAttachment: undefined,
      updatedAt: new Date().toISOString(),
    }
    writeAiChatPanelStateSnapshot(snapshot)
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
    if (messages.length === 0) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void fetch(`/api/ai-harness/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          conversationPurpose,
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
  }, [conversationId, conversationPurpose, messages, panelHydrated])

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
    if (typeof window === 'undefined') return
    const queryEnabled = new URLSearchParams(window.location.search).get('factoryE2e') === '1'
    if (process.env.NEXT_PUBLIC_FACTORY_E2E_SMOKE !== '1' && !queryEnabled) return

    window.__pascalFactoryE2e = {
      sceneNodes: () => useScene.getState().nodes as unknown as Record<string, unknown>,
      applyFactoryRun: (data: unknown) => applyFactoryRunPatchesToCanvas(data),
      cameraView: (view) => {
        if (view === 'isometric') {
          const nodes = useScene.getState()
            .nodes as Parameters<typeof pickSceneCameraFocusBounds>[0]
          const focus = pickSceneCameraFocusBounds(nodes)
          const bounds = focus?.bounds ?? computeSceneBoundsXZ(nodes)
          emitter.emit(
            'camera-controls:fit-scene',
            bounds ? { bounds, reason: focus?.reason ?? 'scene-bounds' } : {},
          )
          return
        }
        if (view === 'top') {
          emitter.emit('camera-controls:top-view')
          return
        }
        emitter.emit('camera-controls:top-view')
        window.setTimeout(() => emitter.emit('camera-controls:orbit-cw'), 0)
      },
      selectNode: (nodeId: string) => {
        if (!nodeId) return
        useViewer.getState().setSelection({ selectedIds: [nodeId as AnyNodeId] })
      },
      clearSelection: () => {
        useViewer.getState().setSelection({ selectedIds: [] })
        useEditor.getState().setEditingAssemblyId(null)
        useEditor.getState().setSelectedMaterialTarget(null)
      },
      setPreviewMode: (enabled: boolean) => {
        useEditor.getState().setPreviewMode(enabled)
      },
      liveDataValue: (path: string) => useLiveData.getState().values[path],
      resetLiveDataSource: () => {
        useLiveData.getState().resetLiveData()
      },
      reseedFixedLiveDataSource: () => {
        seedFixedFactoryLiveDataSource()
      },
      nodeTransform: (nodeId: string) => {
        const object = sceneRegistry.nodes.get(nodeId as AnyNodeId)
        if (!object) return null
        return {
          position: [object.position.x, object.position.y, object.position.z],
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          scale: [object.scale.x, object.scale.y, object.scale.z],
          visible: object.visible,
        }
      },
      setSelectMode: () => {
        useEditor.setState({
          phase: 'structure',
          structureLayer: 'elements',
          mode: 'select',
          tool: null,
          catalogCategory: null,
          editingAssemblyId: null,
        })
        useEditor.getState().setFloorplanSelectionTool('click')
      },
      selectedIds: () => useViewer.getState().selection.selectedIds.map(String),
      viewerFlags: () => {
        const viewer = useViewer.getState()
        return {
          cameraDragging: viewer.cameraDragging,
          inputDragging: viewer.inputDragging,
          spacePanning: viewer.spacePanning,
        }
      },
    }

    return () => {
      delete window.__pascalFactoryE2e
    }
  }, [])

  useEffect(() => {
    if (loading) setModeMenuOpen(false)
  }, [loading])

  const refreshProfilePacks = useCallback(async () => {
    try {
      const response = await fetch('/api/profile-packs', { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as {
        packs?: ProfilePackSummary[]
        profileDebug?: ProfilePackDebugSummary[]
        summary?: ProfilePackApiSummary
        warnings?: unknown[]
      }
      setProfilePacks(Array.isArray(data.packs) ? data.packs : [])
      setProfilePackDebug(Array.isArray(data.profileDebug) ? data.profileDebug : [])
      setProfilePackSummary(data.summary ?? {})
      setProfilePackWarningCount(Array.isArray(data.warnings) ? data.warnings.length : 0)
    } catch {
      // The pack summary is non-critical; geometry generation still works without it.
    }
  }, [])

  useEffect(() => {
    void refreshProfilePacks()
  }, [refreshProfilePacks])

  const handleProfilePackSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      if (!/\.zip$/i.test(file.name)) {
        setProfilePackStatus('请选择 .zip 行业资源包。')
        return
      }
      setProfilePackImporting(true)
      setProfilePackStatus('正在导入行业资源包...')
      try {
        const form = new FormData()
        form.set('file', file)
        const response = await fetch('/api/profile-packs', {
          method: 'POST',
          body: form,
        })
        const data = (await response.json()) as {
          pack?: ProfilePackSummary
          message?: string
          error?: string
        }
        if (!response.ok || !data.pack) {
          throw new Error(data.message ?? data.error ?? '行业资源包导入失败。')
        }
        setProfilePackStatus(
          `已启用 ${data.pack.name}，新增 ${data.pack.profileCount} 个设备 profile。`,
        )
        await refreshProfilePacks()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setProfilePackStatus(`行业资源包导入失败：${message}`)
      } finally {
        setProfilePackImporting(false)
      }
    },
    [refreshProfilePacks],
  )

  const markGenerationStopped = useCallback((content = 'Generation stopped.') => {
    setMessages((prev) => {
      let stoppedActiveRun = false
      const updated = prev.map((message) => {
        if (!isActiveGenerationRun(message.generationRun)) return message
        stoppedActiveRun = true
        return {
          ...message,
          content: message.factoryRunSummary ? '' : content,
          factoryRunSummary: message.factoryRunSummary
            ? {
                ...message.factoryRunSummary,
                status: 'cancelled' as const,
                title: message.factoryRunSummary.icon ? '生成已取消' : '工厂创建已取消',
                description: content,
                steps: message.factoryRunSummary.steps.map((step) =>
                  step.status === 'running' ? { ...step, status: 'failed' as const } : step,
                ),
              }
            : message.factoryRunSummary,
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
          content: `保存到素材库失败：${error instanceof Error ? error.message : String(error)}`,
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
          content: `读取图片失败：${error instanceof Error ? error.message : String(error)}`,
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
    const hasArticraftJoints = (result.jointCount ?? 0) > 0 || result.joints.length > 0

    if (result.asset && !hasArticraftJoints) {
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

  const canReachArticraftViewer = useCallback(async (url: string) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(url, {
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller.signal,
      })
      return true
    } catch {
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }, [])

  const openArticraftViewer = useCallback(async (recordId: string, tab?: string) => {
    const resolvedTab = tab ?? 'inspect'
    const url = getArticraftViewerUrl(recordId, resolvedTab)
    if (!(await canReachArticraftViewer(url))) {
      const base = articraftViewerUrl.replace(/\/$/, '')
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Articraft Viewer 服务没有响应：${base}/viewer。请在仓库根目录启动 \`bun dev:articraft\`，或单独启动 Articraft viewer 后再打开。`,
        },
      ])
      return
    }
    setArticraftViewerModal({
      url,
      title: resolvedTab === 'code' ? 'Articraft Code' : 'Articraft Viewer',
    })
  }, [articraftViewerUrl, canReachArticraftViewer, getArticraftViewerUrl])

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
          factoryRunSummary: buildArticraftResultSummary(result),
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
          factoryRunSummary: buildImageTo3DResultSummary(artifact),
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
                content: messageItem.factoryRunSummary ? '' : content,
                factoryRunSummary: messageItem.factoryRunSummary
                  ? {
                      ...messageItem.factoryRunSummary,
                      status: 'cancelled' as const,
                      title: messageItem.factoryRunSummary.icon ? '生成已取消' : '工厂创建已取消',
                      description: content,
                      steps: messageItem.factoryRunSummary.steps.map((step) =>
                        step.status === 'running'
                          ? { ...step, status: 'failed' as const }
                          : step,
                      ),
                    }
                  : messageItem.factoryRunSummary,
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'image-to-3d',
              message: '正在恢复图生建模任务进度。',
            }),
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
                  factoryRunSummary: buildDeviceProgressSummary({
                    mode: 'image-to-3d',
                    message: message || '正在生成设备外观资产。',
                    detailLines: progressLines,
                  }),
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
                    content: `图生建模失败：${message}`,
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
                  content: `图生建模失败：${String(parsed.message)}`,
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'articraft',
              message: '正在恢复关节资产生成进度。',
            }),
            generationRun: {
              id: job.id,
              mode: 'articraft',
              status: job.status === 'queued' ? 'queued' : 'running',
            },
          },
        ]
      })

      const progressHeader = '正在使用图生建模生成 3D 模型，完成后会保存到物品库...'
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
                  factoryRunSummary: buildDeviceProgressSummary({
                    mode: 'articraft',
                    message: message || '正在生成设备几何和关节资产。',
                    detailLines: progressLines,
                  }),
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
      const needsResourceSelection = data.needsResourceSelection === true
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
          factoryRunSummary: needsResourceSelection
            ? buildPrimitiveResourceSelectionSummary(data.resourceSelection)
            : buildPrimitiveResultSummary(artifact),
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'primitive',
              message: '正在恢复几何搭建设备任务。',
            }),
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'primitive',
              message: '正在恢复几何搭建设备任务。',
            }),
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
                  factoryRunSummary: buildDeviceProgressSummary({
                    mode: 'primitive',
                    message: message || '正在搭建设备几何。',
                    detailLines: progressLines,
                    analysis: primitiveRunAnalysisRef.current.get(run.id),
                  }),
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
                  factoryRunSummary: buildDeviceProgressSummary({
                    mode: 'primitive',
                    message: '已完成需求理解，正在生成设备几何。',
                    detailLines: progressLines,
                    analysis,
                  }),
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
                  factoryRunSummary: buildDeviceProgressSummary({
                    mode: 'primitive',
                    message: '几何工具已返回结果，正在整理设备资产。',
                    detailLines: [message],
                    analysis: primitiveRunAnalysisRef.current.get(run.id),
                  }),
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
    const alreadyApplied = appliedFactoryRunIdsRef.current.has(runId)
    const appliedNodeIds = alreadyApplied ? [] : applyFactoryRunPatchesToCanvas(data)
    if (appliedNodeIds.length > 0) appliedFactoryRunIdsRef.current.add(runId)
    const displayData =
      isRecord(data) && (alreadyApplied || appliedNodeIds.length > 0)
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
        content: '',
        factoryRunSummary: buildFactoryResultSummary(displayData),
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
            content: '',
            factoryRunSummary: buildFactoryProgressSummary({
              message: '我正在理解需求并准备工厂场景变更。',
            }),
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
        const eventData = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : {}
        const plan = isRecord(eventData.plan) ? eventData.plan : undefined
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
                  content: '',
                  factoryRunSummary: buildFactoryProgressSummary({
                    stage: eventData.stage,
                    planKind: plan?.kind,
                    message: message.trim() || undefined,
                    detailLines: progressLines,
                  }),
                  generationRun: { id: run.id, mode: 'factory', status: 'running' },
                }
              : messageItem,
          ),
        )
      })

      source.addEventListener('message', (event) => {
        const parsed = safeParseJson(event.data)
        if (!isRecord(parsed) || !isRecord(parsed.data)) return
        const eventData = parsed.data
        if (eventData.stage !== 'patch-plan' && eventData.stage !== 'selection-edit') return
        const patchCount =
          typeof eventData.patchCount === 'number' ? eventData.patchCount : undefined
        const missingAssets = Array.isArray(eventData.missingAssets)
          ? eventData.missingAssets.length
          : 0
        const plan = isRecord(eventData.plan) ? eventData.plan : undefined
        setMessages((prev) =>
          prev.map((messageItem) =>
            messageItem.generationRun?.id === run.id
              ? {
                  ...messageItem,
                  content: '',
                  factoryRunSummary: buildFactoryProgressSummary({
                    stage: eventData.stage,
                    planKind: plan?.kind,
                    message:
                      typeof parsed.message === 'string'
                        ? parsed.message
                        : '场景变更已经生成，正在等待最终结果。',
                    patchCount,
                    missingAssetCount: missingAssets,
                    detailLines: progressLines,
                  }),
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
        const persistedPurpose = isAiConversationPurpose(data.conversation?.conversationPurpose)
          ? data.conversation.conversationPurpose
          : undefined
        const inferredPurpose = inferConversationPurposeFromMessages(conversationMessages)
        const activeRuns: unknown[] = Array.isArray(data.activeRuns) ? data.activeRuns : []
        const activeRunPurpose = activeRuns.some(
          (activeRun) => isRecord(activeRun) && activeRun.mode === 'factory',
        )
          ? 'factory'
          : activeRuns.length > 0
            ? 'asset'
            : undefined
        const nextPurpose = persistedPurpose ?? inferredPurpose ?? activeRunPurpose
        if (nextPurpose) setConversationPurpose(nextPurpose)
        if (conversationMessages.length > 0) {
          setMessages((current) =>
            current.length >= conversationMessages.length ? current : conversationMessages,
          )
        }
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
    (conversation: AiConversationSummary) => {
      const nextConversationId = conversation.id
      if (!nextConversationId || nextConversationId === conversationId) {
        setConversationHistoryOpen(false)
        return
      }
      closeActiveRunSources()
      setConversationId(nextConversationId)
      setMessages([])
      setInput('')
      setImageAttachment(undefined)
      setConversationPurpose(conversation.conversationPurpose)
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

  const sendImageTo3DMessage = useCallback(async (
    text: string,
    image?: ChatImageAttachment,
    intentRoute?: AiIntentRouteEvidence,
  ) => {
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
      factoryRunSummary: buildDeviceProgressSummary({
        mode: 'image-to-3d',
        message: '正在根据图片创建设备外观资产。',
      }),
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
          ...(intentRoute ? { intentRoute } : {}),
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'image-to-3d',
              message: '后台任务已创建，正在等待图生建模结果。',
            }),
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

  const sendArticraftMessage = useCallback(async (
    text: string,
    image?: ChatImageAttachment,
    intentRoute?: AiIntentRouteEvidence,
  ) => {
    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const prompt = text.trim() || '\u8bf7\u6839\u636e\u56fe\u7247\u751f\u6210\u4e00\u4e2a\u53ef\u52a8\u7684\u00203D\u0020\u6a21\u578b'
    const userMsg: ChatMessage = { role: 'user', content: prompt, image }
      const progressHeader = '正在使用图生建模生成 3D 模型，完成后会保存到物品库...'
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: progressHeader,
      factoryRunSummary: buildDeviceProgressSummary({
        mode: 'articraft',
        message: '正在生成带 links/joints 的可动设备资产。',
      }),
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
          ...(intentRoute ? { intentRoute } : {}),
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'articraft',
              message: '任务已提交，正在排队生成关节资产。',
            }),
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

  const sendMessage = useCallback(async (
    overrideText?: string,
    intentRoute?: AiIntentRouteEvidence,
  ) => {
    const text = (overrideText ?? input).trim()
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
    const selectionCapabilities = buildCurrentSelectionCapabilityProfiles()
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
      selectionCapabilities,
    })
    const analysisContext = buildGeometryAnalysisContext({
      messages,
      latestArtifact: latestGeometryArtifactCandidate,
      userRequest: userContent,
      contextDecision: preliminaryContextDecision,
      selectionCapabilities,
    })
    const userMsg: ChatMessage = { role: 'user', content: userContent }
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: '**Generate:**\n_后台几何体生成任务已创建，正在等待分析..._',
      factoryRunSummary: buildDeviceProgressSummary({
        mode: 'primitive',
        message: '正在理解设备需求并准备可编辑几何。',
      }),
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
          ...(intentRoute ? { intentRoute } : {}),
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
            factoryRunSummary: buildDeviceProgressSummary({
              mode: 'primitive',
              message: '后台几何搭建任务已创建，正在等待分析结果。',
            }),
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

  const sendFactoryMessage = useCallback(async (
    overrideText?: string,
    intentRoute?: AiIntentRouteEvidence,
    options?: { replacePreviewMessageIndex?: number; skipUserMessage?: boolean },
  ) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    if (!overrideText) setInput('')
    setImageAttachment(undefined)
    const previewMessageIndex = options?.replacePreviewMessageIndex
    if (previewMessageIndex != null) {
      const progressMessage: ChatMessage = {
        role: 'assistant',
        content: '',
        factoryRunSummary: buildFactoryProgressSummary({
          message: '正在理解需求并准备工厂场景变更。',
        }),
      }
      setMessages((prev) => {
        const updated = [...prev]
        updated[previewMessageIndex] = progressMessage
        return updated
      })
    } else {
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      {
        role: 'assistant',
        content: '',
        factoryRunSummary: buildFactoryProgressSummary({
          message: '我正在理解需求并准备工厂场景变更。',
        }),
      },
    ])
    }
    setLoading(true)

    try {
      const selection = buildFactorySelectionSnapshot()
      const sceneContext = buildFactorySceneContext()
      const placementContext = buildFactoryPlacementContextSnapshot()
      const res = await fetch('/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          mode: 'factory',
          prompt: text,
          context: {
            recentMessages: messages,
            ...placementContext,
            ...(selection ? { selection } : {}),
            ...(sceneContext ? { scene: sceneContext } : {}),
          },
          ...(intentRoute ? { intentRoute } : {}),
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

  const buildIntentPreviewSelection = useCallback(() => {
    const nodeIds = useViewer.getState().selection.selectedIds.map(String).filter(Boolean)
    if (!nodeIds.length) return undefined
    const firstNode = sceneNodes[nodeIds[0] as AnyNodeId]
    const metadata =
      firstNode && isRecord((firstNode as { metadata?: unknown }).metadata)
        ? ((firstNode as { metadata?: unknown }).metadata as Record<string, unknown>)
        : undefined
    const semanticRole =
      typeof metadata?.semanticRole === 'string'
        ? metadata.semanticRole
        : typeof metadata?.primarySemanticRole === 'string'
          ? metadata.primarySemanticRole
          : undefined
    const sourcePartKind =
      typeof metadata?.sourcePartKind === 'string'
        ? metadata.sourcePartKind
        : typeof metadata?.partKind === 'string'
          ? metadata.partKind
          : undefined
    let assemblyId: string | undefined
    let parentId = firstNode ? (firstNode as { parentId?: unknown }).parentId : undefined
    const visited = new Set<string>()
    while (typeof parentId === 'string' && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = sceneNodes[parentId as AnyNodeId]
      if (!parent) break
      if (parent.type === 'assembly') {
        assemblyId = parent.id
        break
      }
      parentId = (parent as { parentId?: unknown }).parentId
    }

    return {
      nodeIds,
      nodeType: firstNode?.type,
      assemblyId,
      semanticRole,
      sourcePartKind,
    }
  }, [sceneNodes])

  const fetchGenerationPlanPreview = useCallback(
    async (text: string, image?: ChatImageAttachment) => {
      const response = await fetch('/api/ai-harness/intent-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          imageAttached: Boolean(image),
          generationMode,
          conversationPurpose,
          selection: buildIntentPreviewSelection(),
          ...(image ? { image: { name: image.name, type: image.type, dataUrl: image.dataUrl } } : {}),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as Partial<AiIntentPreviewResponse> & {
        error?: string
        message?: string
      }
      if (!response.ok || !data.route || !data.preview) {
        throw new Error(data.message ?? data.error ?? response.statusText)
      }
      return {
        ...data.preview,
        prompt: text,
        image,
        route: data.route,
      } satisfies ChatGenerationPlanPreview
    },
    [buildIntentPreviewSelection, conversationPurpose, generationMode],
  )

  const executeGenerationPlanPreview = useCallback(
    async (preview: ChatGenerationPlanPreview, messageIndex?: number) => {
      const intentRoute = buildIntentRouteEvidence(preview)
      if (preview.execution === 'factory') {
        setConversationPurpose('factory')
        setModeMenuOpen(false)
        await sendFactoryMessage(preview.prompt, intentRoute, {
          replacePreviewMessageIndex: messageIndex,
          skipUserMessage: messageIndex != null,
        })
        return
      }
      if (preview.execution === 'primitive') {
        await sendMessage(preview.prompt, intentRoute)
        return
      }
      if (preview.execution === 'image-to-3d') {
        await sendImageTo3DMessage(preview.prompt, preview.image, intentRoute)
        return
      }
      if (preview.execution === 'articraft') {
        await sendArticraftMessage(preview.prompt, preview.image, intentRoute)
        return
      }
      if (preview.execution === 'data-binding') {
        const scene = useScene.getState()
        const plan = planSemanticLiveDataBinding({
          prompt: preview.prompt,
          profiles: buildCurrentSelectionCapabilityProfiles() ?? [],
          nodes: scene.nodes,
          paths: useLiveData.getState().paths,
        })
        if (plan) {
          scene.updateNodes([{ id: plan.nodeId as AnyNodeId, data: plan.patch }])
          scene.markDirty(plan.nodeId as AnyNodeId)
          useViewer.getState().setSelection({ selectedIds: [plan.nodeId as AnyNodeId] })
          setMessages((prev) => {
            const result: ChatMessage = {
              role: 'assistant',
              content: `Bound ${plan.label} ${plan.target.label} to ${plan.path}.`,
            }
            if (messageIndex == null) return [...prev, result]
            const updated = [...prev]
            updated[messageIndex] = result
            return updated
          })
          return
        }
      }
      setMessages((prev) => {
        const result: ChatMessage = {
          role: 'assistant',
          content:
            preview.execution === 'data-binding'
              ? '数据绑定预览已生成；请选择目标设备并在数据面板中完成绑定。'
              : preview.summary,
        }
        if (messageIndex == null) return [...prev, result]
        const updated = [...prev]
        updated[messageIndex] = result
        return updated
      })
    },
    [
      buildCurrentSelectionCapabilityProfiles,
      sendArticraftMessage,
      sendFactoryMessage,
      sendImageTo3DMessage,
      sendMessage,
    ],
  )

  const installGenerationPlanPreviewPack = useCallback(
    async (preview: ChatGenerationPlanPreview, messageIndex: number) => {
      const pack = preview.requiredPack
      if (!pack || pack.installed) return
      setProfilePackImporting(true)
      setProfilePackStatus(`正在安装 ${pack.label} 行业资源包...`)
      try {
        const response = await fetch('/api/profile-packs/cloud', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pack.id, version: pack.version }),
        })
        const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
        if (!response.ok) throw new Error(data.message ?? data.error ?? response.statusText)
        await refreshProfilePacks()
        const refreshedPreview = await fetchGenerationPlanPreview(preview.prompt, preview.image)
        setProfilePackStatus(`${pack.label} 已安装，可以应用生成计划。`)
        setMessages((prev) => {
          const updated = [...prev]
          if (updated[messageIndex]?.generationPlanPreview) {
            updated[messageIndex] = {
              ...updated[messageIndex]!,
              generationPlanPreview: refreshedPreview,
            }
          }
          return updated
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setProfilePackStatus(`行业资源包安装失败：${message}`)
      } finally {
        setProfilePackImporting(false)
      }
    },
    [fetchGenerationPlanPreview, refreshProfilePacks],
  )

  const handleAssetSubmit = useCallback(() => {
    if (loading) return
    const text = input.trim()
    const attachedImage = generationMode === 'primitive' ? undefined : imageAttachment
    if (generationMode === 'image-to-3d' && !attachedImage) {
      void sendImageTo3DMessage(text, attachedImage)
      return
    }
    if (!text && !attachedImage) return

    void (async () => {
      try {
        const preview = await fetchGenerationPlanPreview(
          text || 'Describe the image and generate a 3D object.',
          attachedImage,
        )
        if (preview.applyMode === 'direct') {
          await executeGenerationPlanPreview(preview)
          return
        }
        setInput('')
        setImageAttachment(undefined)
        if (preview.route.kind === 'create-factory') {
          setConversationPurpose('factory')
          setModeMenuOpen(false)
        }
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: preview.prompt, ...(attachedImage ? { image: attachedImage } : {}) },
          { role: 'assistant', content: '', generationPlanPreview: preview },
        ])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: t('aiChat.error', {
              fallback: '出错了：{message}',
              params: { message },
            }),
          },
        ])
      }
    })()
  }, [
    executeGenerationPlanPreview,
    fetchGenerationPlanPreview,
    generationMode,
    imageAttachment,
    input,
    loading,
    sendImageTo3DMessage,
    t,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleAssetSubmit()
      }
    },
    [handleAssetSubmit],
  )

  const currentMode = AI_GENERATION_MODES.find((mode) => mode.id === generationMode) ?? AI_GENERATION_MODES[0]!
  const resolvedConversationPurpose =
    conversationPurpose ?? (messages.length > 0 ? 'asset' : undefined)
  const showConversationPicker = !resolvedConversationPurpose && messages.length === 0
  const isFactoryConversation = resolvedConversationPurpose === 'factory'
  const isAssetConversation = resolvedConversationPurpose === 'asset'
  const primitiveHasConfig = Boolean(aiProxyUrl || (baseUrl && apiKey))
  const enabledProfilePacks = profilePacks.filter((pack) => pack.enabled)
  const enabledProfileCount = enabledProfilePacks.reduce((sum, pack) => sum + pack.profileCount, 0)
  const loadedProfileCount = profilePackSummary.loadedProfileCount ?? profilePackDebug.length
  const profileConflictCount = profilePackSummary.conflictCount ?? 0
  const enabledPackNames = enabledProfilePacks
    .slice(0, 2)
    .map((pack) => pack.industry || pack.name)
    .join(', ')
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
                  const icon = conversationHistoryIcon(conversation)
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
                        onClick={() => switchConversation(conversation)}
                        type="button"
                      >
                        <span
                          className={cn(
                            'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border',
                            icon.className,
                          )}
                          title={icon.label}
                        >
                          <Icon className="size-3.5" icon={icon.icon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium">
                            {conversation.title || t('aiChat.newConversation', 'New conversation')}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
                            {conversation.activeRunCount > 0 ? (
                              <Icon className="size-3 shrink-0" icon="mdi:progress-clock" />
                            ) : null}
                            <span className="truncate">
                              {conversation.messageCount} {t('aiChat.messageCountLabel', 'messages')} ?{' '}
                              {new Date(conversation.updatedAt).toLocaleString()}
                            </span>
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
          <div className="flex min-h-full items-start justify-center px-2 pt-30 pb-8">
            <div className="w-full max-w-[22rem] space-y-6 text-center">
              <div className="space-y-1.5">
                <h3 className="font-medium text-base text-foreground">
                  开始新的 <span className="font-semibold text-xl">AI</span> 会话
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground/75">
                  选择任务类型，AI 会沿着对应流程工作。
                </p>
              </div>
              <button
                className="group w-full rounded-lg border border-border/70 border-l-2 border-l-[#a684ff]/70 bg-background/40 p-4 text-left shadow-sm shadow-black/10 transition-colors hover:border-[#a684ff]/60 hover:bg-[#a684ff]/10"
                data-testid="ai-chat-factory-purpose"
                onClick={() => selectConversationPurpose('factory')}
                type="button"
              >
                <div className="flex items-start gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#a684ff]/20 bg-[#a684ff]/5 text-[#a684ff]/60">
                    <Factory aria-hidden className="size-5 opacity-80" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[15px] text-foreground">
                      创建与修改工厂
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground/75">
                      创建厂房、车间、房间、区域布局，并持续修改当前画布内容。
                    </span>
                  </span>
                  <Icon
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:translate-x-0.5 group-hover:text-[#a684ff]"
                    icon="mdi:chevron-right"
                  />
                </div>
              </button>
              <button
                className="group w-full rounded-lg border border-border/70 border-l-2 border-l-sky-400/70 bg-background/40 p-4 text-left shadow-sm shadow-black/10 transition-colors hover:border-sky-400/55 hover:bg-sky-400/10"
                onClick={() => selectConversationPurpose('asset')}
                type="button"
              >
                <div className="flex items-start gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-sky-400/20 bg-sky-400/5 text-sky-300/60">
                    <Box aria-hidden className="size-5 opacity-80" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[15px] text-foreground">
                      工厂设备与品件
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground/75">
                      生成单个设备、机器、部件或图生模型，可放到画布或保存为品件。
                    </span>
                  </span>
                  <Icon
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:translate-x-0.5 group-hover:text-sky-300"
                    icon="mdi:chevron-right"
                  />
                </div>
              </button>
            </div>
          </div>
        )}
        {isAssetConversation && messages.length === 0 && (
          <div className="flex min-h-[15rem] flex-col items-center justify-center px-4 py-8 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/10 text-sky-300">
              <Box aria-hidden className="size-5" />
            </span>
            <p className="text-xs font-medium text-foreground">准备生成设备</p>
            <p className="mt-1 max-w-[15rem] text-[11px] leading-relaxed text-muted-foreground">
              在底部输入需求，AI 会生成可放置或保存的设备模型。
            </p>
          </div>
        )}
        {isFactoryConversation && messages.length === 0 && (
          <div className="flex min-h-[15rem] flex-col items-center justify-center px-4 py-8 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-[#a684ff]/25 bg-[#a684ff]/10 text-[#a684ff]">
              <Factory aria-hidden className="size-5" />
            </span>
            <p className="text-xs font-medium text-foreground">准备构建工厂布局</p>
            <p className="mt-1 max-w-[15rem] text-[11px] leading-relaxed text-muted-foreground">
              在底部描述厂房、车间或当前画布修改需求。
            </p>
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
            ) : msg.generationPlanPreview ? (
              <GenerationPlanPreviewCard
                disabled={loading || profilePackImporting}
                onApply={() => void executeGenerationPlanPreview(msg.generationPlanPreview!, i)}
                onCancel={() => {
                  setMessages((prev) => prev.filter((_, index) => index !== i))
                }}
                onEditPrompt={() => {
                  setInput(msg.generationPlanPreview!.prompt)
                  setImageAttachment(msg.generationPlanPreview!.image)
                  setMessages((prev) => prev.filter((_, index) => index !== i))
                  inputRef.current?.focus()
                }}
                onInstallPack={() =>
                  void installGenerationPlanPreviewPack(msg.generationPlanPreview!, i)
                }
                preview={msg.generationPlanPreview}
              />
            ) : msg.factoryRunSummary &&
              !msg.modelArtifact &&
              !msg.geometryArtifact &&
              !msg.imageTo3dResult &&
              !msg.articraftResult ? (
              <FactoryRunSummaryCard
                disabled={loading}
                onResourceOptionSelect={(option) => {
                  void sendMessage(option.prompt)
                }}
                summary={msg.factoryRunSummary}
              />
            ) : msg.modelArtifact ? (
              <div className="space-y-2">
                {msg.factoryRunSummary ? <FactoryRunSummaryCard summary={msg.factoryRunSummary} /> : null}
                <GeneratedModelCard
                  artifact={msg.modelArtifact}
                  disabled={loading}
                  onPlace={handlePlaceModelArtifact}
                  onSave={handleSaveModelArtifact}
                />
              </div>
            ) : msg.geometryArtifact ? (
              <div className="space-y-2">
                {msg.factoryRunSummary ? <FactoryRunSummaryCard summary={msg.factoryRunSummary} /> : null}
                <GeneratedGeometryCard
                  artifact={msg.geometryArtifact}
                  disabled={loading}
                  interactivePreview={msg.geometryArtifact.id === latestVisibleGeometryArtifactId}
                  onPlace={handlePlaceGeometryArtifact}
                  onReplace={handleReplaceGeometryArtifact}
                  onSave={handleSaveGeometryArtifact}
                />
              </div>
            ) : msg.toolCalls ? (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="size-3.5 shrink-0" icon="mdi:tools" />
                <span>
                  {t('aiChat.calling', 'Calling tools...')} {msg.toolCalls.map((tc) => tc.name).join(', ')}
                </span>
              </div>
            ) : msg.imageTo3dResult ? (
              <div className="space-y-2">
                {msg.factoryRunSummary ? <FactoryRunSummaryCard summary={msg.factoryRunSummary} /> : null}
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
              </div>
            ) : msg.articraftResult ? (
              <div className="space-y-2">
                {msg.factoryRunSummary ? <FactoryRunSummaryCard summary={msg.factoryRunSummary} /> : null}
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
                  {(() => {
                    const isPlaced = msg.articraftResult!.status === 'imported'
                    const canPlaceArticraft = Boolean(msg.articraftResult!.data)
                    return (
                      <button
                        className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={loading || !canPlaceArticraft}
                        onClick={() => handleImportArticraftResult(msg.articraftResult!)}
                        type="button"
                      >
                        <Icon className="size-3.5" icon="mdi:import" />
                        {isPlaced ? 'Place again' : 'Place on canvas'}
                      </button>
                    )
                  })()}
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => void openArticraftViewer(msg.articraftResult!.recordId)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:open-in-new" />
                    Open Articraft Viewer
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => void openArticraftViewer(msg.articraftResult!.recordId, 'code')}
                    title={msg.articraftResult.recordPath || undefined}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:file-document-outline" />
                    View source record
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

      <input
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        disabled={profilePackImporting}
        onChange={handleProfilePackSelected}
        ref={profilePackInputRef}
        type="file"
      />
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
            onClick={loading ? handleStopGeneration : handleAssetSubmit}
            title={loading ? 'Stop generation' : 'Send'}
            type="button"
          >
            <Icon className="size-4" icon={loading ? 'mdi:stop' : 'mdi:send'} />
          </button>
        </div>
      </div>
      ) : isFactoryConversation ? (
        <div className="border-border/50 border-t px-3 py-2">
        {generationMode === 'primitive' ? (
          <div className="mb-1.5 rounded-lg border border-border/60 bg-accent/20 px-2 py-1.5">
            <button
              aria-expanded={factoryProfilePackCardOpen}
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setFactoryProfilePackCardOpen((open) => !open)}
              type="button"
            >
              <Icon className="size-3.5 shrink-0 text-[#a684ff]" icon="mdi:package-variant" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] text-muted-foreground">
                  已启用 {enabledProfilePacks.length} 个资源包 / 共 {enabledProfileCount} 个 profile / 已加载{' '}
                  {loadedProfileCount} 个
                </div>
              </div>
              <Icon
                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', factoryProfilePackCardOpen && 'rotate-180')}
                icon="mdi:chevron-down"
              />
            </button>
            {factoryProfilePackCardOpen ? (
              <div className="mt-1 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground/80">
                    {enabledPackNames ? <span>{enabledPackNames}</span> : <span>未安装行业包时使用内置 profile</span>}
                    {profileConflictCount > 0 ? <span>覆盖冲突 {profileConflictCount}</span> : null}
                    {profilePackWarningCount > 0 ? <span>警告 {profilePackWarningCount}</span> : null}
                  </div>
                  {profilePackStatus ? (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
                      {profilePackStatus}
                    </div>
                  ) : null}
                </div>
                <a
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff]"
                  href="/profile-packs"
                  rel="noreferrer"
                  target="_blank"
                  title="下载/管理资源包"
                >
                  <Icon className="size-3.5" icon="mdi:cloud-download-outline" />
                  下载/管理
                </a>
                <button
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={profilePackImporting}
                  onClick={() => profilePackInputRef.current?.click()}
                  title="导入行业资源包 zip"
                  type="button"
                >
                  <Icon
                    className={cn('size-3.5', profilePackImporting && 'animate-spin')}
                    icon={profilePackImporting ? 'mdi:loading' : 'mdi:archive-arrow-up-outline'}
                  />
                  导入
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mb-2 rounded-lg border border-[#a684ff]/25 bg-[#a684ff]/10 px-2.5 py-1.5">
          <button
            aria-expanded={factorySelectionCardOpen}
            className="flex w-full items-center gap-1.5 text-left text-[10px] text-muted-foreground"
            onClick={() => setFactorySelectionCardOpen((open) => !open)}
            type="button"
          >
            <Icon
              className="size-3.5 shrink-0 text-[#a684ff]"
              icon="mdi:cursor-default-click-outline"
            />
            <span className="min-w-0 flex-1 truncate">已选中：{factorySelectionLabel}</span>
            <Icon
              className={cn('size-3.5 shrink-0 transition-transform', factorySelectionCardOpen && 'rotate-180')}
              icon="mdi:chevron-down"
            />
          </button>
          {factorySelectionCardOpen ? (
            <>
              <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">
                单击选整机，按住 Ctrl 可叠加选多个对象。
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {['make blue', 'move left 1m', 'rotate 90 degrees', 'delete this'].map((hint) => (
                  <button
                    className="rounded-md border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-[#a684ff]/50 hover:text-[#a684ff]"
                    disabled={loading}
                    key={hint}
                    onClick={() => setInput(hint)}
                    type="button"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
          <div className="relative">
            <textarea
              className={cn(
                'w-full resize-none rounded-lg border border-border/60 bg-accent/30 px-2.5 py-1.5 pr-8 pb-11 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-[#a684ff]/50 focus:outline-none focus:ring-1 focus:ring-[#a684ff]/30',
                inputExpanded ? 'min-h-[132px]' : 'min-h-[72px]',
              )}
              data-testid="factory-chat-input"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
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
              data-testid="factory-chat-send"
              disabled={!input.trim() || loading}
              onClick={handleAssetSubmit}
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
