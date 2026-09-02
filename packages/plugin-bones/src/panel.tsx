'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import {
  activateXray,
  removeXray,
  type SceneLike,
  setXrayViewMode,
  type ViewerLike,
} from './activation'
import { computeLevel } from './framing/compute'
import { extractLevels } from './core/wall-model'
import { effectiveViewMode, type FramingNode, type ViewMode } from './framing/schema'
import { buildPlanSet, planSetHtml, relativeLevelBaseY } from './plans/plan-set'
import { characteristicsCsv, characteristicsRows } from './engines/characteristics'
import { computeTakeoff, cutList, cutListCsv, takeoffCsv } from './engines/takeoff'
import { guessJurisdiction } from './jurisdiction/guess'
import { jurisdictionOptions, profileFor } from './jurisdiction/profiles'
import { LUMBER_CROSS_SECTIONS, LUMBER_SIZES, type LumberSize } from './lumber'
import {
  type FramingSystemValue,
  framingSystemPatch,
  framingSystemValue,
  type RoofSystemValue,
  roofSystemPatch,
  roofSystemValue,
  LGS_MACHINE_NONE,
  LGS_MACHINE_NONE_LABEL,
  lgsMachineGroups,
  lgsMachinePatch,
  lgsMachineSelectExtra,
} from './panel-framing'
import { groupWarnings, warningCount } from './panel-warnings'
import { useBonesStore } from './store'

const LUMBER_KIND: string = 'bones:lumber'
const FRAMING_KIND: string = 'bones:framing'

const setPluginTool = (tool: string) => {
  const setTool = useEditor.getState().setTool as (value: string) => void
  setTool(tool)
}

const METERS_PER_INCH = 0.0254
const inchesLabel = (m: number) =>
  `${(m / METERS_PER_INCH).toFixed(2).replace(/\.?0+$/, '')}"`

/**
 * The Bones panel — the control room for the engineering X-ray. One click
 * derives the construction inside the current level (framing, foundation,
 * electrical…) from the model and renders it in 3D; everything below tunes
 * the derivation. Loose lumber placement lives at the bottom.
 */
export default function BonesPanel() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const framingNode = useScene((s) => {
    if (!activeLevelId) return undefined
    return Object.values(s.nodes).find(
      (n) => (n.type as string) === FRAMING_KIND && n.parentId === activeLevelId,
    ) as (FramingNode & { id: string }) | undefined
  })
  // ONE derivation per scene edit, shared by the X-Ray status line and the
  // takeoff — the renderer runs its own (also once). Reviewer advisory r1.
  const nodes = useScene((s) => s.nodes)
  const result = useMemo(() => {
    if (!framingNode) return null
    return computeLevel(nodes as Record<string, Record<string, unknown>>, framingNode)
  }, [nodes, framingNode])

  return (
    <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base">Bones</h2>
          <span className="rounded-full border border-sidebar-border/60 bg-sidebar-accent px-1.5 py-px font-semibold text-[9px] text-sidebar-foreground/70 uppercase tracking-widest">
            Alpha
          </span>
        </div>
        <p className="text-sidebar-foreground/50 text-xs leading-relaxed">
          The engineering X-ray — see the construction inside the model: framing, foundation,
          wiring. Computed from your walls, sized to your jurisdiction.
        </p>
      </header>

      {/* Per-wall engineering lives ONLY on the floating inspector card
          (the plugin's wall Engineering extension) — the sidebar mirror
          cluttered the rail (user round 2026-08-20). Service points place
          themselves at activation; no button (same round). */}
      <XraySection activeLevelId={activeLevelId ?? null} framingNode={framingNode} result={result} />

      {framingNode && result && <TakeoffSection result={result} />}
      {framingNode && result && <CharacteristicsSection result={result} />}

      <LumberSection />

      <footer className="-mx-4 -mb-4 sticky bottom-0 mt-1 flex flex-col gap-2 border-sidebar-border/50 border-t bg-sidebar px-4 py-3 text-[11px] text-sidebar-foreground/50 leading-relaxed">
        <span>Drafting aid, not engineering — verify with your local building department.</span>
        {framingNode && result && result.members.length > 0 && (
          <ExportPlansButton
            result={result}
            framingNode={framingNode}
            activeLevelId={activeLevelId ?? null}
            codeName={result.spec ? profileFor(result.jurisdiction).residentialCode : undefined}
          />
        )}
      </footer>
    </div>
  )
}

function XraySection({
  activeLevelId,
  framingNode,
  result,
}: {
  activeLevelId: string | null
  framingNode: (FramingNode & { id: string }) | undefined
  result: ReturnType<typeof computeLevel> | null
}) {
  // Client-only guess: the timezone differs between SSR and browser, which
  // would desync hydration — render a stable label first, fill in on mount.
  const [guess, setGuess] = useState<{ code: string; reason: string } | null>(null)
  useEffect(() => setGuess(guessJurisdiction()), [])
  const options = useMemo(() => jurisdictionOptions(), [])
  // Day-9 declutter: warnings fold into a collapsed drawer, repeated-class
  // lines grouped — PANEL presentation only; result.warnings stays verbatim
  // (the plan-set Flags block prints every line, always).
  const warningLines = useMemo(() => groupWarnings(result?.warnings ?? []), [result])

  const toggle = (key: keyof FramingNode) => {
    if (!framingNode) return
    useScene
      .getState()
      .updateNode(framingNode.id as AnyNodeId, {
        [key]: !framingNode[key],
      } as Partial<AnyNode> as never)
  }

  if (!activeLevelId) {
    return <p className="text-sidebar-foreground/50 text-xs">Select a level to X-ray.</p>
  }

  if (!framingNode) {
    return (
      <button
        className="rounded-md border border-sidebar-ring bg-sidebar-accent px-3 py-2 text-left font-medium text-sm transition-colors hover:bg-sidebar-accent/70"
        onClick={() =>
          // One coherent activation (user round 2026-08-20): the framing
          // node + every service point in ONE undo entry, walls to Low
          // once, viewMode 'xray' by default — all scoped to this click.
          activateXray(
            useScene as unknown as SceneLike,
            activeLevelId,
            useViewer as unknown as ViewerLike,
          )
        }
        type="button"
      >
        ⚡ X-Ray this level
        <span className="block font-normal text-sidebar-foreground/50 text-xs">
          Derive framing, foundation &amp; systems from the model
        </span>
      </button>
    )
  }

  const effectiveCode = result?.jurisdiction ?? 'INTL'
  const profile = profileFor(effectiveCode)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">X-Ray</span>
        <button
          className="rounded-md border border-sidebar-border/60 px-2 py-1 text-sidebar-foreground/70 text-xs transition-colors hover:bg-sidebar-accent"
          onClick={() =>
            // Deactivation mirror of the create click: framing node + the
            // level's auto-managed service/device nodes in one undo entry,
            // walls restored to the pre-X-ray mode.
            removeXray(
              useScene as unknown as SceneLike,
              framingNode.id as string,
              activeLevelId,
              useViewer as unknown as ViewerLike,
            )
          }
          type="button"
        >
          Remove
        </button>
      </div>

      {/* OFF / X-RAY / SUBFLOOR — the control IS the switch: off↔on flips
          also drive the host wall mode (Low on, restore off); between the
          two active modes walls stay where the user put them. Label reads
          "Subfloor" (day-9: on upper storeys it's the floor framing below
          THIS storey, not a basement) — the persisted schema value stays
          'basement'; do NOT migrate it. */}
      <SegmentedControl
        onChange={(v: string) =>
          setXrayViewMode(
            useScene as unknown as SceneLike,
            framingNode,
            v as ViewMode,
            useViewer as unknown as ViewerLike,
          )
        }
        options={[
          { label: 'Normal', value: 'off' },
          { label: 'X-ray', value: 'xray' },
          { label: 'Subfloor', value: 'basement' },
        ]}
        value={effectiveViewMode(framingNode)}
      />

      <JurisdictionPicker
        framingNodeId={framingNode.id as AnyNodeId}
        value={framingNode.jurisdiction}
        guess={guess}
        options={options}
        codeName={profile.residentialCode}
        notes={profile.notes}
      />

      <FramingRow framingNode={framingNode} />

      <RoofRow framingNode={framingNode} />

      <div className="flex gap-2">
        <div className="flex-1">
          <SegmentedControl
            onChange={(v: string) =>
              useScene
                .getState()
                .updateNode(framingNode.id as AnyNodeId, { detail: v } as Partial<AnyNode> as never)
            }
            options={[
              { label: 'Generic', value: '200' },
              { label: 'Code', value: '300' },
              { label: 'Fab', value: '400' },
            ]}
            value={framingNode.detail}
          />
        </div>
        <div className="w-28">
          <SegmentedControl
            onChange={(v: string) =>
              useScene
                .getState()
                .updateNode(framingNode.id as AnyNodeId, {
                  studSpacingIn: Number(v) as 12 | 16 | 24,
                } as Partial<AnyNode> as never)
            }
            options={[
              { label: '12', value: '12' },
              { label: '16', value: '16' },
              { label: '24', value: '24' },
            ]}
            value={String(framingNode.studSpacingIn)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['showWalls', 'Wall framing'],
            ['showFloor', 'Floor'],
            ['showRoof', 'Roof'],
            ['showFoundation', 'Foundation'],
            ['showElectrical', 'Electrical'],
            ['showPlumbing', 'Plumbing'],
            ['showHvac', 'HVAC'],
          ] as const
        ).map(([key, label]) => (
          <button
            className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
              framingNode[key]
                ? 'border-sidebar-ring bg-sidebar-accent text-sidebar-foreground'
                : 'border-sidebar-border/60 bg-sidebar-accent/30 text-sidebar-foreground/60 hover:bg-sidebar-accent/60'
            }`}
            key={key}
            onClick={() => toggle(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {result && (
        <div className="flex flex-col gap-1 text-[11px] text-sidebar-foreground/50">
          {/* the compact summary stays always visible — only the warning
              text folds away (day-9: "we cannot have so much text on the
              sidebar") */}
          <span>
            {result.members.length} members · {result.fixtures.length} devices
          </span>
          {warningLines.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between text-[11px]">
                <span className="font-medium text-amber-500/90">Warnings</span>
                <span className="text-[10px] text-sidebar-foreground/40">
                  {warningCount(warningLines)}
                </span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5 pl-1">
                {warningLines.map((line) =>
                  line.kind === 'single' ? (
                    <span className="block text-amber-500/80" key={line.text}>
                      {line.text}
                    </span>
                  ) : (
                    <details key={line.message}>
                      <summary className="cursor-pointer text-amber-500/80">
                        {line.label} ({line.warnings.length}): {line.message}
                      </summary>
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                        {line.warnings.map((warning) => (
                          <span className="block text-amber-500/60" key={warning}>
                            {warning}
                          </span>
                        ))}
                      </div>
                    </details>
                  ),
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function TakeoffSection({ result }: { result: NonNullable<ReturnType<typeof computeLevel>> }) {
  const rows = useMemo(
    () => computeTakeoff(result.members, result.fixtures, result.areas),
    [result],
  )

  // Group by section (the takeoff engine's `section` field; tolerate rows
  // that predate it). FLAG rows always surface in their own group on top.
  const sections = useMemo(() => {
    const bySection = new Map<string, typeof rows>()
    for (const row of rows) {
      const section = ((row as { section?: string }).section ?? 'Takeoff') as string
      const bucket = bySection.get(section)
      if (bucket) bucket.push(row)
      else bySection.set(section, [row])
    }
    const entries = [...bySection.entries()]
    entries.sort(([a], [b]) => (a === 'Flags' ? -1 : b === 'Flags' ? 1 : 0))
    return entries
  }, [rows])

  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-xs">Takeoff</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border border-sidebar-border/60 px-2 py-0.5 text-[10px] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent"
            onClick={() => navigator.clipboard?.writeText(takeoffCsv(rows))}
            type="button"
          >
            Copy CSV
          </button>
          <button
            className="rounded-md border border-sidebar-border/60 px-2 py-0.5 text-[10px] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent"
            onClick={() =>
              navigator.clipboard?.writeText(cutListCsv(cutList(result.members)))
            }
            title="Every wood member: size × exact cut length × qty"
            type="button"
          >
            Copy cut list
          </button>
        </div>
      </div>
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
        {/* Flags sort first but start COLLAPSED (day-9 declutter) — the
            count badge keeps them visible; paper still prints them all. */}
        {sections.map(([section, sectionRows], index) => (
          <details className="group" key={section} open={index === 0 && section !== 'Flags'}>
            <summary className="flex cursor-pointer items-center justify-between text-[11px] text-sidebar-foreground/80">
              <span className={section === 'Flags' ? 'font-medium text-amber-500/90' : 'font-medium'}>
                {section}
              </span>
              <span className="text-[10px] text-sidebar-foreground/40">{sectionRows.length}</span>
            </summary>
            <div className="mt-0.5 flex flex-col gap-0.5 pl-1">
              {sectionRows.map((row) => (
                <div
                  className="flex items-baseline justify-between gap-2 text-[11px]"
                  key={`${row.item}-${row.detail}`}
                  title={`${row.item} — ${row.detail}`}
                >
                  <span
                    className={`min-w-0 flex-1 text-sidebar-foreground/70 ${
                      section === 'Flags' ? 'whitespace-normal break-words' : 'truncate'
                    }`}
                  >
                    {row.item}
                    <span className="text-sidebar-foreground/40"> {row.detail}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-sidebar-foreground/90">
                    {row.quantity} {row.unit}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

/** Sidebar unit labels for the shared characteristics rows (CSV keeps ascii). */
const CHARACTERISTIC_UNIT: Record<string, string> = {
  m2: 'm²',
  m3: 'm³',
  count: '',
  IECC: '',
  'ft2·F·h/BTU': '',
  'W/K': 'W/K',
  W: 'W',
  tons: 'ton',
}

/**
 * Building characteristics — whole-building metrics (floor area, volume,
 * envelope UA, design loads) in a compact drop-down under the takeoff.
 * Helps dimension the HVAC; every number's assumption rides the footer.
 */
function CharacteristicsSection({
  result,
}: {
  result: NonNullable<ReturnType<typeof computeLevel>>
}) {
  const c = result.characteristics
  if (!c || result.members.length === 0) return null
  const rows = characteristicsRows(c)
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center justify-between font-medium text-xs">
        Building characteristics
        <button
          className="rounded-md border border-sidebar-border/60 px-2 py-0.5 font-normal text-[10px] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent"
          onClick={(e) => {
            // a click inside <summary> would also toggle the drawer
            e.preventDefault()
            e.stopPropagation()
            navigator.clipboard?.writeText(characteristicsCsv(c))
          }}
          type="button"
        >
          Copy CSV
        </button>
      </summary>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {rows.map((row) => {
          const unit = CHARACTERISTIC_UNIT[row.unit] ?? row.unit
          return (
            <div
              className="flex items-baseline justify-between gap-2 text-[11px]"
              key={row.metric}
              title={`${row.metric}: ${row.value} ${row.unit}`}
            >
              <span className="min-w-0 flex-1 truncate text-sidebar-foreground/70">
                {row.metric}
              </span>
              <span className="shrink-0 tabular-nums text-sidebar-foreground/90">
                {row.value}
                {unit ? ` ${unit}` : ''}
              </span>
            </div>
          )
        })}
        <p className="mt-1 text-[10px] text-sidebar-foreground/40 leading-relaxed">
          {c.notes.join(' · ')}
        </p>
      </div>
    </details>
  )
}

/** Loose lumber placement (v0.1) — the manual escape hatch + debug tool. */
function LumberSection() {
  const size = useBonesStore((s) => s.size)
  const length = useBonesStore((s) => s.length)
  const orientation = useBonesStore((s) => s.orientation)
  const activeTool = useEditor((s) => s.tool)
  const count = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === LUMBER_KIND).length,
  )
  const arming = activeTool === LUMBER_KIND

  const activate = (next: LumberSize) => {
    useBonesStore.getState().setSize(next)
    setPluginTool(LUMBER_KIND)
    useEditor.getState().setMode('build')
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center justify-between font-medium text-xs">
        Loose lumber
        <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-[10px] text-sidebar-foreground/60">
          {count}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[11px] text-sidebar-foreground/50">
          {arming ? 'Click the ground to place. Esc to stop.' : 'Pick a size, click the ground.'}
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {LUMBER_SIZES.map((s) => {
            const [t, w] = LUMBER_CROSS_SECTIONS[s]
            const selected = arming && s === size
            return (
              <button
                className={`rounded-md border px-1 py-1.5 text-xs transition-colors ${
                  selected
                    ? 'border-sidebar-ring bg-sidebar-accent text-sidebar-foreground'
                    : 'border-sidebar-border/60 bg-sidebar-accent/40 text-sidebar-foreground/80 hover:bg-sidebar-accent'
                }`}
                key={s}
                onClick={() => activate(s)}
                title={`Actual ${inchesLabel(t)} × ${inchesLabel(w)}`}
                type="button"
              >
                {s}
              </button>
            )
          })}
        </div>
        <SegmentedControl
          onChange={useBonesStore.getState().setOrientation}
          options={[
            { label: 'Stud', value: 'stud' },
            { label: 'Flat', value: 'flat' },
            { label: 'Edge', value: 'edge' },
          ]}
          value={orientation}
        />
        <SliderControl
          label="Length"
          max={7.4}
          min={0.1}
          onChange={useBonesStore.getState().setLength}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={length}
        />
      </div>
    </details>
  )
}

/**
 * 'Framing' row — LGS Phase 2, UI/UX principle 1b (the second of the two
 * controls total): ONE compact Lumber | Steel control, slotted between the
 * JurisdictionPicker (its code-basis peer — the framing system picks the
 * IRC chapter, R602 wood vs R603 steel) and the detail/spacing row.
 * PROGRESSIVE DISCLOSURE: the Machine select exists ONLY while Steel is
 * selected — lumber users see zero change. The select is the cited catalog
 * verbatim (grouped by vendor, verified rows first, unverified rows keep
 * their honest suffix); a machine CONSTRAINS + BRANDS (LGS-PLAN principle
 * 4) + WARNS on can't-roll resolutions — at the code LODs (300/400)
 * members are byte-identical with or without it (labels/flags/warnings
 * only); at 200 it narrows the generic pick to its thinnest rollable
 * variant (Phase-1 behavior). The engine's constraint channel carries the
 * truth to the Warnings drawer and the paper Flags block. Lumber and
 * 'None' writes REMOVE their keys, so untouched-equivalent scenes persist
 * byte-identically (Phase 0).
 */
/**
 * Roof system row — Stick (site-cut rafters + ceiling joists) or Truss
 * (pre-engineered gable trusses). Stick REMOVES the key, so an untouched
 * scene keeps persisting byte-identically (the framingSystem contract).
 */
function RoofRow({ framingNode }: { framingNode: FramingNode & { id: string } }) {
  const system = roofSystemValue(framingNode)
  const write = (patch: Record<string, unknown>) =>
    useScene
      .getState()
      .updateNode(framingNode.id as AnyNodeId, patch as Partial<AnyNode> as never)
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-sidebar-foreground/60">Roof</span>
      <SegmentedControl
        onChange={(v: string) => write(roofSystemPatch(v as RoofSystemValue))}
        options={[
          { label: 'Stick', value: 'stick' },
          { label: 'Truss', value: 'truss' },
        ]}
        value={system}
      />
      {system === 'truss' && (
        <span className="text-sidebar-foreground/50">
          Gable segments frame as trusses; webbing is representative — design by truss
          manufacturer (deferred submittal). Other shapes stay stick-framed and flag it.
        </span>
      )}
    </div>
  )
}

function FramingRow({ framingNode }: { framingNode: FramingNode & { id: string } }) {
  const system = framingSystemValue(framingNode)
  const write = (patch: Record<string, unknown>) =>
    useScene
      .getState()
      .updateNode(framingNode.id as AnyNodeId, patch as Partial<AnyNode> as never)
  const extra = lgsMachineSelectExtra(framingNode.lgsMachine)
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-sidebar-foreground/60">Framing</span>
      <SegmentedControl
        onChange={(v: string) => write(framingSystemPatch(v as FramingSystemValue))}
        options={[
          { label: 'Lumber', value: 'lumber' },
          { label: 'Steel', value: 'lgs' },
        ]}
        value={system}
      />
      {system === 'lgs' && (
        <>
          <span className="mt-1 text-sidebar-foreground/60">Machine</span>
          <select
            className="w-full rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-2 py-1.5 text-sidebar-foreground text-xs outline-none"
            onChange={(e) => write(lgsMachinePatch(e.target.value))}
            value={framingNode.lgsMachine ?? LGS_MACHINE_NONE}
          >
            <option value={LGS_MACHINE_NONE}>{LGS_MACHINE_NONE_LABEL}</option>
            {lgsMachineGroups().map((group) => (
              <optgroup key={group.vendor} label={group.vendor}>
                {group.machines.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {extra && <option value={extra.key}>{extra.label}</option>}
          </select>
        </>
      )}
    </div>
  )
}

/**
 * Searchable jurisdiction picker (round-14 quality feedback): 51 states +
 * Auto in a filter-as-you-type list instead of a bare <select>, with the
 * resolved code linked to the public ICC library.
 */
function JurisdictionPicker({
  framingNodeId,
  value,
  guess,
  options,
  codeName,
  notes,
}: {
  framingNodeId: AnyNodeId
  value: string
  guess: { code: string; reason: string } | null
  options: { code: string; name: string }[]
  codeName: string
  notes: string[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const pick = (code: string) => {
    useScene
      .getState()
      .updateNode(framingNodeId, { jurisdiction: code } as Partial<AnyNode> as never)
    setOpen(false)
    setQuery('')
  }
  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
    : options
  const current =
    value === 'AUTO'
      ? guess
        ? `Auto — ${guess.code}`
        : 'Auto'
      : (options.find((o) => o.code === value)?.name ?? value)
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-sidebar-foreground/60">Jurisdiction</span>
      <button
        type="button"
        className="flex items-center justify-between rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-2 py-1.5 text-left text-sidebar-foreground text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{current}</span>
        <span className="text-sidebar-foreground/40">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="flex max-h-56 flex-col overflow-hidden rounded-md border border-sidebar-border/60 bg-sidebar shadow-lg">
          <input
            autoFocus
            className="border-sidebar-border/40 border-b bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-sidebar-foreground/30"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search states…"
            value={query}
          />
          <div className="overflow-y-auto">
            <button
              type="button"
              className="block w-full px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent"
              onClick={() => pick('AUTO')}
            >
              {guess ? `Auto — ${guess.code} (${guess.reason})` : 'Auto'}
            </button>
            {filtered.map((o) => (
              <button
                key={o.code}
                type="button"
                className={`block w-full px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent ${o.code === value ? 'bg-sidebar-accent/60' : ''}`}
                onClick={() => pick(o.code)}
              >
                {o.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-sidebar-foreground/40 text-xs">No match</div>
            )}
          </div>
        </div>
      )}
      <a
        className="text-[10px] text-sidebar-foreground/40 underline-offset-2 hover:underline"
        href={`https://codes.iccsafe.org/search/titles?searchTermAny=${encodeURIComponent(
          // the ICC library drops ?query= — /search/titles?searchTermAny=
          // with the short code name is the form that returns results
          // (quality B2, verified live)
          codeName.split('(')[0]?.split('—')[0]?.trim().slice(0, 48) ?? codeName.slice(0, 48),
        )}`}
        rel="noreferrer"
        target="_blank"
      >
        {codeName} ↗
      </a>
      {/* The profile's researched notes — amendment flavor + the per-row
          frost/snow climate notes. This is the channel that carries the
          territories' PERMAFROST warning to the user (it lived only in the
          data file before 2026-08-24 — profileFor built the strings and
          nothing rendered them). Same muted style as the characteristics
          notes paragraph. */}
      {notes.length > 0 && (
        <p className="text-[10px] text-sidebar-foreground/40 leading-relaxed">
          {notes.join(' · ')}
        </p>
      )}
    </div>
  )
}

/**
 * "Save full plans" — the LOD 400 plan set as a printable document: one
 * SVG sheet per system (foundation / floor / wall / roof framing plans,
 * electrical rough-in, MEP) plus schedules + takeoff, paginated for the
 * browser's Print → Save as PDF. Pure client-side, nothing persisted.
 */
function ExportPlansButton({
  result,
  framingNode,
  activeLevelId,
  codeName,
}: {
  result: NonNullable<ReturnType<typeof computeLevel>>
  framingNode: FramingNode
  activeLevelId: AnyNodeId | null
  codeName?: string
}) {
  const levelName = useScene((s) =>
    activeLevelId ? ((s.nodes[activeLevelId] as { name?: string } | undefined)?.name ?? 'Level') : 'Level',
  )
  return (
    <button
      type="button"
      className="flex w-full flex-col items-center gap-0.5 rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.99]"
      onClick={() => {
        const sheets = buildPlanSet(result.members, result.fixtures, {
          projectName: document.title.split('—')[0]?.trim() || 'Pascal project',
          levelName,
          // resolved state code — raw 'AUTO' printed on sheets (quality C1)
          jurisdiction: result.jurisdiction,
          codeName,
          // heavy-snow header band (B11): the Table R602.7(1) width
          // assumption prints as a cover DESIGN CRITERIA line — unset in
          // low-snow jurisdictions (paper stays byte-equal)
          headerAssumption: result.spec.headerAssumption,
          date: new Date().toLocaleDateString(),
          // engine warnings print verbatim in the schedules flag block
          // (blueprint C5 / checklist P4) — paper never hides a caveat
          warnings: result.warnings,
          // whole-building metrics block on the schedules sheet
          characteristics: result.characteristics ?? undefined,
          studSpacingIn: framingNode.studSpacingIn,
          // the stamp must say what was actually composed (wave-2 audit:
          // a Generic export shipped paper claiming LOD 400)
          detail: framingNode.detail,
          // openings feed the door/window schedule sheet (B21d) — live
          // memo references, never mutated
          walls: result.walls,
          // gross-fallback areas so LOD-200 paper books the SAME takeoff
          // rows as the panel (C5 — one source of truth)
          areas: result.areas,
          // storey lifts RELATIVE to the owner level — owner members draw
          // level-local, so absolute elevations put an upper-storey owner's
          // roof a full storey too high on elevations/section (round-6)
          levelBaseY: relativeLevelBaseY(
            extractLevels(
              useScene.getState().nodes as Record<string, Record<string, unknown>>,
            ),
            activeLevelId,
          ),
        })
        if (sheets.length === 0) return
        const html = planSetHtml(sheets, { projectName: levelName, detail: framingNode.detail })
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        window.open(url, '_blank', 'noopener')
        // The tab owns the blob from here; revoke after it had time to load.
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }}
    >
      <span>📐 Blueprints</span>
    </button>
  )
}
