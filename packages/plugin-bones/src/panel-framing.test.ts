import { describe, expect, test } from 'bun:test'
import { LGS, machineFor, machineKeys } from './engines/lgs-profiles'
import { FramingNode } from './framing/schema'
import {
  framingSystemPatch,
  framingSystemValue,
  roofSystemPatch,
  roofSystemValue,
  LGS_MACHINE_NONE,
  LGS_MACHINE_NONE_LABEL,
  lgsMachineGroups,
  lgsMachinePatch,
  lgsMachineSelectExtra,
} from './panel-framing'

/**
 * The sidebar 'Framing' row's pure helpers (LGS Phase 2). Gate classes:
 * value resolution (absent == lumber), write patches (the Phase-0
 * byte-parity contract — Lumber/'None' REMOVE their keys and round-trip
 * absent), and the machine option list (catalog verbatim, honesty
 * statuses as ordering + suffix, never a hidden or invented row).
 */

describe('Framing control value + writes (byte-parity contract)', () => {
  test("absent == lumber; only 'lgs' selects Steel", () => {
    expect(framingSystemValue({})).toBe('lumber')
    expect(framingSystemValue({ framingSystem: 'lumber' })).toBe('lumber')
    expect(framingSystemValue({ framingSystem: 'lgs' })).toBe('lgs')
  })

  test('Steel stores lgs; Lumber REMOVES the key — a Steel round-trip persists byte-identically to untouched', () => {
    expect(framingSystemPatch('lgs')).toEqual({ framingSystem: 'lgs' })
    expect(framingSystemPatch('lumber')).toEqual({ framingSystem: undefined })
    const untouched = FramingNode.parse({})
    const steel = { ...untouched, ...framingSystemPatch('lgs') }
    expect(steel.framingSystem).toBe('lgs')
    const back = { ...steel, ...framingSystemPatch('lumber') }
    // the undefined merge serializes to ABSENT — byte-equal persistence
    expect(JSON.stringify(back)).toBe(JSON.stringify(untouched))
    expect('framingSystem' in FramingNode.parse(JSON.parse(JSON.stringify(back)))).toBe(
      false,
    )
  })

  test("machine writes: a key stores verbatim, the 'None' sentinel removes — lgsMachine absent round-trips absent (the Phase-0 gate extends)", () => {
    expect(lgsMachinePatch('framecad/tf550h')).toEqual({ lgsMachine: 'framecad/tf550h' })
    expect(lgsMachinePatch(LGS_MACHINE_NONE)).toEqual({ lgsMachine: undefined })
    const withMachine = {
      ...FramingNode.parse({ framingSystem: 'lgs' }),
      ...lgsMachinePatch('framecad/tf550h'),
    }
    const cleared = { ...withMachine, ...lgsMachinePatch(LGS_MACHINE_NONE) }
    const reparsed = FramingNode.parse(JSON.parse(JSON.stringify(cleared)))
    expect('lgsMachine' in reparsed).toBe(false)
    expect(reparsed.framingSystem).toBe('lgs') // clearing the machine never clears steel
  })

  test("the sentinel is the empty string with the honest generic label — steel with no machine IS generic AISI", () => {
    expect(LGS_MACHINE_NONE).toBe('')
    expect(LGS_MACHINE_NONE_LABEL).toBe('None (generic AISI)')
  })
})

describe('machine option groups — the catalog verbatim, honesty as ordering', () => {
  const groups = lgsMachineGroups()
  const flat = groups.flatMap((g) => g.machines)

  test('every catalog machine appears exactly once, every key resolves', () => {
    expect(flat.map((m) => m.key).sort()).toEqual(machineKeys().sort())
    for (const m of flat) expect(machineFor(m.key)).toBeDefined()
  })

  test('grouped by vendor with the vendor display names', () => {
    expect(groups.map((g) => g.vendor).sort()).toEqual(
      Object.values(LGS.vendors)
        .map((v) => v.name)
        .sort(),
    )
  })

  test("VERIFIED machines make the primary list verbatim; everything else carries the honest '(unverified)' suffix", () => {
    for (const m of flat) {
      const machine = machineFor(m.key)
      if (!machine) throw new Error(`unresolvable key ${m.key}`)
      if (machine.status === 'verified') {
        expect(m.label).toBe(machine.name)
        expect(m.label).not.toContain('(unverified)')
      } else {
        expect(m.label).toBe(`${machine.name} (unverified)`)
      }
    }
    // the live example: both Pinnacle rows are suffixed
    const pinnacle = flat.filter((m) => m.key.startsWith('pinnacle/'))
    expect(pinnacle.length).toBe(2)
    for (const m of pinnacle) expect(m.label).toContain('(unverified)')
  })

  test('unverified rows sink: below verified rows within a vendor, all-unverified vendors last', () => {
    for (const g of groups) {
      const verifiedFlags = g.machines.map(
        (m) => machineFor(m.key)?.status === 'verified',
      )
      // no verified row after an unverified one inside a group
      expect(verifiedFlags.join(',')).toBe([...verifiedFlags].sort().reverse().join(','))
    }
    const anyVerified = groups.map((g) =>
      g.machines.some((m) => machineFor(m.key)?.status === 'verified'),
    )
    expect(anyVerified.join(',')).toBe([...anyVerified].sort().reverse().join(','))
    // Pinnacle (the catalog's only all-unverified vendor) is the last group
    expect(groups[groups.length - 1]?.vendor).toBe('Pinnacle LGS')
  })
})

describe('stored-but-not-an-option keys stay visible (never a silently lying select)', () => {
  test('normal catalog keys and no-machine need no extra option', () => {
    expect(lgsMachineSelectExtra(undefined)).toBeNull()
    expect(lgsMachineSelectExtra(LGS_MACHINE_NONE)).toBeNull()
    expect(lgsMachineSelectExtra('framecad/tf550h')).toBeNull()
    expect(lgsMachineSelectExtra('pinnacle/x1')).toBeNull()
  })

  test('a case-variant key that still resolves shows the machine with its stored spelling', () => {
    const extra = lgsMachineSelectExtra('FRAMECAD/TF550H')
    expect(extra).toEqual({
      key: 'FRAMECAD/TF550H',
      label: "FRAMECAD TF550H (as 'FRAMECAD/TF550H')",
    })
  })

  test('an unknown key says so — never displayed as some other option', () => {
    expect(lgsMachineSelectExtra('acme/rocket')).toEqual({
      key: 'acme/rocket',
      label: 'acme/rocket (not in catalog)',
    })
  })
})

describe('Roof control value + writes (the same byte-parity contract)', () => {
  test("absent == stick; only 'truss' selects Truss", () => {
    expect(roofSystemValue({})).toBe('stick')
    expect(roofSystemValue({ roofSystem: 'stick' })).toBe('stick')
    expect(roofSystemValue({ roofSystem: 'truss' })).toBe('truss')
  })

  test('Truss stores truss; Stick REMOVES the key — a Truss round-trip persists byte-identically to untouched', () => {
    expect(roofSystemPatch('truss')).toEqual({ roofSystem: 'truss' })
    expect(roofSystemPatch('stick')).toEqual({ roofSystem: undefined })
    const untouched = FramingNode.parse({})
    expect('roofSystem' in untouched).toBe(false)
    const trussed = { ...untouched, ...roofSystemPatch('truss') }
    expect(trussed.roofSystem).toBe('truss')
    const back = { ...trussed, ...roofSystemPatch('stick') }
    expect(JSON.stringify(back)).toBe(JSON.stringify(untouched))
    expect('roofSystem' in FramingNode.parse(JSON.parse(JSON.stringify(back)))).toBe(false)
  })

  test('the schema accepts both values and rejects anything else', () => {
    expect(FramingNode.parse({ roofSystem: 'truss' }).roofSystem).toBe('truss')
    expect(FramingNode.parse({ roofSystem: 'stick' }).roofSystem).toBe('stick')
    expect(() => FramingNode.parse({ roofSystem: 'scissor' })).toThrow()
  })
})
