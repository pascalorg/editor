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
  buildGeometryHarnessContext,
  latestGeneratedGeometryArtifact,
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
      'Create editable primitive shapes in the 3D scene. Choose the primitive that matches each surface type: boxes/panels, cylinders/tubes, cones/frustums, hemispheres, torus rings, wedges/trapezoids, capsules, half-cylinders, lathes, extrusions, or swept tubes. Use attachTo/anchor/childAnchor for connected parts instead of hand-computing offsets.',
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
                  'extrude',
                  'sweep',
                ],
                description:
                  'Primitive type. box=solid cuboid, rounded-panel=thin bevelled rounded rectangle, cylinder=solid circular extrusion, hollow-cylinder=tube/pipe, cone=pointed circular cone, frustum=truncated cone/circular taper, hemisphere=closed dome, torus=ring/donut tube, wedge=sloped triangular prism, trapezoid-prism=tapered rectangular prism, capsule=rounded-ended bar, half-cylinder=semicircular extrusion, sphere=ellipsoid, lathe=revolved vertical profile, extrude=custom 2D profile with depth, sweep=tube along a 3D path.',
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
                  'Primary axis. For cylinder/hollow-cylinder/cone/frustum/capsule/half-cylinder/hemisphere it is the length/dome-up axis. For torus it is the ring normal/axle axis. "y"=vertical, "x"=left-right, "z"=front-back. Vehicle wheels should use torus or cylinder with axis="x".',
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
      'Create an editable primitive object from a built-in deterministic recipe pack. Prefer this for supported high-friction families so the model selects a recipe and fills compact params instead of hand-authoring a large compose_parts schema. Supported recipeId values: vehicle.sedan, vehicle.suv, vehicle.sports, vehicle.van, vehicle.truck, valve.gate, valve.ball, robotArm.threeAxis.',
    parameters: {
      type: 'object',
      properties: {
        recipeId: {
          type: 'string',
          enum: [
            'gear.spur',
            'vehicle.sedan',
            'vehicle.suv',
            'vehicle.sports',
            'vehicle.van',
            'vehicle.truck',
            'valve.gate',
            'valve.ball',
            'robotArm.threeAxis',
          ],
          description:
            'Built-in primitive recipe id. Use gear.spur for toothed spur gears, vehicle.sedan for normal small cars, valve.ball for ball valves, valve.gate for gate valves, and robotArm.threeAxis for 3-axis robot arms.',
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
              description: 'Coarse size. Use small for ???/small car when exact dimensions are omitted.',
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
            vehicleStyle: {
              type: 'string',
              enum: ['sedan', 'suv', 'sports', 'van', 'truck'],
              description: 'Vehicle style hint; normally implied by recipeId.',
            },
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
              description: 'Robot arm base shape. Use round for ????.',
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
            outerDiameter: { type: 'number', description: 'gear.spur outside/tip diameter in meters.' },
            pitchDiameter: { type: 'number', description: 'gear.spur pitch diameter in meters.' },
            rootDiameter: { type: 'number', description: 'gear.spur root diameter in meters.' },
            thickness: { type: 'number', description: 'gear.spur axial thickness in meters.' },
            boreDiameter: { type: 'number', description: 'gear.spur center bore diameter in meters.' },
            keywayWidth: { type: 'number', description: 'gear.spur keyway width in meters.' },
            keywayDepth: { type: 'number', description: 'gear.spur keyway radial depth in meters.' },
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

const COMPOSE_PARTS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_parts',
    description:
      'Create one editable object from reusable procedural parts. Use this when raw primitives are too low-level but a full object template is not appropriate. Good for factory/mechanical equipment, office desks, electrical cabinets, cable trays, process pipes, bicycles, cars, pumps, blowers, industrial fans, motors, conveyors, tanks, valves, pipe ports, flanges, skid bases, control boxes, vents, grilles, fan heads, poles, brackets, knobs, and slatted panels.',
    parameters: {
      type: 'object',
      properties: {
        geometryBrief: GEOMETRY_BRIEF_SCHEMA,
        name: { type: 'string', description: 'Object name, e.g. "standing fan".' },
        partName: {
          type: 'string',
          description: 'Compatibility alias for name. Prefer name in new tool calls.',
        },
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
            'Reusable parts to procedurally expand into primitives. For a standing fan use circular_base + vertical_pole + support_bracket + motor_housing + radial_blades + protective_grill + optional control_knob. For desks with visible drawers use desk_top + leg_set + drawer_stack. For electrical/control cabinets use electrical_cabinet + cable_tray + nameplate/warning details. For pipe systems use pipe_run + pipe_elbow + flange_ring/valve_body. For a bicycle use bicycle_wheels exactly once (it is a front+rear two-wheel wheelset) + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop. For a car use vehicle_body + vehicle_wheels + vehicle_windows + headlights + bumper. For a water pump / centrifugal blower use skid_base + ribbed_motor_body or rounded_machine_body + volute_casing + inlet_port + outlet_port + flange_ring + optional impeller_blades + control_box. For conveyors use conveyor_frame + roller_array + belt_surface. For tanks use cylindrical_tank plus pipe/flange details. For valves use valve_body plus optional handwheel; set valveStyle/handleStyle for variants such as ball valves instead of inventing internal parts. For factory scenes use gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, platform_ladder, electrical_cabinet, cable_tray, pipe_run, and pipe_elbow.',
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
                  'support_bracket',
                  'control_knob',
                  'vent_slats',
                  'skid_base',
                  'rounded_machine_body',
                  'volute_casing',
                  'impeller_blades',
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
                  'valve_body',
                  'handwheel',
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
                ],
                description:
                  'Reusable procedural part. protective_grill creates a shallow domed fan cage; radial_blades creates airfoil-like fan blades; desk_top/leg_set/drawer_stack build office desks; electrical_cabinet/cable_tray build power/control cabinets and tray routes; pipe_run/pipe_elbow build process piping; bicycle_wheels is one complete front+rear wheelset and should not be duplicated for a normal bicycle; bicycle_* parts build frames/wheels/forks/chain; vehicle_* parts build car bodies/wheels/windows/lights; volute_casing creates pump/blower scroll casing; impeller_blades creates pump/turbine vanes; pipe/inlet/outlet/flange/bolt parts create industrial connection details; ribbed_motor_body, conveyor_frame, roller_array, belt_surface, cylindrical_tank, valve_body, handwheel, gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, and platform_ladder cover common factory equipment.',
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
                  'valve_body style hint. Use "ball" for ball valves / 球阀 / quarter-turn valves; omit for the default gate-valve-like body.',
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
              sizeScale: {
                type: 'number',
                description:
                  'vehicle_body overall scale multiplier when exact dimensions are not specified. Use about 0.8 for a small car and 1.0 for a normal sedan.',
              },
              count: { type: 'number', description: 'Generic count, e.g. blade count.' },
              ringCount: { type: 'number', description: 'protective_grill curved concentric ring count. Use 4-5 for a fan guard.' },
              spokeCount: { type: 'number', description: 'protective_grill radial spoke count. Use 12-24 for a fan guard.' },
              wireRadius: { type: 'number', description: 'protective_grill wire thickness.' },
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
              bladeRadius: { type: 'number', description: 'radial_blades outer blade reach.' },
              bladeWidth: { type: 'number', description: 'radial_blades max blade chord width. Use about 20-30% of bladeRadius.' },
              bladePitch: { type: 'number', description: 'radial_blades blade pitch/twist hint in radians. Use 0.18-0.32 for visible real-fan tilt.' },
              bladeSweep: { type: 'number', description: 'radial_blades tangential sweep/curvature amount. Positive values make the tips sweep back like real fan blades.' },
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

const COMPOSE_OBJECT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'compose_object',
    description:
      'Create a stable editable low-poly object from curated category templates. Prefer this for simple furniture/appliance templates such as chairs/stools, sofas, outdoor AC units, keyboards, monitors/displays, tables/desks, shelves, and cabinets. For cars/vehicles, prefer compose_parts with reusable vehicle parts instead of this object template.',
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
            'Object category. Use chair for chairs/stools, outdoor-ac for air conditioner outdoor units, sofa, keyboard, monitor/display/screen, table/desk, shelf/rack, cabinet/cupboard, or generic. Use vehicle only for legacy simple blockouts; prefer compose_parts for cars/vehicles.',
        },
        model: {
          type: 'string',
          description: 'Requested model or product name, e.g. "Tesla Model Y", "air conditioner outdoor unit", "空调外机", or "写字桌".',
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
        'extrude',
        'sweep',
      ],
    },
    name: { type: 'string' },
    semanticRole: { type: 'string' },
    semanticGroup: { type: 'string' },
    sourcePartKind: { type: 'string' },
    sourcePartId: { type: 'string' },
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
      'Patch the previous generated geometry artifact in response to user feedback. Prefer this for follow-up revision requests such as "roof looks wrong", "windows are detached", "make it smoother", "adjust proportions", or "keep the body but change the cabin". It preserves existing shapes unless operations remove/replace them.',
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
            'Local edit operations. Use selectors by semanticRole/sourcePartKind/nameIncludes. For A/B/C pillars, add body-color pillars then use materialFrom from vehicle_body.',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['add', 'remove', 'replace', 'transform', 'resize', 'materialFrom', 'align'],
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

type ComposeTool = typeof COMPOSE_OBJECT_TOOL | typeof COMPOSE_RECIPE_TOOL | typeof COMPOSE_PARTS_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL | typeof COMPOSE_PRIMITIVE_TOOL | typeof REVISE_GEOMETRY_TOOL

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
    `已自动修复 ${results.length} 次；以下保留最近 ${GEOMETRY_VISIBLE_RESULT_TAIL} 条压缩上下文。`,
    ...results.slice(-GEOMETRY_VISIBLE_RESULT_TAIL),
  ].join('\n')
}

const BASE_RULES = `You are the 3D modeling assistant inside the Pascal editor. You work in 2 stages: analyze, generate.

Available tools:
- compose_object(...): Create stable editable low-poly whole objects from simple category templates. Prefer for chair/stool, sofa, outdoor AC unit, keyboard, monitor/display, table/desk, shelf/rack, cabinet. Do not use it as the default for cars/vehicles; use compose_recipe or compose_parts vehicle parts.
- compose_recipe(...): Create one editable object from a built-in deterministic recipe pack. Prefer for gear.spur, vehicle.sedan/suv/sports/van/truck, valve.gate/ball, and robotArm.threeAxis; pass recipeId plus compact params instead of hand-writing a large schema. Vehicle recipes create an integrated glasshouse, body-color pillars/roof rails, wheels, lights, bumpers, and body shaping by default.
- compose_parts(...): Create one editable object from reusable procedural parts. Use one part entry per semantic module unless that part exposes an explicit count field; do not duplicate wheelset-style parts to express visual count.
- compose_primitive(shapes): Create custom box, rounded-panel, cylinder, hollow-cylinder, cone, frustum, hemisphere, torus, wedge, trapezoid-prism, capsule, half-cylinder, sphere, lathe, extrude, or sweep shapes for unsupported categories or user-specified individual parts.
- compose_robot_arm(...): Create editable robot arm drafts. Prefer for robot/cobot/FANUC/manipulator requests; set axisCount/baseShape/endEffector from the user instead of hand-building robot arms from raw primitives.
- revise_geometry(...): Patch the previous generated artifact for follow-up customer feedback. Prefer this when a revision context is present and the user says something looks wrong, asks to adjust proportions/materials/details, or wants one part changed while preserving the rest.

===== COORDINATE SYSTEM =====
+X = left/right width, +Y = up, +Z = depth/front-back. y=0 is the ground plane.
Position [x,y,z] is always the geometric center of the shape.
Rotation [rx,ry,rz] is Euler angles in radians.

===== REALITY GUARD =====
Before generating, maintain an internal geometry brief: category, units, coordinate convention, expected dimensions, required semantic roles, validation targets, and assumptions. In the final tool call include geometryBrief for compose_parts or compose_primitive; compose_recipe supplies a recipe brief automatically unless an override is needed. For hand-built compose_primitive objects, add semanticRole to validation-critical shapes so the tool can reject unrealistic geometry instead of saving it.

===== PRIMITIVE CAPABILITIES =====
BOX = rectangular block with flat faces; set cornerRadius for rounded corners. Use sharp boxes for construction panels and rounded boxes for vehicle bodies, appliance shells, plastic/metal housings, cabinets, furniture, and softened manufactured parts.
CYLINDER = solid round bar/rod/disc. Use for rods, fans, vents, solid legs, columns. HOLLOW-CYLINDER = tube/pipe with wall thickness for cups, ducts, barrels, tire-like rings when torus is not appropriate.
CONE = circular cone. Use for traffic cones, pointed tips, lamp shades, roof caps. FRUSTUM = truncated cone/circular taper. Use for cups, flower pots, tapered legs, lamp bases, industrial fittings.
HEMISPHERE = closed half-sphere/dome. Use for buttons, camera covers, lamp covers, domes, rounded appliance caps. TORUS = ring/donut tube. Use for tires, steering wheels, seals, fan rims, handles, rings.
WEDGE = sloped triangular prism. Use for ramps, car hoods, keyboard side profiles, angled backs. TRAPEZOID-PRISM = tapered rectangular block. Use for trapezoid shells, plinths, tapered cushions, appliance bodies.
CAPSULE = cylinder with hemispherical ends. Use for soft bolsters, sofa arms, pillows, rounded handles, rails, grips, and organic rounded bars.
HALF-CYLINDER = semicircular extrusion with one flat cut face. Use for fenders, arched covers, half pipes, rounded roof caps, and protective shells.
ROUNDED-PANEL = thin bevelled rounded rectangle. Use for screens, keycaps, cushions, control panels, appliance front plates, and device faces.
SPHERE = full ball/ellipsoid. Use sparingly for domes/canopies only; a scaled sphere is still a blob with rounded edges.
LATHE = vertical radial profile. Use for vases, bowls, lamps, bells, turned parts.
EXTRUDE = closed custom 2D profile with depth. Use for non-rectangular plates, handles, logos, brackets, silhouettes, and shaped vents.
EXTRUDE holes = optional inner cutout loops for bores/slots/keyways. Use profile for the outer outline and holes for internal cutouts. Do not describe the profile in text only; the tool call must include numeric profile arrays.
SWEEP = circular tube along a 3D path. Use for cables, hoses, curved handles, rails, bumper arcs, and pipes with bends.

===== TEMPLATE-FIRST RULE =====
If the requested object matches a supported compose_object category, use compose_object instead of hand-building raw primitives. Cars/vehicles are intentionally excluded because they should be assembled from reusable parts, not a one-off object template:
- chair/stool/椅子/板凳 -> compose_object({category:"chair"})
- air conditioner outdoor unit / AC condenser / 空调外机 / 空调外置机 -> compose_object({category:"outdoor-ac"})
- sofa/couch/沙发 -> compose_object({category:"sofa"})
- keyboard/键盘 -> compose_object({category:"keyboard"})
- monitor/display/screen/显示器/屏幕 -> compose_object({category:"monitor"})
- table/desk/桌子/写字桌/书桌 -> compose_object({category:"table"})
- shelf/rack/架子/货架 -> compose_object({category:"shelf"})
- cabinet/cupboard/柜子/橱柜 -> compose_object({category:"cabinet"})
Use compose_object only when the template category satisfies the complete request. If the user asks for extra structural features not guaranteed by the template (drawers, doors, shelves, compartments, special handles, asymmetry, exact count of subparts), build the whole object with ONE compose_parts call when reusable parts cover it, otherwise ONE compose_primitive call.

===== PART-FIRST RULE =====
Use compose_recipe first when the object matches a built-in recipe: normal cars/SUVs/sports cars/vans/trucks, gate valves, ball valves, or 3-axis robot arms. Use compose_parts when the object is best described as reusable procedural parts but no built-in recipe fits. For standing fan / electric fan / floor fan requests, call compose_parts once with these parts: circular_base, vertical_pole, support_bracket, motor_housing, radial_blades(count:3), protective_grill(ringCount:4-5, spokeCount:18-24, depth:0.10-0.14, domeDepth:0.07-0.12), and optional control_knob. This is not a hard-coded fan template; it is a reusable mechanical part blueprint.
For factory equipment such as water pumps, centrifugal blowers, industrial fans, conveyors, tanks, valves, and motorized pipe equipment, call compose_parts once with a mechanical blueprint. For pumps/blowers use skid_base, ribbed_motor_body or rounded_machine_body, volute_casing, inlet_port, outlet_port, flange_ring, optional impeller_blades, control_box, and vent_slats. Do not approximate pumps/blowers as plain boxes; include a scroll/volute casing plus pipe ports and flanges. flange_ring already includes bolts by default, so add separate bolt_pattern only for extra casing bolts.
Use part-level direction controls when realism depends on orientation: side for pipe/flange open ends, outletAngle for volute discharge direction, rotation for rotated motors/conveyors/tanks, and includeBolts:false when a plain flange or separate bolt_pattern is needed.
Use connectTo + connectPoint + childPoint when one part should snap to another instead of manually guessing offsets. Example: give a pipe_port id:"outlet", then create flange_ring with connectTo:"outlet", connectPoint:"open", childPoint:"back" so the flange attaches to the pipe end. For volute_casing use connectPoint:"inlet" or "outlet"; for motors use "shaft"; for valves use "inlet"/"outlet". Legacy anchor/childAnchor still works for simple top/front/back/left/right snapping.
For office desks that need visible structure beyond the table template, use desk_top + leg_set and add drawer_stack for drawers. Keep explicit user length/width/height in meters: desk_top.length is X, desk_top.width is Z depth, leg_set should use the same footprint, and leg height should bring the top to the requested height.
For electrical/control cabinets, use electrical_cabinet with cable_tray plus nameplate/warning_label/vent details when realism is requested. For process piping or pipe corridors, use pipe_run for straight spans, pipe_elbow for 90-degree bends, and flange_ring/valve_body for connection details.
For bicycles, use bicycle_wheels exactly once (front+rear two-wheel wheelset) + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop. Do not output bicycle_wheels twice, even if the analysis says the bicycle has two wheels. The chain_loop part creates an elongated chain run, front chainring, and rear sprocket; do not replace it with a circular torus. In geometryBrief.requiredRoles use bicycle_tire + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop, not bicycle_wheels. For cars/vehicles/汽车/小轿车, call compose_parts once with reusable parts vehicle_body + vehicle_wheels + vehicle_windows + headlights + bumper; set top-level primaryColor or vehicle_body.primaryColor/color from the user's requested color (e.g. 红色 -> #cc0000). Put the requested overall vehicle dimensions, vehicleStyle, and optional sizeScale on vehicle_body (sedan/suv/sports/van/truck; use sizeScale:0.8 for a small car when exact dimensions are omitted); then keep vehicle_wheels, vehicle_windows, headlights, and bumper mostly semantic (usually no manual position or rotation) so compose_parts can align axles, glass, lights, and bumpers from the body. Use kind/name, not partType/partName, in new calls. Use vehicleStyle:"sedan" for normal cars, "suv" for SUV/off-road, "sports" for sports/racing cars, "van" for vans/MPVs, and "truck" for pickup/trucks. When the user asks for roof corners that are not 90 degrees, an 85-degree roof, sloped pillars, or a more car-like roofline, set vehicle_body.roofCornerAngle around 85 or cabinTopScale around 0.85 so compose_parts uses a tapered trapezoid cabin instead of a rectangular cabin box.
For follow-up requests like "make the car smoother / 线条再丝滑点", revise the previous compose_parts vehicle call instead of switching to hand-built compose_primitive. Increase vehicle_body cornerRadius/cornerSegments, set detail:"high" and enhanceVisualDetails:true, and for non-90-degree roof corners set vehicle_body.roofCornerAngle:85 or cabinTopScale:0.85. Keep vehicle_wheels semantic so wheel thickness/axles remain valid.
For other factory equipment, use conveyor_frame + roller_array + belt_surface for belt conveyors, cylindrical_tank for tanks/vessels, ribbed_motor_body for electric motors, gearbox_body for reducers, filter_vessel for filters, heat_exchanger for shell-and-tube exchangers, agitator_tank for mixing tanks, pipe_rack for pipe corridors, platform_ladder for access platforms, and valve_body + handwheel for valves. For gate valves and ball valves, prefer compose_recipe with recipeId "valve.gate" or "valve.ball". For custom valves in compose_parts, do not list internal generated roles such as stem, bonnet, yoke, gate_wedge, bonnet_bolts, seat_ring, or flange_inlet/flange_outlet as separate parts. Use valve_body once, handwheel only when you need an explicit handle override, and let compose_parts auto-complete inlet/outlet flange_ring attachments. For ball valves / 球阀 / quarter-turn valves, set valve_body.valveStyle:"ball" and handwheel.handleStyle:"lever" if you include the handle explicitly; otherwise the ball-valve request can infer these defaults. Prefer style/variant fields over inventing unsupported tiny part kinds. Add nameplate, warning_label, seam_ring, vent_slats, flange bolts, and pipe ports for visual detail. Keep autoComplete omitted unless you explicitly need a minimal standalone subpart; omitted autoComplete lets compose_parts run family self-check and add missing required structure for recognized fan/pump/conveyor/bicycle/car/valve/desk/electrical/pipe blueprints. It does not add every optional visual detail automatically, so include requested details explicitly.
When the user asks for "realistic", "detailed", "\u771f\u5b9e", "\u7ec6\u8282", or similar, set enhanceVisualDetails:true on compose_parts. This may add non-essential visual details such as pump impellers, nameplates, warning labels, fan control knobs, conveyor drive motors, vehicle seam/nameplate details, desk drawers, pipe elbows/flanges, and electrical cabinet trays/labels.
Use protective_grill instead of a single torus whenever the user asks for a cage/guard/protective grille: it creates a shallow half-round cage with curved concentric rings, radial spokes, side ribs, and rear outer ring. The grill should not be a flat plane; set depth and optional domeDepth for a bowl/half-dome silhouette.
Use radial_blades instead of hand-made rectangles whenever the user asks for fan blades: it creates swept extruded leaf/airfoil blades with narrow roots, wider curved tips, root collars, pitch, and a hub. For realistic fan blades, set count:3, bladeWidth about 0.06-0.09, bladePitch about 0.22-0.30, and optional bladeSweep about 0.02-0.04.
Use volute_casing for centrifugal pump/blower housings; pair it with inlet_port/outlet_port and flange_ring so the object reads as factory equipment rather than furniture.

===== GEOMETRY RULES =====
- If the prompt contains a previous generated geometry summary, treat the user message as a customer revision. Use revise_geometry by default, not a full regeneration. Preserve approved traits such as body color, wheels, scale, lights, and existing semantic roles unless the user explicitly asks to change them.
- In revise_geometry, explain the local edit through intent/userVisiblePlan, then provide concrete operations. Use replace for one subassembly, transform/resize/align for proportional fixes, materialFrom to inherit user-defined colors/materials, and add/remove for details. For a car cabin/roof/window complaint, a good generic strategy is: keep body/wheels/lights, replace the cabin area with an integrated glasshouse, add A/B/C pillars and roof frame, then materialFrom those pillars/frame from vehicle_body. Never hard-code red for pillars; inherit the body material.
- Build a recognizable silhouette first: main volume + 2-8 distinctive features.
- Preserve explicit user dimensions. Convert mm/cm/m to meters. For furniture such as desks/tables, user "长/length" maps to X footprint width and user "宽/width" maps to Z front-back depth; "高/height" maps to Y height. Example: 写字桌长120cm宽60cm高75cm => compose_object({category:"table", width:1.2, depth:0.6, height:0.75}).
- Field names are strict: box/rounded-panel use length=X left-right, width=Z front-back depth, height=Y vertical. If you think "width/depth/height", output length=width and width=depth. Never omit length for drawer faces, handles, desks, or panels.
- Cylinder/capsule/half-cylinder use height as the distance along axis. Table legs must include height, e.g. cylinder axis="y", radius=0.025, height=0.7.
- Materials are strict: use material:{properties:{color:"#C4956A", roughness:0.6, metalness:0}} or materialPreset:"wood". For wood-colored objects, set the material on every visible wood part, not only in analysis text.
- Output exactly ONE geometry tool call for the final object. Do not call compose_object/compose_parts/compose_primitive in separate calls to add details.
- A multi-part tool call is saved as ONE selectable assembly in the scene. Put every part of the same object in the same call so the user can move, rotate, select, and delete the whole object together.
- attachTo indexes are local to the shapes array inside the same compose_primitive call only. Parent must appear before child. Never reference shapes from a previous tool call.
- Never set attachTo by itself. If a part must be under/on/front/back/side of another part, include explicit anchors: under desktop -> attachTo desktop, anchor="bottom", childAnchor="top"; on top -> anchor="top", childAnchor="bottom"; front face handle -> anchor="front", childAnchor="back". If you already computed an absolute world position and do not need snapping, omit attachTo.
- Support stack rule: lower support's top connects to upper part's bottom. Example: a seat on legs uses parent leg anchor="top", childAnchor="bottom"; a hanging drawer under a desktop uses parent desktop anchor="bottom", childAnchor="top".
- Use cornerRadius on boxes that should not read like sharp shipping containers: cars, appliances, electronics, molded furniture, machine housings.
- Do not default to sphere. Sphere is not a curved panel; it becomes a blob if too tall or too large.
- For broad curved rectangular surfaces, prefer a rounded box for the main mass plus a shallow sphere/ellipsoid only for domes or glass canopies.
- For cylinders, use axis ("x"/"y"/"z") rather than manual rotation.
- For hand-built compose_primitive vehicles only: keep a consistent front-back axis and use torus/cylinder wheel axes perpendicular to the car side. For normal car requests, prefer compose_parts vehicle parts instead of manually building raw primitives.
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

Start with a concise Geometry brief covering: model/category, units, coordinate convention, overall dimensions, required semantic roles, validation targets, and assumptions.

First decide whether the request matches a compose_object category. If yes, say the chosen category and key visual traits.
If the request matches a built-in recipe, choose compose_recipe and list recipeId plus compact params. If the request is a mechanical/appliance object made from reusable parts but no recipe fits, choose compose_parts and list the part blueprint. List semantic part entries, not raw visual counts; for example bicycle_wheels is one front+rear wheelset entry, not two entries.
If the request includes extra structural features beyond a template category, choose compose_primitive instead and decompose the whole object yourself.
If not, decompose into reusable parts or primitives. For each part specify:
1. Name
2. Primitive kind (box/rounded-panel/cylinder/hollow-cylinder/cone/frustum/hemisphere/torus/wedge/trapezoid-prism/capsule/half-cylinder/sphere/lathe/extrude/sweep)
3. Key dimensions in meters; for box or panel parts, whether they need cornerRadius/bevel and why
4. World-space position [x, y, z]
5. Why this primitive matches the surface
`

const STAGE1_REVISION_ANALYST = `You are revising an existing generated primitive geometry artifact in Pascal editor.
The user message includes a compact summary of the previous artifact.

Analyze the customer's feedback in Chinese. Output TEXT ONLY. Do not call tools.

Your analysis must be concise:
1. Identify the specific visual/structural problem.
2. State what must be preserved from the current artifact.
3. State the local revision strategy.
4. Prefer revise_geometry unless the user explicitly asks for a completely new object.

For car cabin/roof/window complaints, a good generic strategy is: preserve body/wheels/lights/scale/material intent, replace or adjust only the cabin/roof/window subassembly, use integrated glasshouse if useful, add A/B/C pillars or roof frame if useful, and inherit body material via materialFrom instead of hard-coding a color.
`

const STAGE2_GENERATOR = `${BASE_RULES}

===== STAGE 2: GENERATE =====
Based on the analysis, call compose_object, compose_recipe, compose_parts, compose_robot_arm, or compose_primitive to create the geometry.

- If the user request includes previous generated geometry context, call revise_geometry unless a full replacement is explicitly requested. The revision should preserve current approved traits and patch only the complained-about subassembly/details.
- For common simple whole objects (chair, sofa, outdoor AC unit, keyboard, monitor, table/desk, shelf, cabinet), call compose_object once only when the template fully covers the request.
- For built-in primitive recipes, call compose_recipe once: gear.spur for spur gears, vehicle.sedan/suv/sports/van/truck for cars, valve.gate/ball for those valve families, and robotArm.threeAxis for 3-axis robot arms.
- For other reusable mechanical/appliance/factory/vehicle part blueprints such as standing fans, bicycles, water pumps, blowers, industrial fans, motors, conveyors, tanks, valves, gearboxes, filters, heat exchangers, agitator tanks, pipe racks, platforms, office desks with drawers, electrical cabinets, cable trays, pipe runs/elbows, fan grilles, radial blades, volute casings, pipe ports, flanges, bolts, skid bases, vents, poles, bases, and brackets, call compose_parts once.
- If the user requested extra structural features or exact subpart counts not expressible by compose_recipe or compose_parts, do not mix tools; call compose_primitive once with the complete object.
- For robot arms not covered by robotArm.threeAxis, call compose_robot_arm once. Set axisCount:3 for "3-axis / three-axis", baseShape:"round" for round/circular base, pose:"work-ready" for a readable bent silhouette, and endEffector:"gripper" unless the user asks otherwise.
- Otherwise call compose_primitive once with all shapes. Parent before child.
- Include geometryBrief as a top-level argument in compose_parts or compose_primitive, not inside metadata. For compose_recipe, omit geometryBrief unless you need to override the recipe brief. For compose_primitive vehicles/bicycles/mechanical objects, label critical shapes with semanticRole so validation can count and position them.
- For cylinders, use axis instead of manual rotation.
- Every box/rounded-panel/wedge/trapezoid-prism must include length, width, and height/thickness explicitly. Every cylinder/hollow-cylinder/cone/frustum/capsule/half-cylinder must include radius or radiusTop/radiusBottom and height explicitly. Torus needs majorRadius and tubeRadius. Hemisphere needs radius.
- Every extrude must include a concrete profile array with at least 3 numeric [x,y] points; complex gears may use 80-160 points. Use holes for inner bore/keyway cutouts instead of inventing unsupported subtractive boxes.
- For box housings and bodies, include cornerRadius/cornerSegments when the real object has rounded manufactured edges.
- Tool arguments must be strict JSON only. Use double-quoted property names/strings, numeric literals only, no comments, no formulas, no trailing commas, no markdown, and no text outside the function call.
`

const STAGE2_REVISION_GENERATOR = `You are revising an existing generated primitive geometry artifact.
Call exactly one revise_geometry tool.

Rules:
- Use the target artifact id from the revision context.
- Preserve approved traits: body color, wheels, lights, scale, and existing semantic roles unless the feedback explicitly changes them.
- Use semantic selectors first: semanticRole, sourcePartKind, nameIncludes.
- Use replace for a local subassembly, resize/transform/align for proportion or attachment fixes, materialFrom to inherit existing material, and add/remove for details.
- For overall size requests such as "make it bigger" or "diameter 1m", use resize with concrete dimensions when possible, or transform with selector:{} and uniform scale for all shapes. For exact diameter, compute the scale from the current radius/diameter in the revision summary.
- Do not hard-code red/body colors for pillars or frames; use materialFrom from semanticRole:"vehicle_body".
- For car cabin/roof/window complaints, prefer replacing the current cabin/roof/window area with an integrated glasshouse plus A/B/C pillars/roof frame when that matches the feedback.
- Keep the operation count small and robust.
- Tool arguments must be strict JSON only. Use double-quoted property names/strings, numeric literals only, no comments, no formulas, no trailing commas, no markdown, and no text outside the function call.
`


interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: ChatImageAttachment
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
  sourceTool: 'image-to-3d' | 'text-to-cad'
  provider: string
  asset: AssetInput
  userPrompt: string
  createdAt: string
  placedAt?: string
  savedAt?: string
  cad?: {
    sourceCadUrl?: string
    stepUrl?: string
    logUrl?: string
    metadataUrl?: string
  }
  warnings?: string[]
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

type AiGenerationMode = 'primitive' | 'articraft' | 'image-to-3d' | 'text-to-cad'

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
    id: 'text-to-cad',
    label: '\u6587\u751f CAD',
    tech: 'CAD',
    description: '\u5728\u51e0\u4f55\u642d\u5efa\u4e0b\u751f\u6210\u5de5\u7a0b CAD \u6a21\u578b\uff0c\u8f93\u51fa GLB/STEP\uff0c\u9002\u5408\u652f\u67b6\u3001\u6cd5\u5170\u3001\u58f3\u4f53\u548c\u673a\u68b0\u96f6\u4ef6\u3002',
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

function chatImageAttachmentToFile(image: ChatImageAttachment) {
  const commaIndex = image.dataUrl.indexOf(',')
  if (commaIndex < 0) throw new Error('Invalid image attachment data URL')

  const header = image.dataUrl.slice(0, commaIndex)
  const base64 = image.dataUrl.slice(commaIndex + 1)
  const mime = header.match(/^data:([^;]+)/)?.[1] ?? image.type ?? 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new File([bytes], image.name || 'image.png', { type: mime })
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

function parseTextToCadLinks(value: unknown): GeneratedModelArtifact['cad'] | undefined {
  if (!isRecord(value)) return undefined
  const cad: NonNullable<GeneratedModelArtifact['cad']> = {}
  for (const key of ['sourceCadUrl', 'stepUrl', 'logUrl', 'metadataUrl'] as const) {
    if (typeof value[key] === 'string') cad[key] = value[key]
  }
  return Object.keys(cad).length > 0 ? cad : undefined
}

function parseWarnings(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const warnings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return warnings.length > 0 ? warnings : undefined
}

function isAbortError(error: unknown) {
  return isRecord(error) && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function buildMultimodalContent(text: string, image?: ChatImageAttachment): string | ApiContentPart[] {
  const normalizedText =
    text.trim() || '请根据这张图片生成一个可编辑的 3D 几何对象，并尽量保留主要形状、比例和材质。'
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
  if (artifact.supersededBy) return `已被 ${artifact.supersededBy.slice(-6)} 替换`
  if (artifact.replacedAt) return '已替换旧版'
  if (artifact.placedAt && artifact.savedAt) return '已放置 · 已存入素材'
  if (artifact.savedAt) return '已存入素材'
  if (artifact.placedAt) return '已放置'
  return '草稿'
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
        静态预览
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
  const toolLabel = artifact.sourceTool === 'text-to-cad' ? 'Text to CAD' : 'Image to 3D'
  const cadLinks = artifact.cad

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
          {cadLinks ? (
            <div className="flex flex-wrap gap-1">
              {cadLinks.stepUrl ? (
                <a className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-[#a684ff]/50 hover:text-[#c8b6ff]" href={cadLinks.stepUrl} target="_blank" rel="noreferrer">
                  STEP
                </a>
              ) : null}
              {cadLinks.sourceCadUrl ? (
                <a className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-[#a684ff]/50 hover:text-[#c8b6ff]" href={cadLinks.sourceCadUrl} target="_blank" rel="noreferrer">
                  CAD source
                </a>
              ) : null}
              {cadLinks.logUrl ? (
                <a className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-[#a684ff]/50 hover:text-[#c8b6ff]" href={cadLinks.logUrl} target="_blank" rel="noreferrer">
                  Log
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      }
      hint={
        artifact.sourceTool === 'text-to-cad'
          ? '\u6587\u751f CAD \u4f1a\u540c\u65f6\u8fd4\u56de GLB \u9884\u89c8\u548c CAD/STEP \u9644\u4ef6\uff1b\u590d\u6742\u7269\u4f53\u4f18\u5148\u7528\u8fd9\u6761\u94fe\u8def\u3002'
          : '\u56fe\u751f\u5efa\u6a21\u7ed3\u679c\u590d\u7528\u51e0\u4f55\u642d\u5efa\u7684\u751f\u6210\u5361\u7247\u6d41\u7a0b\uff1a\u5148\u5728\u5bf9\u8bdd\u91cc\u9884\u89c8\uff0c\u518d\u9009\u62e9\u653e\u5230\u753b\u5e03\u6216\u5b58\u5230\u8d44\u6599\u5e93\u3002'
      }
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
  messages: ChatMessage[]
  input: string
  generationMode: AiGenerationMode
  inputExpanded: boolean
  imageAttachment?: ChatImageAttachment
}

const aiChatPanelState: AiChatPanelStateSnapshot = {
  messages: [],
  input: '',
  generationMode: 'primitive',
  inputExpanded: false,
}

export function AiChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(aiChatPanelState.messages)
  const [input, setInput] = useState(aiChatPanelState.input)
  const [loading, setLoading] = useState(false)
  const [generationMode, setGenerationMode] = useState<AiGenerationMode>(
    aiChatPanelState.generationMode,
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
  const latestGeometryArtifactRef = useRef<GeneratedGeometryArtifact | null>(
    latestGeneratedGeometryArtifact(aiChatPanelState.messages),
  )

  const baseUrl = process.env.NEXT_PUBLIC_AI_BASE_URL ?? ''
  const apiKey = process.env.NEXT_PUBLIC_AI_API_KEY ?? ''
  const aiProxyUrl = process.env.NEXT_PUBLIC_AI_PROXY_URL ?? '/api/ai-chat/completions'
  const model = process.env.NEXT_PUBLIC_AI_MODEL ?? 'gpt-4o'
  const articraftViewerUrl = process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765'

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    aiChatPanelState.messages = messages
    latestGeometryArtifactRef.current =
      latestGeneratedGeometryArtifact(messages) ?? latestGeometryArtifactRef.current
  }, [messages])

  useEffect(() => {
    aiChatPanelState.input = input
  }, [input])

  useEffect(() => {
    aiChatPanelState.generationMode = generationMode
    if (generationMode === 'primitive') setImageAttachment(undefined)
  }, [generationMode])

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

  const markGenerationStopped = useCallback((content = '已停止生成。') => {
    setMessages((prev) => {
      const updated = [...prev]
      const lastIdx = updated.length - 1
      const last = updated[lastIdx]
      if (
        last?.role === 'assistant' &&
        !last.geometryArtifact &&
        !last.imageTo3dResult &&
        !last.modelArtifact &&
        !last.articraftResult
      ) {
        updated[lastIdx] = { ...last, content }
        return updated
      }
      return [...updated, { role: 'assistant', content }]
    })
  }, [])

  const handleStopGeneration = useCallback(() => {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    setLoading(false)
    markGenerationStopped()
  }, [markGenerationStopped])

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
    const result = placeGeneratedGeometryArtifact(artifact)
    if (result.nodeIds.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '无法放置这个几何草稿：没有生成有效节点。' },
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
        { role: 'assistant', content: '无法替换画布中的旧版本：没有生成有效节点。' },
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
          content: `存入素材失败：${error instanceof Error ? error.message : String(error)}`,
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
        { role: 'assistant', content: '图片格式不支持。请上传 PNG、JPG 或 WebP。' },
      ])
      return
    }
    if (file.size > AI_IMAGE_MAX_BYTES) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '图片太大。请上传 8MB 以内的图片。' },
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
          `AI 请求没有发出去（${detail}）。请求约 ${sizeKb}KB，请检查 AI Base URL/CORS/网络；如果是二次修订，系统会使用压缩上下文和精简工具 schema 重试。`,
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
  }, [])

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

  const handleSaveArticraftAsset = useCallback(async (result: ArticraftResult) => {
    try {
      const res = await fetch('/api/articraft/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: result.recordId,
          recordPath: result.recordPath,
          prompt: result.prompt,
          joints: result.joints,
          name: result.name,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }

      const assetId = isRecord(data) && isRecord(data.asset) && typeof data.asset.id === 'string'
        ? data.asset.id
        : undefined
      setMessages((prev) =>
        prev.map((message) =>
          message.articraftResult?.recordId === result.recordId
            ? { ...message, articraftResult: { ...message.articraftResult, assetId } }
            : message,
        ),
      )
      window.dispatchEvent(new Event('articraft:assets-updated'))
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: assetId ? `已保存到素材库：${assetId}` : '已保存到素材库。',
        },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, { role: 'assistant', content: `保存到素材库失败：${message}` }])
    }
  }, [])

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
          content: '没有找到匹配的姿态参数。请在 Articraft Viewer 调整关节后复制 URL，再点击一次。',
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
        { role: 'assistant', content: '没有已导入的 Articraft 关节匹配该姿态。请先导入模型。' },
      ])
      return
    }

    useScene.getState().updateNodes(updates)
    useViewer.getState().setSelection({ selectedIds: [updates[0]!.id] })
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: `已将姿态应用到 ${updates.length} 个 Articraft 关节节点。` },
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
      const form = new FormData()
      form.set('image', chatImageAttachmentToFile(image))
      form.set('prompt', prompt)
      form.set('name', assetName)
      form.set('category', 'equipment')
      form.set('save', 'false')

      const res = await fetch('/api/image-to-3d/generate', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const asset = isRecord(data) ? data.asset : undefined
      if (!isImageTo3DAsset(asset)) {
        throw new Error('\u56fe\u751f\u5efa\u6a21\u5b8c\u6210\uff0c\u4f46\u63a5\u53e3\u6ca1\u6709\u8fd4\u56de\u6709\u6548\u7684\u7269\u54c1\u8d44\u4ea7\u3002')
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
        const lastIdx = updated.length - 1
        const result: ChatMessage = {
          role: 'assistant',
          content: `\u56fe\u751f\u5efa\u6a21\u5b8c\u6210\uff1a${asset.name ?? asset.id}`,
          image,
          modelArtifact: artifact,
        }
        if (
          lastIdx >= 0 &&
          updated[lastIdx]?.role === 'assistant' &&
          !updated[lastIdx]?.imageTo3dResult &&
          !updated[lastIdx]?.modelArtifact
        ) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
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
        if (lastIdx >= 0 && updated[lastIdx]?.role === 'assistant' && !updated[lastIdx]?.imageTo3dResult) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        setLoading(false)
      }
    }
  }, [markGenerationStopped])

  const sendTextToCadMessage = useCallback(async (text: string) => {
    const prompt = text.trim()
    if (!prompt) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '\u8bf7\u5148\u63cf\u8ff0\u8981\u751f\u6210\u7684 CAD \u5de5\u7a0b\u6a21\u578b\u3002' },
      ])
      return
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)

    const assetName = prompt.slice(0, 48) || 'Text to CAD asset'
    const userMsg: ChatMessage = { role: 'user', content: prompt }
    const progressMsg: ChatMessage = {
      role: 'assistant',
      content: '\u6b63\u5728\u751f\u6210 CAD \u6a21\u578b\uff0c\u5b8c\u6210\u540e\u4f1a\u8fd4\u56de GLB \u9884\u89c8\u548c STEP/CAD \u6587\u4ef6\u3002',
    }
    setMessages((prev) => [...prev, userMsg, progressMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/text-to-cad/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          name: assetName,
          category: 'equipment',
          save: true,
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const asset = isRecord(data) ? data.asset : undefined
      if (!isImageTo3DAsset(asset)) {
        throw new Error('\u6587\u751f CAD \u5b8c\u6210\uff0c\u4f46\u63a5\u53e3\u6ca1\u6709\u8fd4\u56de\u6709\u6548\u7684\u7269\u54c1\u8d44\u4ea7\u3002')
      }

      const savedAt = isRecord(data) && data.saved === true ? new Date().toISOString() : undefined
      const artifact: GeneratedModelArtifact = {
        id: asset.id,
        title: asset.name ?? asset.id,
        sourceTool: 'text-to-cad',
        provider: 'text-to-cad',
        asset,
        userPrompt: prompt,
        createdAt: new Date().toISOString(),
        savedAt,
        cad: isRecord(data) ? parseTextToCadLinks(data.cad) : undefined,
        warnings: isRecord(data) ? parseWarnings(data.warnings) : undefined,
      }

      if (savedAt) window.dispatchEvent(new Event('generated-assets:updated'))

      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        const warningSuffix = artifact.warnings?.length ? `\n\nWarnings:\n- ${artifact.warnings.join('\n- ')}` : ''
        const result: ChatMessage = {
          role: 'assistant',
          content: `\u6587\u751f CAD \u751f\u6210\u5b8c\u6210\uff1a${asset.name ?? asset.id}${warningSuffix}`,
          modelArtifact: artifact,
        }
        if (
          lastIdx >= 0 &&
          updated[lastIdx]?.role === 'assistant' &&
          !updated[lastIdx]?.imageTo3dResult &&
          !updated[lastIdx]?.modelArtifact
        ) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped('\u5df2\u505c\u6b62\u6587\u751f CAD \u751f\u6210\u3002')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setMessages((prev) => {
        const updated = [...prev]
        const lastIdx = updated.length - 1
        const result: ChatMessage = { role: 'assistant', content: `\u6587\u751f CAD \u751f\u6210\u5931\u8d25\uff1a${message}` }
        if (lastIdx >= 0 && updated[lastIdx]?.role === 'assistant' && !updated[lastIdx]?.modelArtifact) {
          updated[lastIdx] = result
          return updated
        }
        return [...updated, result]
      })
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        setLoading(false)
      }
    }
  }, [markGenerationStopped])

  const sendArticraftMessage = useCallback(async (text: string, image?: ChatImageAttachment) => {
    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const prompt = text.trim() || '请根据这张参考图生成一个可动 3D 模型。'
    const userMsg: ChatMessage = { role: 'user', content: prompt, image }
    const progressHeader = t('aiChat.articraftGenerating', '正在使用 Articraft 生成...')
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
        body: JSON.stringify({
          prompt,
          mode: 'articulated',
          ...(image ? { image } : {}),
        }),
        signal: controller.signal,
      })
      throwIfAborted(controller.signal)

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
        throwIfAborted(controller.signal)
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

      throwIfAborted(controller.signal)
      if (!resultData) throw new Error('No result data from articraft')

      const resultLinks = (resultData.links as Array<Record<string, unknown>>) ?? []
      const resultJoints = (resultData.joints as Array<Record<string, unknown>>) ?? []
      const result: ArticraftResult = {
        prompt,
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
          content: t('aiChat.articraftReady', 'Articraft 生成完成，可以查看或导入。'),
          articraftResult: result,
        },
      ])
      return
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped('已停止 Articraft 生成。')
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('aiChat.error', { fallback: '错误：{message}', params: { message: errorMsg } }) },
      ])
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        setLoading(false)
      }
    }
  }, [markGenerationStopped])

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
          tc.function.name === 'compose_parts' ||
          tc.function.name === 'compose_object' ||
          tc.function.name === 'compose_robot_arm' ||
          tc.function.name === 'revise_geometry'
        )

        if (geometryToolCalls.length > 1) {
          for (const tc of currentResponse.tool_calls) {
            const result = [
              'Invalid generation plan. Nothing was created.',
              'Call exactly ONE geometry tool for the complete object.',
              'Do not split one object across compose_object + compose_recipe + compose_parts + compose_primitive, because attachTo indexes are local to a single tool call.',
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
            [
              `生成已停止：修复 harness 已连续 ${GEOMETRY_REPAIR_STAGNATION_LIMIT} 轮没有减少校验问题。`,
              '原因：继续自动对话会反复消耗请求，但仍可能创建错误模型；场景保持不变。',
              '已保留压缩修复记忆：可用最近失败点重新发起完整蓝图生成。',
              '下一步方案：请重试一个受支持的完整蓝图。阀门可使用 valve_body + handwheel + inlet/outlet flanges + bonnet/stem/yoke；也可以先生成简化阀门，再一次只调整一个特征。',
            ].join('\n'),
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
                'Do not repeat a missing semantic role; add the required part, switch to compose_recipe when a built-in recipe covers it, or switch to the supported compose_parts blueprint.',
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
    const attachedImage = generationMode === 'primitive' || generationMode === 'text-to-cad' ? undefined : imageAttachment
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

    if (generationMode === 'text-to-cad') {
      await sendTextToCadMessage(text)
      return
    }

    if (generationMode === 'articraft') {
      await sendArticraftMessage(text, attachedImage)
      return
    }


    if (!(aiProxyUrl || (baseUrl && apiKey))) {
      setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: t('aiChat.noConfig', '请在 .env.local 中设置 NEXT_PUBLIC_AI_BASE_URL 和 NEXT_PUBLIC_AI_API_KEY。'),
      },
    ])
      return
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const userContent =
      text || '请根据这张图片生成一个可编辑的 3D 几何对象，并尽量保留主要形状、比例和材质。'
    const latestGeometryArtifact =
      latestGeneratedGeometryArtifact(messages) ?? latestGeometryArtifactRef.current
    if (latestGeometryArtifact) latestGeometryArtifactRef.current = latestGeometryArtifact
    const modelUserContent = buildGeometryHarnessContext({
      messages,
      latestArtifact: latestGeometryArtifact,
      userRequest: userContent,
    })
    setMessages((prev) => [...prev, { role: 'user', content: userContent, image: attachedImage }])
    setLoading(true)

    try {
      setMessages((prev) => [...prev, { role: 'assistant', content: '**Analysis:**\n_Thinking..._' }])

      const analysisResponse = await callApi(
        [
          { role: 'system', content: STAGE1_ANALYST },
          { role: 'user', content: buildMultimodalContent(modelUserContent, attachedImage) },
        ],
        [],
        controller.signal,
      )
      throwIfAborted(controller.signal)
      const analysis = analysisResponse.content ?? ''

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: `**Analysis:**\n${analysis}` }
        return updated
      })

      setMessages((prev) => [...prev, { role: 'assistant', content: '**Generate:**\n_Generating..._' }])

      const genMessages: ApiMessage[] = [
        { role: 'system', content: STAGE2_GENERATOR },
        {
          role: 'user',
          content: `User request: ${modelUserContent}\n\nAnalysis:\n${analysis}\n\nNow call the best available tool based on this analysis. If a previous generated geometry summary is present, prefer revise_geometry for local customer feedback and preserve existing approved traits. Otherwise prefer compose_object for supported whole-object categories, compose_recipe for built-in vehicle/valve/3-axis robot recipes, compose_parts for reusable mechanical/appliance part blueprints, compose_robot_arm for other robot arms, otherwise compose_primitive. Output exactly one tool call. Include geometryBrief for compose_parts or compose_primitive so validation can check the intended geometry; compose_recipe supplies its own brief.`,
        },
      ]

      const generationTools: ComposeTool[] = latestGeometryArtifact
        ? [REVISE_GEOMETRY_TOOL, COMPOSE_OBJECT_TOOL, COMPOSE_RECIPE_TOOL, COMPOSE_PARTS_TOOL, COMPOSE_ROBOT_ARM_TOOL, COMPOSE_PRIMITIVE_TOOL]
        : [COMPOSE_OBJECT_TOOL, COMPOSE_RECIPE_TOOL, COMPOSE_PARTS_TOOL, COMPOSE_ROBOT_ARM_TOOL, COMPOSE_PRIMITIVE_TOOL]
      const genResponse = await callApi(genMessages, generationTools, controller.signal)
      throwIfAborted(controller.signal)
      const genResult = await processToolCalls(genResponse, genMessages, generationTools, 'Generate', {
        prompt: userContent,
        revisionTarget: latestGeometryArtifact,
      }, controller.signal)

      // If no tool calls were made, show the text response
      if (genResult.results.length === 0) {
        throwIfAborted(controller.signal)
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `**Generate:**\n${genResult.lastContent || '(no output)'}` }
          return updated
        })
      }

    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped()
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('aiChat.error', { fallback: '错误：{message}', params: { message: errorMsg } }) },
      ])
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null
        setLoading(false)
      }
    }
  }, [input, imageAttachment, messages, loading, generationMode, baseUrl, apiKey, sendImageTo3DMessage, sendTextToCadMessage, sendArticraftMessage, callApi, processToolCalls, markGenerationStopped])

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
  const primitiveHasConfig = Boolean(aiProxyUrl || (baseUrl && apiKey))
  const showImageUpload = generationMode === 'image-to-3d' || generationMode === 'articraft'
  const canSend =
    !loading &&
    (generationMode === 'image-to-3d'
      ? true
      : generationMode === 'primitive' || generationMode === 'text-to-cad'
        ? Boolean(input.trim())
        : Boolean(input.trim() || imageAttachment))
  const inputPlaceholder =
    generationMode === 'primitive'
      ? '\u63cf\u8ff0\u8981\u642d\u5efa\u7684\u51e0\u4f55\u4f53...'
      : generationMode === 'image-to-3d'
        ? '\u4e0a\u4f20\u56fe\u7247\uff0c\u53ef\u8865\u5145\u5efa\u6a21\u63cf\u8ff0...'
        : generationMode === 'text-to-cad'
          ? '\u63cf\u8ff0 CAD \u5de5\u7a0b\u6a21\u578b\uff0c\u4f8b\u5982\u5e26\u5b89\u88c5\u5b54\u7684\u7535\u673a\u652f\u67b6...'
          : '\u63cf\u8ff0\u5173\u8282\u8d44\u4ea7\uff0c\u6216\u4e0a\u4f20\u53c2\u8003\u56fe...'
  const latestVisibleGeometryArtifactId = [...messages]
    .reverse()
    .find((message) => message.geometryArtifact && !message.geometryArtifact.supersededBy)
    ?.geometryArtifact?.id



  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-border/50 border-b px-3 py-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" icon="mdi:robot-outline" />
        <span className="text-xs font-medium">{t('aiChat.title', 'AI 助手')}</span>
        {!primitiveHasConfig && generationMode === 'primitive' && (
          <span className="ml-auto text-[10px] text-orange-400">
            {t('aiChat.notConfigured', '未配置')}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-2 [scrollbar-color:#3a3a3d_#050505] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a3d] [&::-webkit-scrollbar-track]:bg-[#050505]"
      >
        {messages.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <Icon className="mx-auto mb-2 size-8 opacity-30" icon="mdi:cube-scan" />
            <p>{t('aiChat.placeholder', '描述你想创建的对象。')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {['风扇', '写字桌', '储物架', '排风扇'].map((hint) => (
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
                  {t('aiChat.calling', '正在调用工具...')} {msg.toolCalls.map((tc) => tc.name).join(', ')}
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
                      记录：{msg.articraftResult.recordId || '-'}
                    </div>
                    {msg.articraftResult.recordPath ? (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={msg.articraftResult.recordPath}>
                        路径：{msg.articraftResult.recordPath}
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
                    {msg.articraftResult.status === 'imported' ? '已导入' : '就绪'}
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
                      {msg.articraftResult.status === 'imported' ? '已导入' : '就绪'}
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
                    导入场景
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-amber-400/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => handleSaveArticraftAsset(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:archive-plus-outline" />
                    保存到素材库
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-cyan-400/50 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!msg.articraftResult.recordId}
                    onClick={() => handleApplyArticraftPose(msg.articraftResult!)}
                    type="button"
                  >
                    <Icon className="size-3.5" icon="mdi:axis-arrow" />
                    应用姿态
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
            {t('aiChat.thinking', '正在思考...')}
          </div>
        )}
      </div>

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
                      if (mode.id === 'primitive' || mode.id === 'text-to-cad') setImageAttachment(undefined)
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
              title="上传图片"
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
            title={loading ? '停止生成' : '发送'}
            type="button"
          >
            <Icon className="size-4" icon={loading ? 'mdi:stop' : 'mdi:send'} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AiChatPanel
