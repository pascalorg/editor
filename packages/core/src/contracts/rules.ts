/**
 * How each non-negotiable rule R1–R9 is guarded (A-02). A rule names the
 * test that checks it in this repo, the baseline gate that measures it, or
 * both. `FIDELITY_GATES` mirrors the gate keys of the private benchmark
 * fixture (`bench/fixtures/next-house/baseline.json`, owned by A-01); the
 * private inventory generator fails when the two lists differ, and
 * `reference-inventory.test.ts` fails when a rule names a missing gate, file
 * or test.
 */

export const FIDELITY_GATES = [
  'gesturesOnFullHouse',
  'zoneRedetection',
  'oneUndoPerGesture',
  'apiV1Plugins',
  'interactivityAfterBake',
  'agentParity',
  'capture',
] as const

export type FidelityGate = (typeof FIDELITY_GATES)[number]

/** A test by its file (relative to `packages/core/src`) and its describe or test title. */
export type RuleCheck = { file: string; title: string }

export type RuleGuard = {
  checks: readonly RuleCheck[]
  gates: readonly FidelityGate[]
  plan?: string
}

const EXAMPLES = 'contracts/fidelity.test.ts'
const INVENTORY = 'contracts/reference-inventory.test.ts'

export const RULE_GUARDS: Record<`R${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`, RuleGuard> = {
  R1: { checks: [], gates: ['apiV1Plugins'], plan: 'A-09; opaque kinds need no records (P-03)' },
  R2: { checks: [], gates: ['gesturesOnFullHouse', 'oneUndoPerGesture'], plan: 'A-08, A-11, A-12' },
  R3: {
    checks: [
      { file: INVENTORY, title: 'existing-reference inventory (R3)' },
      { file: INVENTORY, title: 'clone columns match today (R3 extractor evidence)' },
    ],
    gates: [],
    plan: 'P-03 declares every row in capabilities.refs',
  },
  R4: { checks: [], gates: ['zoneRedetection'], plan: 'room-bounding capability in B-03' },
  R5: {
    checks: [],
    gates: ['gesturesOnFullHouse', 'agentParity'],
    plan: 'capability-parity probes in B-04/B-06',
  },
  R6: {
    checks: [{ file: EXAMPLES, title: 'pascalPart v1 tags (F4)' }],
    gates: ['interactivityAfterBake'],
  },
  R7: {
    checks: [
      {
        file: EXAMPLES,
        title: 'section library and definition pinning (owner decision O4, frozen)',
      },
    ],
    gates: [],
    plan: 'designs contract probe in B-07',
  },
  R8: { checks: [{ file: EXAMPLES, title: 'kernel host seam' }], gates: ['agentParity'] },
  R9: {
    checks: [{ file: INVENTORY, title: 'source-namespace provenance (R9)' }],
    gates: ['capture'],
  },
}
