import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

const compartmentBase = {
  id: z.string(),
  height: z.number().positive().max(2.5).optional(),
}

const cooktopFields = {
  cooktopBurnersOn: z.boolean().optional(),
  cooktopActiveBurners: z.array(z.number().int().min(0).max(8)).optional(),
  cooktopKnobProgress: z.array(z.number().min(0).max(1)).optional(),
  cooktopShowGrate: z.boolean().optional(),
}

export const CabinetFrontStyleSchema = z.enum(['slab', 'shaker', 'raised-arch'])

// Discriminated on `type` so invalid field combinations (a drawer with a
// pantry rack style, a fridge with burner state) are unrepresentable. New
// compartment kinds add a variant here rather than widening a shared bag of
// optionals.
const CabinetCompartment = z.discriminatedUnion('type', [
  z.object({
    ...compartmentBase,
    type: z.literal('shelf'),
    shelfCount: z.number().int().min(0).max(8).optional(),
  }),
  z.object({
    ...compartmentBase,
    type: z.literal('drawer'),
    drawerCount: z.number().int().min(1).max(6).optional(),
  }),
  z.object({
    ...compartmentBase,
    type: z.literal('door'),
    doorType: z.enum(['single-left', 'single-right', 'double', 'glass']).optional(),
    shelfCount: z.number().int().min(0).max(8).optional(),
  }),
  z.object({
    ...compartmentBase,
    type: z.literal('sink'),
    sinkLayout: z.enum(['single', 'double', 'double-offset']).optional(),
  }),
  z.object({ ...compartmentBase, type: z.literal('oven') }),
  z.object({ ...compartmentBase, type: z.literal('microwave') }),
  z.object({ ...compartmentBase, type: z.literal('dishwasher') }),
  z.object({
    ...compartmentBase,
    type: z.literal('cooktop-gas'),
    ...cooktopFields,
    cooktopLayout: z
      .enum(['gas-2burner', 'gas-4burner', 'gas-5burner-wok', 'gas-6burner'])
      .optional(),
  }),
  z.object({
    ...compartmentBase,
    type: z.literal('cooktop-induction'),
    ...cooktopFields,
    cooktopLayout: z.enum(['induction-2zone', 'induction-4zone']).optional(),
  }),
  z.object({
    ...compartmentBase,
    type: z.literal('pull-out-pantry'),
    shelfCount: z.number().int().min(0).max(8).optional(),
    pantryRackStyle: z.enum(['wire', 'tray', 'glass']).optional(),
  }),
  z.object({ ...compartmentBase, type: z.literal('fridge-single') }),
  z.object({ ...compartmentBase, type: z.literal('fridge-double') }),
  z.object({ ...compartmentBase, type: z.literal('fridge-top-freezer') }),
  z.object({ ...compartmentBase, type: z.literal('fridge-bottom-freezer') }),
  z.object({ ...compartmentBase, type: z.literal('hood-pyramid') }),
  z.object({ ...compartmentBase, type: z.literal('hood-curved-glass') }),
])

export type CabinetCompartmentSchema = z.infer<typeof CabinetCompartment>

// Box construction / hardware fields shared verbatim by the run and its
// modules. One source of truth so the two schemas can't drift.
const cabinetBoxFields = {
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  // Persisted slab-support host — see ItemNode.supportSlabId for the rules.
  supportSlabId: z.string().optional(),
  width: z.number().min(0.05).max(3).default(0.5),
  depth: z.number().min(0.3).max(1.2).default(0.5),
  carcassHeight: z.number().min(0.4).max(2.4).default(0.72),
  operationState: z.number().min(0).max(1).default(0),
  plinthHeight: z.number().min(0).max(0.3).default(0.1),
  toeKickDepth: z.number().min(0).max(0.2).default(0.075),
  boardThickness: z.number().min(0.01).max(0.08).default(0.018),
  countertopThickness: z.number().min(0).max(0.08).default(0.02),
  countertopOverhang: z.number().min(0).max(0.12).default(0.02),
  // Extra slab reach off the back edge (island seating side) — up to a
  // 45 cm knee-space overhang, unlike the small uniform front/side overhang.
  countertopBackOverhang: z.number().min(0).max(0.45).default(0),
  withFinishedBack: z.boolean().default(false),
  frontThickness: z.number().min(0.01).max(0.05).default(0.018),
  frontGap: z.number().min(0.001).max(0.02).default(0.003),
  frontStyle: CabinetFrontStyleSchema.default('slab'),
  handleStyle: z.enum(['none', 'bar', 'cutout', 'hole', 'knob']).default('bar'),
  handlePosition: z.enum(['auto', 'top', 'center']).default('auto'),
  frontOverlay: z.enum(['full', 'inset']).default('full'),
  withBottomPanel: z.boolean().default(true),
  showPlinth: z.boolean().default(true),
  withCountertop: z.boolean().default(true),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),
  stack: z.array(CabinetCompartment).optional(),
}

export const CabinetNode = BaseNode.extend({
  id: objectId('cabinet'),
  type: nodeType('cabinet'),
  runTier: z.enum(['base', 'wall', 'tall']).default('base'),
  children: z.array(objectId('cabinet-module')).default([]),
  // Raised bar counter along one run edge: a knee wall topped by a slab at
  // bar height. Run-level because it spans modules like the countertop.
  barLedge: z
    .object({
      edge: z.enum(['back', 'left', 'right']).default('back'),
      height: z.number().min(0.9).max(1.3).default(1.06),
      depth: z.number().min(0.15).max(0.5).default(0.35),
    })
    .optional(),
  // Countertop material dropping to the floor on exposed run ends.
  withWaterfall: z.boolean().default(false),
  ...cabinetBoxFields,
}).describe('Parametric modular cabinet run node')

export const CabinetModuleNode = BaseNode.extend({
  id: objectId('cabinet-module'),
  type: nodeType('cabinet-module'),
  children: z.array(z.union([objectId('cabinet-module'), objectId('cabinet')])).default([]),
  cabinetType: z.enum(['base', 'tall']).default('base'),
  // Discriminator for specialty units (corner L-shape, sink base, appliance
  // gap, open shelving). 'standard' modules use the compartment stack as-is;
  // new kinds extend this enum instead of overloading the stack.
  moduleKind: z.enum(['standard', 'corner-filler']).default('standard'),
  // Shared-boundary opening for inside-corner pockets: drops the side panel on
  // that side and lets interior shelves / decks run through to the neighbour.
  openSide: z.enum(['left', 'right']).optional(),
  // Corner-pocket fillers carry a small internal shelf so the dead corner reads
  // as reachable storage instead of an empty boxed void.
  cornerShelf: z.boolean().optional(),
  ...cabinetBoxFields,
}).describe('Parametric module inside a modular cabinet run')

export type CabinetNode = z.infer<typeof CabinetNode>
export type CabinetModuleNode = z.infer<typeof CabinetModuleNode>
