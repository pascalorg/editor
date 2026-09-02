import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * Sidebar composition gates (user round 2026-08-20) — the panel drags the
 * host editor/viewer barrels, which cannot evaluate under bun test, so these
 * are source-level assertions on the component tree (the sanctioned
 * grep-level form for this harness):
 *  - Change B: the "Place service points" button is GONE from the sidebar;
 *  - Change C: the per-wall engineering card is GONE from the sidebar and
 *    lives only on the floating inspector extension (full option parity);
 *  - Change A/D: activation + the tri-state view control are wired through
 *    the click-scoped activation module — no mount-time wall-mode magic.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('sidebar panel composition (source gates)', () => {
  const panel = read('./panel.tsx')

  test('Change B: no service-points section or placement button', () => {
    expect(panel).not.toContain('ServicePointsSection')
    expect(panel).not.toContain('Place service points')
    expect(panel).not.toContain('buildServicePointNodes')
  })

  test('Change C: no per-wall engineering card in the sidebar', () => {
    expect(panel).not.toContain('SelectedWallCard')
    expect(panel).not.toContain('selectedWallInfo')
    expect(panel).not.toContain('Exterior finish')
  })

  test('Change A: create/remove ride the click-scoped activation module', () => {
    expect(panel).toContain('activateXray(')
    expect(panel).toContain('removeXray(')
    expect(panel).not.toContain('setWallMode') // no direct wall-mode writes
  })

  test('Change D/E: the tri-state view control replaces the seeThrough toggle', () => {
    expect(panel).toContain('setXrayViewMode(')
    expect(panel).toContain("value: 'off'")
    expect(panel).toContain("value: 'xray'")
    expect(panel).toContain("value: 'basement'")
    expect(panel).not.toContain('seeThrough') // legacy toggle fully retired
    expect(panel).not.toContain('X-ray vision')
  })

  // Day-9 round: 'Basement' misleads on upper storeys (the mode shows the
  // floor framing below THIS storey) — the LABEL becomes 'Subfloor'.
  // INTENDED-CHANGE: the persisted schema value 'basement' does NOT migrate
  // (the `value: 'basement'` pin above still holds).
  test("day-9 rename: the third view-mode option reads 'Subfloor', value stays 'basement'", () => {
    expect(panel).toContain("{ label: 'Subfloor', value: 'basement' }")
    expect(panel).not.toContain("label: 'Basement'")
  })
})

test('C5: the plan-set export passes the gross-fallback areas (one source of truth)', () => {
  const src = readFileSync(new URL('./panel.tsx', import.meta.url), 'utf8')
  expect(src).toContain('areas: result.areas')
})

describe('jurisdiction notes reach the PANEL (the CA territories\u2019 PERMAFROST channel)', () => {
  const panel = read('./panel.tsx')

  test('the picker receives AND renders profile.notes \u2014 the channel exists end-to-end', () => {
    // profileFor builds `Frost: \u2026` / `Snow: \u2026` strings (incl. the
    // territories' PERMAFROST warning) into profile.notes; before 2026-08-24
    // NOTHING rendered them \u2014 the warning lived only in the data file.
    // Source gate (the sanctioned grep-level form for this harness): the
    // call site passes them and the component prints them.
    expect(panel).toContain('notes={profile.notes}')
    expect(panel).toContain('{notes.join(' + "' \u00b7 '" + ')}')
  })
})

describe('day-9 declutter: warnings + flags fold away, the summary stays', () => {
  const panel = read('./panel.tsx')

  test('warnings render through the pure grouping helper — no raw dump on the rail', () => {
    expect(panel).toContain("from './panel-warnings'")
    expect(panel).toContain('groupWarnings(')
    expect(panel).toContain('warningCount(')
    // the old always-expanded verbatim dump is gone
    expect(panel).not.toContain('new Set(result.warnings)')
  })

  test('the warnings drawer is COLLAPSED by default (no open attribute anywhere static)', () => {
    // the panel's only <details open…> is the takeoff's computed one — the
    // warnings drawer (and every other section drawer) mounts closed
    expect(panel).toContain('Warnings')
    expect(panel).not.toContain('<details open')
    const opens = panel.match(/<details[^>]*\bopen=/g) ?? []
    expect(opens).toHaveLength(1) // TakeoffSection's index-0 expression only
  })

  test('takeoff Flags start collapsed too — no force-open special case', () => {
    expect(panel).toContain("open={index === 0 && section !== 'Flags'}")
    expect(panel).not.toContain("open={index === 0 || section === 'Flags'}")
  })

  test('the compact summary line stays always visible outside the drawer', () => {
    expect(panel).toContain('{result.members.length} members · {result.fixtures.length} devices')
  })
})

describe('floating inspector keeps the FULL wall engineering surface', () => {
  const card = read('./inspector/wall-engineering.tsx')

  test('every option the sidebar card used to carry', () => {
    // construction override (LGS Phase 2 added Steel to the same control)
    for (const needle of ["value: 'framed'", "value: 'lgs'", "value: 'cmu'", "value: 'skip'"]) {
      expect(card).toContain(needle)
    }
    // CMU height slider
    expect(card).toContain('Block height')
    // studs: size + spacing
    for (const needle of ["value: '2x4'", "value: '2x6'", 'spacingIn']) {
      expect(card).toContain(needle)
    }
    // insulation + exterior finish
    expect(card).toContain('INSULATION_OPTIONS')
    expect(card).toContain('Exterior finish')
    expect(card).toContain('CLADDING_OPTIONS')
    expect(card).toContain('paintWallExterior')
  })

  test('its X-Ray call to action uses the same coherent activation', () => {
    expect(card).toContain('activateXray(')
  })

  // LGS Phase 2 — the Steel segment rides the ONE existing construction
  // control (LGS-PLAN UI/UX principle 1a: a 4th segment, no new rows), in
  // the boarded order Framed · Steel · CMU · Skip, and the control's value
  // is the RESOLVED construction (info.construction) so an MCP-set 'lgs'
  // wall highlights its segment (the Phase-0 documented gap).
  test("Phase 2: Steel is a 4th segment of the SAME construction control — no new rows", () => {
    const options = card.match(
      /options=\{\[\s*\{ label: 'Framed', value: 'framed' \},\s*\{ label: 'Steel', value: 'lgs' \},\s*\{ label: 'CMU', value: 'cmu' \},\s*\{ label: 'Skip', value: 'skip' \},\s*\]\}/,
    )
    expect(options).not.toBeNull()
    // exactly one construction control — Steel did not grow a second one
    expect(card.match(/value: 'framed'/g) ?? []).toHaveLength(1)
    expect(card.match(/value: 'lgs'/g) ?? []).toHaveLength(1)
    // the segment highlight reads the RESOLVED construction
    expect(card).toContain('value={info.construction}')
  })
})

describe("LGS Phase 2: the panel 'Framing' row (source gates)", () => {
  const panel = read('./panel.tsx')

  test('slots between the JurisdictionPicker and the detail/spacing row (a code-basis peer of jurisdiction)', () => {
    const jurisdiction = panel.indexOf('<JurisdictionPicker')
    const framing = panel.indexOf('<FramingRow')
    const detail = panel.indexOf("{ label: 'Generic', value: '200' }")
    expect(jurisdiction).toBeGreaterThan(-1)
    expect(framing).toBeGreaterThan(jurisdiction)
    expect(detail).toBeGreaterThan(framing)
  })

  test('ONE compact Lumber | Steel control riding the existing SegmentedControl idiom', () => {
    expect(panel).toContain("{ label: 'Lumber', value: 'lumber' }")
    expect(panel).toContain("{ label: 'Steel', value: 'lgs' }")
    // the row's label matches the JurisdictionPicker label idiom
    expect(panel).toContain('>Framing</span>')
  })

  test('PROGRESSIVE DISCLOSURE: the Machine select exists ONLY inside the Steel conditional — lumber users see zero change', () => {
    expect(panel).toContain("{system === 'lgs' && (")
    const conditional = panel.indexOf("{system === 'lgs' && (")
    // the machine label, the None option and the vendor optgroups all live
    // AFTER the guard, exactly once (one Machine row in the whole file;
    // LGS_MACHINE_NONE_LABEL also appears once in the import list)
    for (const needle of [
      '>Machine</span>',
      '{LGS_MACHINE_NONE_LABEL}',
      '<optgroup',
    ]) {
      const at = panel.indexOf(needle)
      expect(at).toBeGreaterThan(conditional)
      expect(panel.indexOf(needle, at + 1)).toBe(-1)
    }
  })

  test('writes ride the pure byte-parity patches (panel-framing.ts), never raw field pokes', () => {
    expect(panel).toContain("from './panel-framing'")
    expect(panel).toContain('framingSystemPatch(')
    expect(panel).toContain('lgsMachinePatch(')
    // no literal 'lumber' write — Lumber removes the key (Phase-0 parity)
    expect(panel).not.toContain("framingSystem: 'lumber'")
  })

  test('a stored-but-unknown machine key stays visible (the honest extra option)', () => {
    expect(panel).toContain('lgsMachineSelectExtra(')
    expect(panel).toContain('{extra && <option value={extra.key}>{extra.label}</option>}')
  })
})

describe('renderer: wall-mode mount magic is gone (Change A root-cause fix)', () => {
  test('no setWallMode anywhere in the renderer', () => {
    expect(read('./framing/renderer.tsx')).not.toContain('setWallMode')
  })
})
