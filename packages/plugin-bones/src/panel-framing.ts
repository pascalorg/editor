/**
 * Pure helpers for the sidebar panel's 'Framing' row — LGS Phase 2, UI/UX
 * principle 1b of docs/plans/LGS-PLAN.md: ONE compact `Lumber | Steel` row
 * (a code-basis peer of the jurisdiction, slotted right under it) with a
 * PROGRESSIVE-DISCLOSURE 'Machine' select that exists ONLY while Steel is
 * selected — lumber users see zero change. No React, no stores (the
 * panel-warnings/panel-selection convention), so the option list, the
 * resolved value and the write patches are all testable headlessly.
 *
 * The write patches carry the Phase-0 byte-parity contract: Lumber and
 * 'no machine' REMOVE their keys (an explicit `undefined` merges over the
 * stored value and JSON-serializes to ABSENT), so a scene flipped to Steel
 * and back persists byte-identically to one never touched — absent ==
 * lumber, absent machine == generic AISI.
 */

import { LGS, machineFor } from './engines/lgs-profiles'
import type { FramingNode } from './framing/schema'

export type FramingSystemValue = 'lumber' | 'lgs'

/** The Framing control's resolved value — absent means lumber (Phase 0). */
export function framingSystemValue(
  node: Pick<FramingNode, 'framingSystem'>,
): FramingSystemValue {
  return node.framingSystem === 'lgs' ? 'lgs' : 'lumber'
}

/**
 * Write patch for the Framing control. Steel stores `'lgs'`; Lumber
 * REMOVES the key (round-trips absent — the Phase-0 contract; an explicit
 * `'lumber'` would inject a key no stored scene carries). `lgsMachine` is
 * deliberately KEPT across a Steel→Lumber flip: it stays meaningful for
 * per-wall `'lgs'` overrides on a lumber level, survives an experiment
 * round-trip without losing the user's machine choice, and only ever
 * constrains + brands + warns: at the code LODs (300/400) it never
 * re-sizes a member (the Phase-2 boundary, byte-proved); at 200 it
 * narrows the generic pick to its thinnest rollable variant (Phase-1
 * behavior, pinned).
 */
export function framingSystemPatch(next: FramingSystemValue): {
  framingSystem: 'lgs' | undefined
} {
  return { framingSystem: next === 'lgs' ? 'lgs' : undefined }
}

export type ExteriorWallsValue = 'auto' | 'framed' | 'cmu'

/** The Exterior walls control's resolved value — absent means auto (the jurisdiction's convention). */
export function exteriorWallsValue(node: Pick<FramingNode, 'exteriorWalls'>): ExteriorWallsValue {
  return node.exteriorWalls === 'framed' || node.exteriorWalls === 'cmu' ? node.exteriorWalls : 'auto'
}

/**
 * Write patch for the Exterior walls control. Framed / CMU store the
 * value; Auto REMOVES the key (the same byte-parity contract as
 * framingSystemPatch).
 */
export function exteriorWallsPatch(next: ExteriorWallsValue): { exteriorWalls: 'framed' | 'cmu' | undefined } {
  return { exteriorWalls: next === 'framed' || next === 'cmu' ? next : undefined }
}

export type RoofSystemValue = 'stick' | 'truss'

/** The Roof control's resolved value — absent means stick. */
export function roofSystemValue(node: Pick<FramingNode, 'roofSystem'>): RoofSystemValue {
  return node.roofSystem === 'truss' ? 'truss' : 'stick'
}

/**
 * Write patch for the Roof control. Truss stores `'truss'`; Stick REMOVES
 * the key — the same byte-parity contract as framingSystemPatch (an
 * explicit `'stick'` would inject a key no stored scene carries).
 */
export function roofSystemPatch(next: RoofSystemValue): { roofSystem: 'truss' | undefined } {
  return { roofSystem: next === 'truss' ? 'truss' : undefined }
}

export type ShedCeilingValue = 'none' | 'joists'

/** The Shed ceiling control's resolved value — absent means none (vaulted). */
export function shedCeilingValue(node: Pick<FramingNode, 'shedCeiling'>): ShedCeilingValue {
  return node.shedCeiling === 'joists' ? 'joists' : 'none'
}

/**
 * Write patch for the Shed ceiling control. Joists stores `'joists'`; None
 * REMOVES the key — the roofSystem byte-parity contract.
 */
export function shedCeilingPatch(next: ShedCeilingValue): { shedCeiling: 'joists' | undefined } {
  return { shedCeiling: next === 'joists' ? 'joists' : undefined }
}

/** The roof stock the panel offers — nominal 2x depths. */
export const ROOF_STOCK_OPTIONS = ['2x6', '2x8', '2x10', '2x12'] as const
export type RoofStockValue = (typeof ROOF_STOCK_OPTIONS)[number]
/** Rafter spacings the panel offers, inches o.c. */
export const RAFTER_SPACING_OPTIONS = [12, 16, 24] as const
export type RafterSpacingValue = (typeof RAFTER_SPACING_OPTIONS)[number]

/** A roof stock control's resolved value — absent means 'auto' (the table's). */
export function roofStockValue(
  node: Pick<FramingNode, 'rafterSize' | 'ridgeSize' | 'ceilingJoistSize'>,
  key: 'rafterSize' | 'ridgeSize' | 'ceilingJoistSize',
): RoofStockValue | 'auto' {
  const v = node[key]
  return v && (ROOF_STOCK_OPTIONS as readonly string[]).includes(v) ? (v as RoofStockValue) : 'auto'
}

/** Write patch for a roof stock control — 'auto' REMOVES the key (byte parity). */
export function roofStockPatch(
  key: 'rafterSize' | 'ridgeSize' | 'ceilingJoistSize',
  next: RoofStockValue | 'auto',
): Record<string, RoofStockValue | undefined> {
  return { [key]: next === 'auto' ? undefined : next }
}

/** The rafter spacing control's resolved value — absent means 'auto' (the spec's 24 in). */
export function rafterSpacingValue(node: Pick<FramingNode, 'rafterSpacingIn'>): RafterSpacingValue | 'auto' {
  const v = node.rafterSpacingIn
  return v === 12 || v === 16 || v === 24 ? v : 'auto'
}

/** Write patch for the rafter spacing control — 'auto' REMOVES the key. */
export function rafterSpacingPatch(next: RafterSpacingValue | 'auto'): { rafterSpacingIn: RafterSpacingValue | undefined } {
  return { rafterSpacingIn: next === 'auto' ? undefined : next }
}

/** The MEP routing controls: each an enum key on the framing node; 'auto' REMOVES the key. */
export const SERVICE_CONTROLS = [
  {
    key: 'wiringRoute',
    label: 'Branch wiring',
    options: [
      ['attic', 'Attic'],
      ['walls', 'Walls'],
    ],
    note: 'Auto: across the attic and down the walls on the top storey, bored through the studs below it.',
  },
  {
    key: 'serviceEntrance',
    label: 'Service entrance',
    options: [
      ['overhead', 'Overhead'],
      ['underground', 'Underground'],
    ],
    note: 'Auto: an overhead drop from the pole at the lot line to a mast on the meter wall.',
  },
  {
    key: 'panelSide',
    label: 'Meter-main side',
    options: [
      ['left', 'Left'],
      ['right', 'Right'],
    ],
    note: "Seen from the street. Auto: the garage's side wall, near the front.",
  },
  {
    key: 'sewerSide',
    label: 'Sewer to',
    options: [
      ['street', 'Street'],
      ['rear', 'Rear'],
    ],
    note: 'Auto: under the house to the street.',
  },
  {
    key: 'waterRoute',
    label: 'Water supply',
    options: [
      ['attic', 'Attic'],
      ['under-slab', 'Under slab'],
      ['crawl', 'Crawl'],
      ['walls', 'Walls'],
    ],
    note: 'Auto: the attic on a slab in the slab states (PEX), the crawl space on a raised floor.',
  },
  {
    key: 'hvacSystem',
    label: 'HVAC system',
    options: [
      ['heat-pump-split', 'Heat pump'],
      ['ac-gas-furnace', 'AC + furnace'],
      ['packaged', 'Packaged'],
      ['mini-split', 'Mini-split'],
    ],
    note: 'Auto: a split heat pump in the South and the West Coast, AC over a gas furnace elsewhere.',
  },
  {
    key: 'waterHeater',
    label: 'Water heater',
    options: [
      ['electric-tank', 'Electric tank'],
      ['gas-tank', 'Gas tank'],
      ['heat-pump', 'Heat pump'],
      ['tankless-gas', 'Tankless gas'],
      ['tankless-electric', 'Tankless elec.'],
    ],
    note: 'Auto: a heat-pump heater where the energy code makes it the baseline (CA, WA, OR), a gas tank beside a gas furnace, an electric tank elsewhere.',
  },
] as const
export type ServiceControlKey = (typeof SERVICE_CONTROLS)[number]['key']

/** A service control's resolved value — absent means 'auto'. */
export function serviceControlValue(node: Partial<Record<ServiceControlKey, string | undefined>>, key: ServiceControlKey): string {
  const v = node[key]
  return typeof v === 'string' && v !== '' ? v : 'auto'
}

/** Write patch for a service control — 'auto' REMOVES the key (byte parity). */
export function serviceControlPatch(key: ServiceControlKey, next: string): Record<string, string | undefined> {
  return { [key]: next === 'auto' ? undefined : next }
}

/** The post pad sizes the panel offers, inches square (the 24 in pad is the engine's default). */
export const POST_PAD_OPTIONS = [16, 18, 20, 24] as const
export type PostPadValue = (typeof POST_PAD_OPTIONS)[number]

/** The Post pad control's resolved value — absent means the engine's 24 in. */
export function postPadValue(node: Pick<FramingNode, 'postPadIn'>): number {
  return typeof node.postPadIn === 'number' && node.postPadIn > 0 ? node.postPadIn : 24
}

/** Write patch for the Post pad control: 24 REMOVES the key (the byte-parity contract). */
export function postPadPatch(next: number): { postPadIn: number | undefined } {
  return { postPadIn: next === 24 ? undefined : next }
}

/** The Machine select's 'no machine' sentinel (a native select can't carry
 * undefined) and its honest label — steel with no machine IS generic AISI. */
export const LGS_MACHINE_NONE = ''
export const LGS_MACHINE_NONE_LABEL = 'None (generic AISI)'

/** Write patch for the Machine select: the sentinel removes the key
 * (absent round-trips absent — the Phase-0 gate extends over this write). */
export function lgsMachinePatch(key: string): { lgsMachine: string | undefined } {
  return { lgsMachine: key === LGS_MACHINE_NONE ? undefined : key }
}

export type LgsMachineOption = { key: string; label: string }
export type LgsMachineGroup = { vendor: string; machines: LgsMachineOption[] }

/**
 * Machine select entries, straight from the cited catalog — one group per
 * vendor (the natural `<optgroup>` shape). The honesty statuses ARE the
 * ordering: VERIFIED machines make the primary list verbatim; anything
 * else keeps its honest '(unverified)' suffix and sorts below the verified
 * rows of its vendor, and vendors with NO verified machine (Pinnacle) sink
 * to the end. Nothing is hidden and nothing is invented — an unverified
 * machine is selectable, and every resolution under it says so.
 */
export function lgsMachineGroups(): LgsMachineGroup[] {
  const groups = Object.entries(LGS.vendors).map(([vendorKey, vendor]) => {
    const machines = Object.entries(vendor.machines).map(([machineKey, machine]) => ({
      key: `${vendorKey}/${machineKey}`,
      label:
        machine.status === 'verified' ? machine.name : `${machine.name} (unverified)`,
      verified: machine.status === 'verified',
    }))
    // stable: catalog order within each verified class
    machines.sort((a, b) => Number(b.verified) - Number(a.verified))
    return {
      vendor: vendor.name,
      anyVerified: machines.some((m) => m.verified),
      machines: machines.map(({ key, label }) => ({ key, label })),
    }
  })
  groups.sort((a, b) => Number(b.anyVerified) - Number(a.anyVerified))
  return groups.map(({ vendor, machines }) => ({ vendor, machines }))
}

/**
 * Extra trailing option when the STORED `lgsMachine` isn't one of the
 * select's option values (an MCP write with a case-variant or unknown key):
 * a native select would silently DISPLAY the first option while the scene
 * holds something else — a lie. The extra option keeps the stored value
 * visible and honest; null when the key is a normal catalog option (or no
 * machine is stored).
 */
export function lgsMachineSelectExtra(
  current: string | undefined,
): LgsMachineOption | null {
  if (current === undefined || current === LGS_MACHINE_NONE) return null
  const known = lgsMachineGroups().some((g) => g.machines.some((m) => m.key === current))
  if (known) return null
  const machine = machineFor(current)
  return machine
    ? { key: current, label: `${machine.name} (as '${current}')` }
    : { key: current, label: `${current} (not in catalog)` }
}
