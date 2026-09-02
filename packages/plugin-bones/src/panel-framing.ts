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
