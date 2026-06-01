'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AssetInput,
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
  buildRevisionContext,
  clampD,
  clampR,
  placeGeneratedGeometryArtifact,
  replaceGeneratedGeometryArtifactOnCanvas,
  saveGeneratedGeometryArtifactToLocalLibrary,
  shouldUseRevisionContext,
  toAssemblyLocalPosition,
  type GeneratedGeometryArtifact,
  type GeneratedGeometryShapeSpec as ShapeSpec,
} from '../../../../../lib/ai-generated-geometry'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOUSE } from 'three'
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
            'Reusable parts to procedurally expand into primitives. For a standing fan use circular_base + vertical_pole + support_bracket + motor_housing + radial_blades + protective_grill + optional control_knob. For desks with visible drawers use desk_top + leg_set + drawer_stack. For electrical/control cabinets use electrical_cabinet + cable_tray + nameplate/warning details. For pipe systems use pipe_run + pipe_elbow + flange_ring/valve_body. For a bicycle use bicycle_wheels exactly once (it is a front+rear two-wheel wheelset) + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop. For a car use vehicle_body + vehicle_wheels + vehicle_windows + headlights + bumper. For a water pump / centrifugal blower use skid_base + ribbed_motor_body or rounded_machine_body + volute_casing + inlet_port + outlet_port + flange_ring + optional impeller_blades + control_box. For conveyors use conveyor_frame + roller_array + belt_surface. For tanks use cylindrical_tank plus pipe/flange details. For valves use valve_body + handwheel + flanges. For factory scenes use gearbox_body, filter_vessel, heat_exchanger, agitator_tank, pipe_rack, platform_ladder, electrical_cabinet, cable_tray, pipe_run, and pipe_elbow.',
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
              length: { type: 'number', description: 'Length alias used by some parts.' },
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

type ComposeTool = typeof COMPOSE_OBJECT_TOOL | typeof COMPOSE_PARTS_TOOL | typeof COMPOSE_ROBOT_ARM_TOOL | typeof COMPOSE_PRIMITIVE_TOOL

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
- compose_object(...): Create stable editable low-poly whole objects from simple category templates. Prefer for chair/stool, sofa, outdoor AC unit, keyboard, monitor/display, table/desk, shelf/rack, cabinet. Do not use it as the default for cars/vehicles; use compose_parts vehicle parts.
- compose_parts(...): Create one editable object from reusable procedural parts. Use one part entry per semantic module unless that part exposes an explicit count field; do not duplicate wheelset-style parts to express visual count.
- compose_primitive(shapes): Create custom box, rounded-panel, cylinder, hollow-cylinder, cone, frustum, hemisphere, torus, wedge, trapezoid-prism, capsule, half-cylinder, sphere, lathe, extrude, or sweep shapes for unsupported categories or user-specified individual parts.
- compose_robot_arm(...): Create robot arm drafts. Prefer for robot/cobot/FANUC/manipulator requests.

===== COORDINATE SYSTEM =====
+X = left/right width, +Y = up, +Z = depth/front-back. y=0 is the ground plane.
Position [x,y,z] is always the geometric center of the shape.
Rotation [rx,ry,rz] is Euler angles in radians.

===== REALITY GUARD =====
Before generating, maintain an internal geometry brief: category, units, coordinate convention, expected dimensions, required semantic roles, validation targets, and assumptions. In the final tool call include geometryBrief for compose_parts or compose_primitive. For hand-built compose_primitive objects, add semanticRole to validation-critical shapes so the tool can reject unrealistic geometry instead of saving it.

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
Use compose_parts when the object is best described as reusable procedural parts rather than raw primitives. For standing fan / electric fan / floor fan requests, call compose_parts once with these parts: circular_base, vertical_pole, support_bracket, motor_housing, radial_blades(count:3), protective_grill(ringCount:4-5, spokeCount:18-24, depth:0.10-0.14, domeDepth:0.07-0.12), and optional control_knob. This is not a hard-coded fan template; it is a reusable mechanical part blueprint.
For factory equipment such as water pumps, centrifugal blowers, industrial fans, conveyors, tanks, valves, and motorized pipe equipment, call compose_parts once with a mechanical blueprint. For pumps/blowers use skid_base, ribbed_motor_body or rounded_machine_body, volute_casing, inlet_port, outlet_port, flange_ring, optional impeller_blades, control_box, and vent_slats. Do not approximate pumps/blowers as plain boxes; include a scroll/volute casing plus pipe ports and flanges. flange_ring already includes bolts by default, so add separate bolt_pattern only for extra casing bolts.
Use part-level direction controls when realism depends on orientation: side for pipe/flange open ends, outletAngle for volute discharge direction, rotation for rotated motors/conveyors/tanks, and includeBolts:false when a plain flange or separate bolt_pattern is needed.
Use connectTo + connectPoint + childPoint when one part should snap to another instead of manually guessing offsets. Example: give a pipe_port id:"outlet", then create flange_ring with connectTo:"outlet", connectPoint:"open", childPoint:"back" so the flange attaches to the pipe end. For volute_casing use connectPoint:"inlet" or "outlet"; for motors use "shaft"; for valves use "inlet"/"outlet". Legacy anchor/childAnchor still works for simple top/front/back/left/right snapping.
For office desks that need visible structure beyond the table template, use desk_top + leg_set and add drawer_stack for drawers. Keep explicit user length/width/height in meters: desk_top.length is X, desk_top.width is Z depth, leg_set should use the same footprint, and leg height should bring the top to the requested height.
For electrical/control cabinets, use electrical_cabinet with cable_tray plus nameplate/warning_label/vent details when realism is requested. For process piping or pipe corridors, use pipe_run for straight spans, pipe_elbow for 90-degree bends, and flange_ring/valve_body for connection details.
For bicycles, use bicycle_wheels exactly once (front+rear two-wheel wheelset) + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop. Do not output bicycle_wheels twice, even if the analysis says the bicycle has two wheels. The chain_loop part creates an elongated chain run, front chainring, and rear sprocket; do not replace it with a circular torus. In geometryBrief.requiredRoles use bicycle_tire + bicycle_frame + bicycle_fork + handlebar + saddle + chain_loop, not bicycle_wheels. For cars/vehicles/汽车/小轿车, call compose_parts once with reusable parts vehicle_body + vehicle_wheels + vehicle_windows + headlights + bumper; set primaryColor/body part color from the user's requested color (e.g. 红色 -> #cc0000). Put the requested overall vehicle dimensions on vehicle_body; then keep vehicle_wheels, vehicle_windows, headlights, and bumper mostly semantic (usually no manual position or rotation) so compose_parts can align axles, glass, lights, and bumpers from the body. Use kind/name, not partType/partName, in new calls. Do not create a special per-model template for sedan/SUV/etc.; tune proportions with part length/width/height and optional positions only when truly needed.
For follow-up requests like "make the car smoother / 线条再丝滑点", revise the previous compose_parts vehicle call instead of switching to hand-built compose_primitive. Increase vehicle_body cornerRadius/cornerSegments, set detail:"high" and enhanceVisualDetails:true, and keep vehicle_wheels semantic so wheel thickness/axles remain valid.
For other factory equipment, use conveyor_frame + roller_array + belt_surface for belt conveyors, cylindrical_tank for tanks/vessels, ribbed_motor_body for electric motors, gearbox_body for reducers, filter_vessel for filters, heat_exchanger for shell-and-tube exchangers, agitator_tank for mixing tanks, pipe_rack for pipe corridors, platform_ladder for access platforms, and valve_body + handwheel for valves. For valves, requiredRoles may include flange_inlet, flange_outlet, bonnet, stem, gate_wedge, bonnet_bolts, and yoke; compose_parts auto-completes inlet/outlet flanges and valve_body creates bonnet/stem/gate/yoke/bonnet bolts, so do not hand-build a partial raw primitive valve unless the user asks for exact custom geometry. Add nameplate, warning_label, seam_ring, vent_slats, flange bolts, and pipe ports for visual detail. Keep autoComplete omitted unless you explicitly need a minimal standalone subpart; omitted autoComplete lets compose_parts run family self-check and add missing required structure for recognized fan/pump/conveyor/bicycle/car/valve/desk/electrical/pipe blueprints. It does not add every optional visual detail automatically, so include requested details explicitly.
When the user asks for "realistic", "detailed", "\u771f\u5b9e", "\u7ec6\u8282", or similar, set enhanceVisualDetails:true on compose_parts. This may add non-essential visual details such as pump impellers, nameplates, warning labels, fan control knobs, conveyor drive motors, vehicle seam/nameplate details, desk drawers, pipe elbows/flanges, and electrical cabinet trays/labels.
Use protective_grill instead of a single torus whenever the user asks for a cage/guard/protective grille: it creates a shallow half-round cage with curved concentric rings, radial spokes, side ribs, and rear outer ring. The grill should not be a flat plane; set depth and optional domeDepth for a bowl/half-dome silhouette.
Use radial_blades instead of hand-made rectangles whenever the user asks for fan blades: it creates swept extruded leaf/airfoil blades with narrow roots, wider curved tips, root collars, pitch, and a hub. For realistic fan blades, set count:3, bladeWidth about 0.06-0.09, bladePitch about 0.22-0.30, and optional bladeSweep about 0.02-0.04.
Use volute_casing for centrifugal pump/blower housings; pair it with inlet_port/outlet_port and flange_ring so the object reads as factory equipment rather than furniture.

===== GEOMETRY RULES =====
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
If the request is a mechanical/appliance object made from reusable parts, choose compose_parts and list the part blueprint. List semantic part entries, not raw visual counts; for example bicycle_wheels is one front+rear wheelset entry, not two entries.
If the request includes extra structural features beyond a template category, choose compose_primitive instead and decompose the whole object yourself.
If not, decompose into reusable parts or primitives. For each part specify:
1. Name
2. Primitive kind (box/rounded-panel/cylinder/hollow-cylinder/cone/frustum/hemisphere/torus/wedge/trapezoid-prism/capsule/half-cylinder/sphere/lathe/extrude/sweep)
3. Key dimensions in meters; for box or panel parts, whether they need cornerRadius/bevel and why
4. World-space position [x, y, z]
5. Why this primitive matches the surface
`

const STAGE2_GENERATOR = `${BASE_RULES}

===== STAGE 2: GENERATE =====
Based on the analysis, call compose_object, compose_parts, compose_robot_arm, or compose_primitive to create the geometry.

- For common simple whole objects (chair, sofa, outdoor AC unit, keyboard, monitor, table/desk, shelf, cabinet), call compose_object once only when the template fully covers the request.
- For cars/vehicles and other reusable mechanical/appliance/factory/vehicle part blueprints such as standing fans, bicycles, water pumps, blowers, industrial fans, motors, conveyors, tanks, valves, gearboxes, filters, heat exchangers, agitator tanks, pipe racks, platforms, office desks with drawers, electrical cabinets, cable trays, pipe runs/elbows, fan grilles, radial blades, volute casings, pipe ports, flanges, bolts, skid bases, vents, poles, bases, and brackets, call compose_parts once.
- If the user requested extra structural features or exact subpart counts not expressible by compose_parts, do not mix tools; call compose_primitive once with the complete object.
- For robot arms, call compose_robot_arm once.
- Otherwise call compose_primitive once with all shapes. Parent before child.
- Include geometryBrief as a top-level argument in compose_parts or compose_primitive, not inside metadata. For compose_primitive vehicles/bicycles/mechanical objects, label critical shapes with semanticRole so validation can count and position them.
- For cylinders, use axis instead of manual rotation.
- Every box/rounded-panel/wedge/trapezoid-prism must include length, width, and height/thickness explicitly. Every cylinder/hollow-cylinder/cone/frustum/capsule/half-cylinder must include radius or radiusTop/radiusBottom and height explicitly. Torus needs majorRadius and tubeRadius. Hemisphere needs radius.
- For box housings and bodies, include cornerRadius/cornerSegments when the real object has rounded manufactured edges.
`


interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: ChatImageAttachment
  articraftResult?: ArticraftResult
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
  sourceTool: 'image-to-3d'
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

type AiGenerationMode = 'primitive' | 'image-to-3d' | 'articraft'

const AI_GENERATION_MODES: Array<{
  id: AiGenerationMode
  label: string
  tech: string
  description: string
}> = [
  {
    id: 'primitive',
    label: '几何搭建',
    tech: 'Primitive',
    description: 'LLM 调用 Pascal primitive 工具，生成可编辑几何体。',
  },
  {
    id: 'image-to-3d',
    label: '图片成模',
    tech: 'SAM 3D',
    description: '上传图片，经 fal SAM 3D 生成 GLB，并保存到素材库。',
  },
  {
    id: 'articraft',
    label: '关节资产',
    tech: 'Articraft',
    description: '生成带 links/joints 的可动资产，可查看、导入和调姿态。',
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

function isAssetInput(value: unknown): value is AssetInput {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.src === 'string' &&
    typeof value.thumbnail === 'string'
  )
}

function formatArticraftProgressMessage(header: string, lines: string[]) {
  const visibleLines = lines.map((line) => line.trim()).filter(Boolean).slice(-ARTICRAFT_PROGRESS_LINE_LIMIT)
  if (visibleLines.length === 0) return header
  return `${header}\n\n${visibleLines.map((line) => `- ${line}`).join('\n')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getShapeColor(shape: ShapeSpec) {
  if (shape.material?.properties?.color) return shape.material.properties.color
  if (shape.material?.preset === 'wood' || shape.materialPreset === 'wood') return '#a36b3f'
  if (shape.material?.preset === 'metal' || shape.materialPreset === 'metal') return '#9ca3af'
  if (shape.material?.preset === 'glass' || shape.materialPreset === 'glass') return '#8bd3ff'
  return '#a684ff'
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
    case 'lathe':
    case 'extrude':
    case 'sweep':
      return [1, 1, 1]
    default:
      return [1, 1, 1]
  }
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
          mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
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
  if (artifact.placedAt && artifact.savedAt) return 'Placed · Saved'
  if (artifact.savedAt) return 'Saved'
  if (artifact.placedAt) return 'Placed'
  return 'Draft'
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
          mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
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

  return (
    <GeneratedArtifactCardShell
      actions={
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#a684ff]/50 bg-[#a684ff]/15 px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-[#a684ff]/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
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
      hint="Image-to-3D GLB results use the same generated card flow as geometry: preview first, then place on canvas or save to the library."
      meta={`${artifact.provider} · ${artifact.asset.category ?? 'equipment'}`}
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

function latestGeneratedGeometryArtifact(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.geometryArtifact && !message.geometryArtifact.supersededBy)
    ?.geometryArtifact ?? null
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
  const model = process.env.NEXT_PUBLIC_AI_MODEL ?? 'gpt-4o'
  const articraftViewerUrl = process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765'

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    aiChatPanelState.messages = messages
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
        { role: 'assistant', content: '无法放置模型：当前场景没有可用楼层。' },
      ])
      return
    }

    const node = ItemNode.parse({
      name: artifact.asset.name,
      asset: artifact.asset,
      position: [0, 0, 0],
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
          content: `Save to library failed: ${error instanceof Error ? error.message : String(error)}`,
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
    context: { prompt: string; revisionOf?: string; revisionVersion?: number; replaceNodeIds?: string[] }
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
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
        body: JSON.stringify(body),
      })
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

  const sendImageTo3DMessage = useCallback(async (text: string, image?: ChatImageAttachment) => {
    if (!image) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '请先上传一张 PNG、JPG 或 WebP 图片，图片成模需要上传图片后才能对话。' },
      ])
      return
    }

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    const prompt = text.trim() || '根据这张图片生成 3D 模型'
    setInput('')
    setImageAttachment(undefined)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: prompt, image },
      { role: 'assistant', content: '正在根据图片生成模型...' },
    ])
    setLoading(true)

    try {
      const blob = await (await fetch(image.dataUrl, { signal: controller.signal })).blob()
      throwIfAborted(controller.signal)
      const form = new FormData()
      form.set('image', new File([blob], image.name || 'reference.png', { type: image.type }))
      form.set('prompt', prompt)
      form.set('name', prompt)
      form.set('category', 'equipment')
      form.set('save', 'false')

      const res = await fetch('/api/image-to-3d/generate', {
        method: 'POST',
        signal: controller.signal,
        body: form,
      })
      throwIfAborted(controller.signal)
      const data = await res.json().catch(() => ({}))
      throwIfAborted(controller.signal)
      if (!res.ok) {
        throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : res.statusText)
      }
      const asset = isRecord(data) && isAssetInput(data.asset) ? data.asset : null
      if (!asset) throw new Error('生成完成，但返回的素材格式无效。')

      const provider =
        asset.tags?.find((tag) => !['floor', 'generated', 'image-to-3d'].includes(tag)) ??
        'image-to-3d'
      const artifact: GeneratedModelArtifact = {
        id: asset.id,
        title: asset.name,
        sourceTool: 'image-to-3d',
        provider,
        asset,
        userPrompt: prompt,
        createdAt: new Date().toISOString(),
      }

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: '图片成模完成。',
          modelArtifact: artifact,
        }
        return updated
      })
    } catch (err) {
      if (isAbortError(err)) {
        markGenerationStopped('已停止图片成模。')
        return
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `图片成模失败：${errorMsg}`,
        }
        return updated
      })
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
          tc.function.name === 'compose_parts' ||
          tc.function.name === 'compose_object' ||
          tc.function.name === 'compose_robot_arm'
        )

        if (geometryToolCalls.length > 1) {
          for (const tc of currentResponse.tool_calls) {
            const result = [
              'Invalid generation plan. Nothing was created.',
              'Call exactly ONE geometry tool for the complete object.',
              'Do not split one object across compose_object + compose_parts + compose_primitive, because attachTo indexes are local to a single tool call.',
            ].join('\n')
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result })
            allResults.push(result)
          }
        } else {
          for (const tc of currentResponse.tool_calls) {
            throwIfAborted(signal)
            const result = executeToolCall(tc.function.name, JSON.parse(tc.function.arguments), {
              prompt: context.prompt,
              revisionOf: context.revisionTarget?.id,
              revisionVersion: context.revisionTarget?.version,
              replaceNodeIds: context.revisionTarget?.placedNodeIds,
            })
            toolResultApiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result.content })
            allResults.push(result.content)
            if (result.artifact) createdArtifact = result.artifact
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
                'Do not repeat a missing semantic role; add the required part or switch to the supported compose_parts blueprint.',
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

    if (generationMode === 'articraft') {
      await sendArticraftMessage(text, attachedImage)
      return
    }

    if (generationMode === 'image-to-3d') {
      await sendImageTo3DMessage(text, attachedImage)
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

    const controller = new AbortController()
    activeAbortControllerRef.current = controller
    setInput('')
    setImageAttachment(undefined)
    const userContent =
      text || '请根据这张图片生成一个可编辑的 3D 几何对象，并尽量保留主要形状、比例和材质。'
    const revisionTarget = shouldUseRevisionContext(text, latestGeometryArtifactRef.current)
      ? latestGeometryArtifactRef.current
      : null
    const modelUserContent = revisionTarget ? buildRevisionContext(revisionTarget, userContent) : userContent
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
          content: `User request: ${modelUserContent}\n\nAnalysis:\n${analysis}\n\nNow call the best available tool based on this analysis. Prefer compose_object for supported whole-object categories, compose_parts for reusable mechanical/appliance part blueprints, compose_robot_arm for robot arms, otherwise compose_primitive. Output the complete object in one tool call. Include geometryBrief for compose_parts or compose_primitive so validation can check the intended geometry.`,
        },
      ]

      const generationTools: ComposeTool[] = [COMPOSE_OBJECT_TOOL, COMPOSE_PARTS_TOOL, COMPOSE_ROBOT_ARM_TOOL, COMPOSE_PRIMITIVE_TOOL]
      const genResponse = await callApi(genMessages, generationTools, controller.signal)
      throwIfAborted(controller.signal)
      const genResult = await processToolCalls(genResponse, genMessages, generationTools, 'Generate', {
        prompt: userContent,
        revisionTarget,
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
  }, [input, imageAttachment, loading, generationMode, baseUrl, apiKey, sendArticraftMessage, sendImageTo3DMessage, callApi, processToolCalls, markGenerationStopped])

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
  const primitiveHasConfig = Boolean(baseUrl && apiKey)
  const showImageUpload = generationMode !== 'primitive'
  const canSend =
    !loading &&
    (generationMode === 'image-to-3d'
      ? true
      : generationMode === 'primitive'
        ? Boolean(input.trim())
        : Boolean(input.trim() || imageAttachment))
  const inputPlaceholder =
    generationMode === 'primitive'
      ? '描述几何体...'
      : generationMode === 'image-to-3d'
        ? '上传图片，可补充模型名称或描述...'
        : '描述可动资产，或上传参考图...'
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

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
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
