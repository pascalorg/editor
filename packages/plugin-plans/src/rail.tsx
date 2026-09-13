/**
 * The rail — project first, then the set, then the tools.
 *
 * Built from the editor's own panel pieces (PanelSection, ActionButton) and
 * its theme tokens, so it reads as Pascal's, not as a bolt-on. Nothing
 * technical up front: the service address and the run log live under
 * Settings → Advanced.
 */
import { ActionButton, PanelSection } from '@pascal-app/editor'
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, FileText, MapPin, Pencil, Printer, RefreshCw, Search, Sparkles, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useScene } from '@pascal-app/core'
import { type ProjectRecord, readProjectRecord, summarize, updateProject } from './project'
import { generatePlans, regenerateAll } from './run'
import { SitePlanControls } from './site-panel'
import { type Sheet, type StageLog, usePlans } from './store'

/* ------------------------------------------------------------ helpers */

export function useProjectRecord(): ProjectRecord {
  const [rec, setRec] = useState<ProjectRecord>(() => readProjectRecord())
  useEffect(() => {
    const unsub = (useScene as unknown as { subscribe: (fn: () => void) => () => void }).subscribe(() => setRec(readProjectRecord()))
    return unsub
  }, [])
  return rec
}

const DISCIPLINE: { prefix: RegExp; label: string }[] = [
  { prefix: /^A0/, label: 'General' },
  { prefix: /^A1/, label: 'Site' },
  { prefix: /^A[2-3]/, label: 'Plans' },
  { prefix: /^A[4-5]/, label: 'Elevations & sections' },
  { prefix: /^A[6-9]/, label: 'Details & schedules' },
  { prefix: /^S/, label: 'Structural' },
  { prefix: /^E/, label: 'Electrical' },
  { prefix: /^P/, label: 'Plumbing' },
  { prefix: /^M/, label: 'Mechanical' },
  { prefix: /^R/, label: 'Renderings' },
  { prefix: /^C/, label: 'Construction' },
]
function groupSheets(sheets: Sheet[]): { label: string; sheets: { sheet: Sheet; index: number }[] }[] {
  const groups = new Map<string, { sheet: Sheet; index: number }[]>()
  sheets.forEach((sheet, index) => {
    const d = DISCIPLINE.find((x) => x.prefix.test(sheet.number))?.label ?? (sheet.number.startsWith('EN') ? 'Energy' : 'Other')
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push({ sheet, index })
  })
  return [...groups.entries()].map(([label, sheets]) => ({ label, sheets }))
}

const input = 'w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-foreground text-xs placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none'
const label = 'flex flex-col gap-1 text-[11px] text-muted-foreground'

/* ----------------------------------------------------------- project */

export function ProjectCard({ onEdit }: { onEdit: () => void }) {
  const rec = useProjectRecord()
  const sum = summarize(rec)
  const S = usePlans()
  const complete = sum.missing.length === 0
  return (
    <div className="border-border/50 border-b p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Building2 className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground text-sm">{sum.name || 'Untitled project'}</div>
          <div className="mt-0.5 flex items-start gap-1 text-muted-foreground text-xs">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="truncate">{sum.address || 'No address yet — add one to find the parcel'}</span>
          </div>
        </div>
        <button type="button" onClick={onEdit} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit project">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {sum.apn && <Chip>APN {sum.apn}</Chip>}
        {sum.jurisdiction && <Chip>{sum.jurisdiction}</Chip>}
        {sum.firm || sum.designer ? <Chip>{sum.firm ?? sum.designer}</Chip> : null}
        <Chip tone={complete ? 'ok' : 'warn'}>{complete ? 'Title block complete' : `Missing ${sum.missing.join(', ')}`}</Chip>
        {S.draft?.watermarked && <Chip tone="warn">DRAFT — not for construction</Chip>}
      </div>
    </div>
  )
}

export function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'bg-emerald-500/15 text-emerald-500' : tone === 'warn' ? 'bg-amber-500/15 text-amber-500' : tone === 'bad' ? 'bg-destructive/15 text-destructive' : 'bg-accent text-muted-foreground'
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>
}

/** The record editor — everything the title block and the checks read. */
export function ProjectEditor({ onClose }: { onClose: () => void }) {
  const rec = useProjectRecord()
  const [d, setD] = useState<ProjectRecord>(rec)
  useEffect(() => setD(rec), [rec])
  const id = d.identity ?? {}
  const a = id.address ?? {}
  const firm = d.firms?.designer ?? {}
  const eng = d.firms?.engineer ?? {}
  const j = d.jurisdiction ?? {}
  const set = (patch: ProjectRecord) => setD((prev) => ({ ...prev, ...patch }))
  const setId = (patch: NonNullable<ProjectRecord['identity']>) => set({ identity: { ...id, ...patch } })
  const setAddr = (patch: typeof a) => setId({ address: { ...a, ...patch } })
  const setFirm = (patch: typeof firm) => set({ firms: { ...(d.firms ?? {}), designer: { ...firm, ...patch } } })
  const setEng = (patch: typeof eng) => set({ firms: { ...(d.firms ?? {}), engineer: { ...eng, ...patch } } })
  const setJ = (patch: typeof j) => set({ jurisdiction: { ...j, ...patch } })
  const save = async () => {
    updateProject(d)
    onClose()
    if (usePlans.getState().sheets.length > 0) await regenerateAll()
  }
  const S = usePlans()
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <FileText className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Project</span>
        <span className="ml-auto text-[11px] text-muted-foreground">saved in the scene</span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <Group title="Project">
          <label className={label}>Project name<input className={input} value={id.projectName ?? ''} onChange={(e) => setId({ projectName: e.target.value })} placeholder="Smith Residence ADU" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Project no.<input className={input} value={id.projectNumber ?? ''} onChange={(e) => setId({ projectNumber: e.target.value })} /></label>
            <label className={label}>APN<input className={input} value={id.apn ?? ''} onChange={(e) => setId({ apn: e.target.value })} placeholder="from the parcel lookup" /></label>
          </div>
          <label className={label}>Status
            <select className={input} value={d.documentStatus ?? 'preliminary'} onChange={(e) => set({ documentStatus: e.target.value as ProjectRecord['documentStatus'] })}>
              <option value="preliminary">Preliminary</option>
              <option value="permit-set">Permit set</option>
              <option value="construction-set">Construction set</option>
            </select>
          </label>
        </Group>
        <Group title="Site address">
          <label className={label}>Street<input className={input} value={a.street ?? ''} onChange={(e) => setAddr({ street: e.target.value })} placeholder="4040 Minnesota Ave" /></label>
          <div className="grid grid-cols-[1fr_64px_84px] gap-2">
            <label className={label}>City<input className={input} value={a.city ?? ''} onChange={(e) => setAddr({ city: e.target.value })} /></label>
            <label className={label}>State<input className={input} value={a.state ?? ''} onChange={(e) => setAddr({ state: e.target.value })} placeholder="CA" /></label>
            <label className={label}>ZIP<input className={input} value={a.zip ?? ''} onChange={(e) => setAddr({ zip: e.target.value })} /></label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className={label}>Jurisdiction city<input className={input} value={j.city ?? ''} onChange={(e) => setJ({ city: e.target.value })} /></label>
            <label className={label}>County<input className={input} value={j.county ?? ''} onChange={(e) => setJ({ county: e.target.value })} /></label>
            <label className={label}>State<input className={input} value={j.state ?? ''} onChange={(e) => setJ({ state: e.target.value })} /></label>
          </div>
        </Group>
        <Group title="Designer (title block)">
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Designer<input className={input} value={id.designer?.name ?? ''} onChange={(e) => setId({ designer: { ...(id.designer ?? {}), name: e.target.value } })} placeholder="Your name" /></label>
            <label className={label}>License<input className={input} value={id.designer?.license ?? ''} onChange={(e) => setId({ designer: { ...(id.designer ?? {}), license: e.target.value } })} /></label>
          </div>
          <label className={label}>Firm<input className={input} value={firm.company ?? ''} onChange={(e) => setFirm({ company: e.target.value })} placeholder="Your studio — replaces the placeholder on every sheet" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Phone<input className={input} value={firm.phone ?? ''} onChange={(e) => setFirm({ phone: e.target.value })} /></label>
            <label className={label}>Email<input className={input} value={firm.email ?? ''} onChange={(e) => setFirm({ email: e.target.value })} /></label>
          </div>
        </Group>
        <Group title="Owner">
          <label className={label}>Owner<input className={input} value={id.owner?.name ?? ''} onChange={(e) => setId({ owner: { ...(id.owner ?? {}), name: e.target.value } })} /></label>
        </Group>
        <Group title="Engineer of record (optional)">
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Firm<input className={input} value={eng.company ?? ''} onChange={(e) => setEng({ company: e.target.value })} /></label>
            <label className={label}>License<input className={input} value={eng.license ?? ''} onChange={(e) => setEng({ license: e.target.value })} /></label>
          </div>
        </Group>
      </div>
      <div className="flex gap-2 border-border border-t p-3">
        <button type="button" onClick={onClose} className="flex-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent">Cancel</button>
        <button type="button" onClick={() => void save()} className="flex-1 rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs">
          {S.sheets.length ? 'Save & redraw sheets' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{title}</div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------- sheets */

export function SheetList() {
  const S = usePlans()
  if (!S.sheets.length) return null
  return (
    <div className="flex flex-col gap-2">
      {groupSheets(S.sheets).map((g) => (
        <div key={g.label}>
          <div className="mb-0.5 px-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{g.label}</div>
          <ol>
            {g.sheets.map(({ sheet, index }) => {
              const live = !!sheet.manifest?.site && sheet.manifest.site.footprint.length >= 3
              const busy = S.rendering.includes(sheet.number)
              return (
                <li key={sheet.id}>
                  <button type="button" onClick={() => S.setCurrent(index)} className={`group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${index === S.current ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent/60'}`}>
                    <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">{sheet.number}</span>
                    <span className="truncate">{sheet.title}</span>
                    {live && <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 text-[9px] text-primary">live</span>}
                    {busy && <RefreshCw className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      {S.skipped.length > 0 && (
        <div>
          <div className="mb-0.5 px-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Not in this set</div>
          {S.skipped.map((k) => (
            <div key={k.id} className="px-2 py-1 text-[11px] text-muted-foreground" title={k.reason}>
              <span className="text-amber-500">{k.id}</span> — {k.reason.length > 90 ? `${k.reason.slice(0, 90)}…` : k.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- settings */

export function SettingsSection() {
  const S = usePlans()
  const st = S.settings
  const Toggle = ({ k, text }: { k: keyof typeof st; text: string }) => (
    <label className="flex cursor-pointer items-center justify-between py-0.5 text-xs">
      <span>{text}</span>
      <button type="button" role="switch" aria-checked={!!st[k]} onClick={() => S.setSettings({ [k]: !st[k] } as never)} className={`relative h-5 w-9 rounded-full transition-colors ${st[k] ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${st[k] ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Toggle k="elevations" text="Exterior elevations (A4.0)" />
      <Toggle k="sections" text="Building sections (A5.0)" />
      <Toggle k="energySheet" text="Energy compliance sheet" />
      <Toggle k="coverFromView" text="3D view on the cover" />
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className={label}>Date on sheets<input className={input} value={st.date} placeholder="today" onChange={(e) => S.setSettings({ date: e.target.value })} /></label>
        <label className={label}>Drawn by<input className={input} value={st.drawnBy} placeholder="designer" onChange={(e) => S.setSettings({ drawnBy: e.target.value })} /></label>
      </div>
      <p className="text-[10px] text-muted-foreground">Changes apply on the next Regenerate.</p>
    </div>
  )
}

export function AdvancedSection() {
  const S = usePlans()
  return (
    <div className="flex flex-col gap-2">
      <label className={label}>Plans service<input className={`${input} font-mono`} value={S.apiBase} onChange={(e) => S.setApiBase(e.target.value)} /></label>
      <Stages stages={S.stages} />
    </div>
  )
}

const DOT: Record<StageLog['status'], string> = {
  pending: 'bg-muted-foreground/30',
  running: 'bg-primary animate-pulse',
  ok: 'bg-emerald-500',
  skipped: 'bg-muted-foreground/60',
  failed: 'bg-destructive',
}
export function Stages({ stages }: { stages: StageLog[] }) {
  if (!stages.length) return <p className="text-[11px] text-muted-foreground">No run yet.</p>
  return (
    <ol className="flex flex-col gap-1">
      {stages.map((s) => (
        <li key={s.id} className="text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.status]}`} />
            <span className={s.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{s.label}</span>
            {s.detail && <span className="ml-auto truncate text-muted-foreground">{s.detail}</span>}
          </div>
          {s.lines?.map((l, i) => (
            <div key={i} className={`pl-3.5 ${/^(✗|not shipped|draft)/.test(l) ? 'text-amber-500' : 'text-muted-foreground/80'}`}>{l}</div>
          ))}
        </li>
      ))}
    </ol>
  )
}

/* ---------------------------------------------------------------- rail */

export function Rail({ onEditProject, onPrint }: { onEditProject: () => void; onPrint: () => void }) {
  const S = usePlans()
  const rec = useProjectRecord()
  const hasAddress = !!rec.identity?.address?.street
  const current = S.sheets[S.current]
  const running = S.run === 'running'
  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-border border-r bg-card">
      <ProjectCard onEdit={onEditProject} />
      <div className="flex gap-1.5 border-border/50 border-b p-3">
        <ActionButton icon={running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : S.sheets.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} label={running ? 'Generating…' : S.sheets.length ? 'Regenerate' : 'Generate plans'} disabled={running} onClick={() => void generatePlans()} className="bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/90" />
        <ActionButton icon={<Printer className="h-3.5 w-3.5" />} label="Print / PDF" disabled={!S.sheets.length} onClick={onPrint} />
      </div>
      {!hasAddress && (
        <button type="button" onClick={onEditProject} className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-primary/40 border-dashed bg-primary/5 px-3 py-2 text-left text-xs hover:bg-primary/10">
          <Search className="h-3.5 w-3.5 text-primary" />
          <span><span className="font-medium text-foreground">Add the site address</span><br /><span className="text-muted-foreground">to find the parcel and draw the site plan from the record</span></span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
      {S.run === 'failed' && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="text-foreground">{S.error}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title={`Sheets${S.sheets.length ? ` · ${S.sheets.length}` : ''}`} defaultExpanded>
          {S.sheets.length ? <SheetList /> : <p className="text-[11px] text-muted-foreground">Generate plans to build the set from the open scene.</p>}
        </PanelSection>
        <PanelSection title="Site plan" defaultExpanded={current?.number === 'A1.0'}>
          <SitePlanControls compact />
        </PanelSection>
        <PanelSection title="Settings" defaultExpanded={false}>
          <SettingsSection />
        </PanelSection>
        <PanelSection title="Advanced" defaultExpanded={false}>
          <AdvancedSection />
        </PanelSection>
      </div>
      {S.warnings.length > 0 && (
        <button type="button" onClick={() => S.setShowWarnings(!S.showWarnings)} className="flex items-center gap-2 border-border border-t px-3 py-2 text-left text-xs hover:bg-accent/40">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          <span>{S.warnings.length} note{S.warnings.length === 1 ? '' : 's'} from the engine</span>
          <ChevronRight className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${S.showWarnings ? 'rotate-90' : ''}`} />
        </button>
      )}
      {S.run === 'done' && S.warnings.length === 0 && (
        <div className="flex items-center gap-2 border-border border-t px-3 py-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />No notes from the engine</div>
      )}
    </aside>
  )
}
