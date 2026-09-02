'use client'

/**
 * The rail — project first, then the set, then the tools.
 *
 * Built from the editor's own panel pieces and theme tokens so it reads as
 * Pascal's. Nothing technical up front: the project card carries the name,
 * the address, the APN and the firm as chips, and the pencil opens the
 * record editor.
 */
import { useScene } from '@pascal-app/core'
import { ActionButton, PanelSection } from '@pascal-app/editor'
import {
  Building2,
  Camera,
  ChevronDown,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { captureViewportImage } from './capture'
import { generateDefaultSet } from './generate'
import {
  addSheet,
  addViewport,
  levelLabel,
  levels,
  projectRecord,
  readOrCreateProjectRecord,
  removeSheet,
  removeViewport,
  sceneNodes,
  sheets,
  siteAddress,
  updateProjectRecord,
  updateViewport,
  viewports,
  type NodeMap,
} from './model'
import { printSet } from './print'
import { PAPER_SIZES, SCALE_PRESETS, scaleLabel } from './scale'
import {
  DEFAULT_VIEWPORT_LAYERS,
  type ProjectRecordNode,
  type SheetNode,
  type ViewportKind,
  type ViewportLayers,
  type ViewportNode,
} from './schema'
import { useSheets } from './store'
import { sheetFrame } from './titleblock'

/* ---------------------------------------------------------- plumbing */

/** Re-read the scene on every mutation; the scene is the document. */
export function useSceneNodes(): NodeMap {
  const [nodes, setNodes] = useState<NodeMap>(() => sceneNodes())
  useEffect(() => {
    const store = useScene as unknown as { subscribe: (fn: () => void) => () => void }
    return store.subscribe(() => setNodes(sceneNodes()))
  }, [])
  return nodes
}

const input =
  'w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-foreground text-xs placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none'
const labelCls = 'flex flex-col gap-1 text-[11px] text-muted-foreground'

export function Chip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'ok' | 'warn'
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-500/15 text-emerald-500'
      : tone === 'warn'
        ? 'bg-amber-500/15 text-amber-500'
        : 'bg-accent text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] ${cls}`}>
      {children}
    </span>
  )
}

/* ----------------------------------------------------------- project */

export function ProjectCard({ nodes, onEdit }: { nodes: NodeMap; onEdit: () => void }) {
  const record = projectRecord(nodes)
  const fallback = siteAddress(nodes)
  const street = record?.identity?.address?.street || fallback.street
  const city = record?.identity?.address?.city || fallback.city
  const apn = record?.identity?.apn || fallback.apn
  const jurisdiction = [record?.jurisdiction?.city, record?.jurisdiction?.state]
    .filter(Boolean)
    .join(', ')
  const missing: string[] = []
  if (!record?.identity?.projectName) missing.push('project name')
  if (!street) missing.push('address')
  if (!record?.designer?.name && !record?.firm?.company) missing.push('designer')
  if (!record?.owner?.name) missing.push('owner')

  return (
    <div className="border-border/50 border-b p-3">
      <div className="flex items-start gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground text-sm">
            {record?.identity?.projectName || 'Untitled project'}
          </div>
          <div className="mt-0.5 flex items-start gap-1 text-muted-foreground text-xs">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="truncate">
              {[street, city].filter(Boolean).join(', ') || 'No address yet'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Edit project"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {apn && <Chip>APN {apn}</Chip>}
        {jurisdiction && <Chip>{jurisdiction}</Chip>}
        {(record?.firm?.company || record?.designer?.name) && (
          <Chip>{record?.firm?.company || record?.designer?.name}</Chip>
        )}
        <Chip tone={missing.length === 0 ? 'ok' : 'warn'}>
          {missing.length === 0 ? 'Title block complete' : `Missing ${missing.join(', ')}`}
        </Chip>
      </div>
    </div>
  )
}

export function ProjectEditor({ nodes, onClose }: { nodes: NodeMap; onClose: () => void }) {
  const stored = projectRecord(nodes)
  const [draft, setDraft] = useState<ProjectRecordNode | undefined>(stored)
  useEffect(() => {
    if (!stored) readOrCreateProjectRecord()
    else setDraft(stored)
  }, [stored])
  if (!draft) return null

  const id = draft.identity
  const address = id.address
  const patch = (value: Partial<ProjectRecordNode>) =>
    setDraft((prev) => (prev ? { ...prev, ...value } : prev))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <Building2 className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Project</span>
        <span className="ml-auto text-[11px] text-muted-foreground">saved in the scene</span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <Group title="Project">
          <label className={labelCls}>
            Project name
            <input
              className={input}
              value={id.projectName}
              onChange={(e) => patch({ identity: { ...id, projectName: e.target.value } })}
              placeholder="Smith Residence ADU"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              Project no.
              <input
                className={input}
                value={id.projectNumber}
                onChange={(e) => patch({ identity: { ...id, projectNumber: e.target.value } })}
              />
            </label>
            <label className={labelCls}>
              APN
              <input
                className={input}
                value={id.apn}
                onChange={(e) => patch({ identity: { ...id, apn: e.target.value } })}
              />
            </label>
          </div>
          <label className={labelCls}>
            Status
            <select
              className={input}
              value={draft.documentStatus}
              onChange={(e) =>
                patch({ documentStatus: e.target.value as ProjectRecordNode['documentStatus'] })
              }
            >
              <option value="preliminary">Preliminary</option>
              <option value="permit-set">Permit set</option>
              <option value="construction-set">Construction set</option>
            </select>
          </label>
        </Group>

        <Group title="Site address">
          <label className={labelCls}>
            Street
            <input
              className={input}
              value={address.street}
              onChange={(e) =>
                patch({ identity: { ...id, address: { ...address, street: e.target.value } } })
              }
            />
          </label>
          <div className="grid grid-cols-[1fr_64px_84px] gap-2">
            <label className={labelCls}>
              City
              <input
                className={input}
                value={address.city}
                onChange={(e) =>
                  patch({ identity: { ...id, address: { ...address, city: e.target.value } } })
                }
              />
            </label>
            <label className={labelCls}>
              State
              <input
                className={input}
                value={address.state}
                onChange={(e) =>
                  patch({ identity: { ...id, address: { ...address, state: e.target.value } } })
                }
              />
            </label>
            <label className={labelCls}>
              ZIP
              <input
                className={input}
                value={address.zip}
                onChange={(e) =>
                  patch({ identity: { ...id, address: { ...address, zip: e.target.value } } })
                }
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['city', 'county', 'state'] as const).map((key) => (
              <label className={labelCls} key={key}>
                {key === 'city' ? 'Jurisdiction' : key}
                <input
                  className={input}
                  value={draft.jurisdiction[key]}
                  onChange={(e) =>
                    patch({ jurisdiction: { ...draft.jurisdiction, [key]: e.target.value } })
                  }
                />
              </label>
            ))}
          </div>
        </Group>

        <Group title="Designer (title block)">
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              Designer
              <input
                className={input}
                value={draft.designer.name}
                onChange={(e) => patch({ designer: { ...draft.designer, name: e.target.value } })}
              />
            </label>
            <label className={labelCls}>
              License
              <input
                className={input}
                value={draft.designer.license}
                onChange={(e) =>
                  patch({ designer: { ...draft.designer, license: e.target.value } })
                }
              />
            </label>
          </div>
          <label className={labelCls}>
            Firm
            <input
              className={input}
              value={draft.firm.company}
              onChange={(e) => patch({ firm: { ...draft.firm, company: e.target.value } })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              Phone
              <input
                className={input}
                value={draft.firm.phone}
                onChange={(e) => patch({ firm: { ...draft.firm, phone: e.target.value } })}
              />
            </label>
            <label className={labelCls}>
              Email
              <input
                className={input}
                value={draft.firm.email}
                onChange={(e) => patch({ firm: { ...draft.firm, email: e.target.value } })}
              />
            </label>
          </div>
        </Group>

        <Group title="Owner & engineer">
          <label className={labelCls}>
            Owner
            <input
              className={input}
              value={draft.owner.name}
              onChange={(e) => patch({ owner: { name: e.target.value } })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              Engineer firm
              <input
                className={input}
                value={draft.engineer.company}
                onChange={(e) =>
                  patch({ engineer: { ...draft.engineer, company: e.target.value } })
                }
              />
            </label>
            <label className={labelCls}>
              License
              <input
                className={input}
                value={draft.engineer.license}
                onChange={(e) =>
                  patch({ engineer: { ...draft.engineer, license: e.target.value } })
                }
              />
            </label>
          </div>
        </Group>

        <Group title="Issue">
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>
              Date
              <input
                className={input}
                value={draft.date}
                placeholder="2026-09-02"
                onChange={(e) => patch({ date: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Drawn by
              <input
                className={input}
                value={draft.drawnBy}
                onChange={(e) => patch({ drawnBy: e.target.value })}
              />
            </label>
          </div>
          <RevisionEditor
            revisions={draft.revisions}
            onChange={(revisions) => patch({ revisions })}
          />
        </Group>
      </div>
      <div className="flex gap-2 border-border border-t p-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            updateProjectRecord({
              identity: draft.identity,
              designer: draft.designer,
              firm: draft.firm,
              owner: draft.owner,
              engineer: draft.engineer,
              jurisdiction: draft.jurisdiction,
              documentStatus: draft.documentStatus,
              revisions: draft.revisions,
              date: draft.date,
              drawnBy: draft.drawnBy,
            })
            onClose()
          }}
          className="flex-1 rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function RevisionEditor({
  revisions,
  onChange,
}: {
  revisions: ProjectRecordNode['revisions']
  onChange: (value: ProjectRecordNode['revisions']) => void
}) {
  return (
    <div className="space-y-1">
      {revisions.map((rev, i) => (
        <div className="grid grid-cols-[38px_1fr_74px_24px] gap-1" key={i}>
          {(['id', 'description', 'date'] as const).map((key) => (
            <input
              key={key}
              className={input}
              value={rev[key]}
              placeholder={key}
              onChange={(e) => {
                const next = revisions.slice()
                next[i] = { ...rev, [key]: e.target.value }
                onChange(next)
              }}
            />
          ))}
          <button
            type="button"
            className="rounded-md text-muted-foreground hover:text-destructive"
            onClick={() => onChange(revisions.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="w-full rounded-md border border-border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
        onClick={() =>
          onChange([
            ...revisions,
            { id: String(revisions.length + 1), date: '', description: '', by: '' },
          ])
        }
      >
        + Revision
      </button>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------ sheets */

const DISCIPLINES: { test: RegExp; label: string }[] = [
  { test: /^A0/, label: 'General' },
  { test: /^A1/, label: 'Site' },
  { test: /^A[23]/, label: 'Plans' },
  { test: /^A[45]/, label: 'Elevations & sections' },
  { test: /^A[6-9]/, label: 'Details & schedules' },
  { test: /^S/, label: 'Structural' },
  { test: /^E/, label: 'Electrical' },
  { test: /^P/, label: 'Plumbing' },
  { test: /^M/, label: 'Mechanical' },
  { test: /^R/, label: 'Renderings' },
]

export function groupSheets(list: SheetNode[]): { label: string; sheets: SheetNode[] }[] {
  const groups = new Map<string, SheetNode[]>()
  for (const sheet of list) {
    const label = DISCIPLINES.find((d) => d.test.test(sheet.number))?.label ?? 'Other'
    const bucket = groups.get(label)
    if (bucket) bucket.push(sheet)
    else groups.set(label, [sheet])
  }
  return [...groups.entries()].map(([label, sheets]) => ({ label, sheets }))
}

const VIEWPORT_KINDS: { kind: ViewportKind; label: string }[] = [
  { kind: 'plan', label: 'Floor plan' },
  { kind: 'site-plan', label: 'Site plan' },
  { kind: 'elevation', label: 'Elevation' },
  { kind: 'section', label: 'Section' },
  { kind: 'view3d', label: '3D view' },
  { kind: 'schedule', label: 'Schedule' },
  { kind: 'notes', label: 'Notes' },
]

export function Rail({ nodes }: { nodes: NodeMap }) {
  const S = useSheets()
  const list = sheets(nodes)
  const current = S.sheetId ? (nodes[S.sheetId] as SheetNode | undefined) : undefined
  const selected = S.selectedViewportId
    ? (nodes[S.selectedViewportId] as ViewportNode | undefined)
    : undefined
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    if (!S.sheetId && list.length > 0) S.setSheet(list[0]?.id ?? null)
  }, [S, list])

  const run = async (label: string, job: () => Promise<string> | string) => {
    S.setBusy({ label })
    try {
      S.setMessage(await job())
    } catch (error) {
      S.setMessage(`${label} failed: ${(error as Error).message}`)
    } finally {
      S.setBusy(null)
    }
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-border border-r bg-card">
      <ProjectCard nodes={nodes} onEdit={() => S.setEditingProject(true)} />

      <div className="flex gap-1 border-border/50 border-b px-2 py-1.5">
        {(['sheets', 'layers', 'settings'] as const).map((panel) => (
          <button
            type="button"
            key={panel}
            onClick={() => S.setPanel(panel)}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] capitalize ${
              S.panel === panel ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {panel}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {S.panel === 'sheets' && (
          <div className="space-y-3">
            {list.length === 0 && (
              <p className="px-1 py-4 text-center text-muted-foreground text-xs">
                No sheets yet. Generate the default set, or add one.
              </p>
            )}
            {groupSheets(list).map((group) => (
              <PanelSection key={group.label} title={group.label}>
                <div className="space-y-0.5">
                  {group.sheets.map((sheet) => (
                    <div
                      key={sheet.id}
                      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                        sheet.id === S.sheetId
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50'
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => S.setSheet(sheet.id)}
                      >
                        <span className="w-11 shrink-0 font-mono text-[11px]">{sheet.number}</span>
                        <span className="truncate">{sheet.title}</span>
                      </button>
                      <button
                        type="button"
                        title="Delete sheet"
                        className="opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                        onClick={() => {
                          removeSheet(sheet.id)
                          if (S.sheetId === sheet.id) S.setSheet(null)
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </PanelSection>
            ))}
          </div>
        )}

        {S.panel === 'layers' && (
          <LayersPanel
            viewport={selected}
            nodes={nodes}
            onCapture={() =>
              selected &&
              void run('Capturing the view', async () => {
                const result = await captureViewportImage(selected)
                return result.ok ? 'captured' : result.reason
              })
            }
          />
        )}

        {S.panel === 'settings' && <SettingsPanel sheet={current} />}
      </div>

      {S.panel === 'sheets' && (
        <div className="space-y-1 border-border border-t p-2">
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Sheet"
                onClick={() => {
                  const sheet = addSheet({
                    number: nextSheetNumber(list),
                    title: 'New sheet',
                    order: list.length,
                  })
                  S.setSheet(sheet.id)
                }}
              />
              <div className="relative">
                <ActionButton
                  icon={<ChevronDown className="h-3.5 w-3.5" />}
                  label="Viewport"
                  disabled={!current}
                  onClick={() => setAddOpen((v) => !v)}
                />
                {addOpen && current && (
                  <div className="absolute bottom-full z-10 mb-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                    {VIEWPORT_KINDS.map((entry) => (
                      <button
                        type="button"
                        key={entry.kind}
                        className="block w-full px-2 py-1.5 text-left text-xs hover:bg-accent"
                        onClick={() => {
                          setAddOpen(false)
                          const created = addViewport({
                            sheetId: current.id,
                            kind: entry.kind,
                            ...defaultPlacement(current, nodes, entry.kind),
                          })
                          S.select(created.id)
                        }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <ActionButton
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Generate default set"
                onClick={() =>
                  void run('Generating the default set', () => {
                    const result = generateDefaultSet(sceneNodes())
                    const parts: string[] = []
                    if (result.created.length) parts.push(`created ${result.created.join(', ')}`)
                    if (result.skipped.length) parts.push(`kept ${result.skipped.join(', ')}`)
                    return parts.join(' · ') || 'nothing to do'
                  })
                }
              />
              <ActionButton
                icon={<Printer className="h-3.5 w-3.5" />}
                label="Print / PDF"
                onClick={() =>
                  void run('Writing the PDF', async () => {
                    const result = await printSet()
                    return result.ok ? `${result.sheets} sheets written` : result.reason
                  })
                }
              />
        </div>
      )}

      {S.busy && (
        <div className="border-border border-t px-3 py-2 text-[11px] text-muted-foreground">
          {S.busy.label}…
        </div>
      )}
      {!S.busy && S.message && (
        <div className="border-border border-t px-3 py-2 text-[11px] text-muted-foreground">
          {S.message}
        </div>
      )}
    </aside>
  )
}

export function nextSheetNumber(list: SheetNode[]): string {
  const used = new Set(list.map((s) => s.number))
  for (let i = 0; i < 40; i++) {
    const candidate = `A9.${i}`
    if (!used.has(candidate)) return candidate
  }
  return `A9.${list.length}`
}

function defaultPlacement(
  sheet: SheetNode,
  nodes: NodeMap,
  kind: ViewportKind,
): Partial<ViewportNode> {
  const paper = PAPER_SIZES[sheet.size] ?? PAPER_SIZES['arch-d']
  const frame = sheetFrame(paper.widthIn, paper.heightIn)
  const existing = viewports(nodes, sheet.id).length
  const level = levels(nodes)[0]
  return {
    x: frame.x + 0.4 * existing,
    y: frame.y + 0.4 + 0.4 * existing,
    w: Math.min(frame.w, 14),
    h: Math.min(frame.h - 1, 10),
    levelId: kind === 'plan' || kind === 'schedule' ? level?.id : undefined,
    drawingType: kind === 'plan' ? 'floor-plan' : undefined,
    direction: kind === 'elevation' ? 'north' : undefined,
    scheduleOf: kind === 'schedule' ? 'doors' : undefined,
    pose: kind === 'view3d' ? 'cover-front' : undefined,
    scale: kind === 'site-plan' ? 240 : 48,
    layers: { ...DEFAULT_VIEWPORT_LAYERS },
  }
}

/* ------------------------------------------------------------ layers */

const LAYER_ROWS: { key: keyof ViewportLayers; label: string }[] = [
  { key: 'automaticDimensions', label: 'Automatic dimensions' },
  { key: 'manualDimensions', label: 'Manual dimensions' },
  { key: 'contextualDimensions', label: 'Contextual dimensions' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'openingMarks', label: 'Door & window marks' },
  { key: 'structuralGrids', label: 'Structural grids' },
  { key: 'roomLabels', label: 'Room labels' },
  { key: 'stairAnnotations', label: 'Stair annotations' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'mep', label: 'MEP distribution' },
  { key: 'framing', label: 'Framing (Bones)' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'siteUtilities', label: 'Site utilities' },
  { key: 'terrain', label: 'Terrain & scans' },
]

function LayersPanel({
  viewport,
  nodes,
  onCapture,
}: {
  viewport: ViewportNode | undefined
  nodes: NodeMap
  onCapture: () => void
}) {
  if (!viewport) {
    return (
      <p className="px-1 py-4 text-center text-muted-foreground text-xs">
        Select a viewport on the paper.
      </p>
    )
  }
  const set = (patch: Partial<ViewportNode>) => updateViewport(viewport.id, patch)
  return (
    <div className="space-y-3">
      <PanelSection title="Viewport">
        <label className={labelCls}>
          Title
          <input
            className={input}
            value={viewport.title}
            placeholder="auto"
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        {(viewport.kind === 'plan' || viewport.kind === 'schedule') && (
          <label className={labelCls}>
            Level
            <select
              className={input}
              value={viewport.levelId ?? ''}
              onChange={(e) => set({ levelId: e.target.value })}
            >
              {levels(nodes).map((level) => (
                <option key={level.id} value={level.id}>
                  {levelLabel(level)}
                </option>
              ))}
            </select>
          </label>
        )}
        {viewport.kind === 'plan' && (
          <label className={labelCls}>
            Drawing type
            <select
              className={input}
              value={viewport.drawingType ?? 'floor-plan'}
              onChange={(e) => set({ drawingType: e.target.value })}
            >
              {['floor-plan', 'foundation-plan', 'reflected-ceiling-plan', 'roof-plan'].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        )}
        {viewport.kind === 'elevation' && (
          <label className={labelCls}>
            Direction
            <select
              className={input}
              value={viewport.direction ?? 'north'}
              onChange={(e) => set({ direction: e.target.value as ViewportNode['direction'] })}
            >
              {['north', 'east', 'south', 'west'].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {viewport.kind === 'schedule' && (
          <label className={labelCls}>
            Table
            <select
              className={input}
              value={viewport.scheduleOf ?? 'doors'}
              onChange={(e) => set({ scheduleOf: e.target.value as ViewportNode['scheduleOf'] })}
            >
              <option value="doors">Doors</option>
              <option value="windows">Windows</option>
              <option value="rooms">Rooms</option>
            </select>
          </label>
        )}
        {viewport.kind === 'notes' && (
          <label className={labelCls}>
            Text
            <textarea
              className={`${input} h-32 resize-y`}
              value={viewport.text}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
        )}
        {viewport.kind === 'view3d' && (
          <ActionButton
            icon={<Camera className="h-3.5 w-3.5" />}
            label={viewport.dataUrl ? 'Recapture standard view' : 'Capture standard view'}
            onClick={onCapture}
          />
        )}
        {viewport.kind !== 'schedule' &&
          viewport.kind !== 'notes' &&
          viewport.kind !== 'view3d' && (
            <label className={labelCls}>
              Scale
              <select
                className={input}
                value={viewport.scale}
                onChange={(e) => set({ scale: Number(e.target.value) })}
              >
                {SCALE_PRESETS.map((preset) => (
                  <option key={preset.scale} value={preset.scale}>
                    {preset.label}
                  </option>
                ))}
                {!SCALE_PRESETS.some((p) => p.scale === viewport.scale) && (
                  <option value={viewport.scale}>{scaleLabel(viewport.scale)}</option>
                )}
              </select>
            </label>
          )}
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'w', 'h'] as const).map((key) => (
            <label className={labelCls} key={key}>
              {key.toUpperCase()}
              <input
                className={input}
                type="number"
                step="0.25"
                value={viewport[key]}
                onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<ViewportNode>)}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-destructive"
          onClick={() => removeViewport(viewport.id)}
        >
          Remove viewport
        </button>
      </PanelSection>

      {(viewport.kind === 'plan' || viewport.kind === 'site-plan') && (
        <PanelSection title="Layers">
          <div className="space-y-0.5">
            {LAYER_ROWS.map((row) => (
              <label
                key={row.key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-muted-foreground text-xs hover:bg-accent/50"
              >
                <input
                  type="checkbox"
                  checked={viewport.layers[row.key]}
                  onChange={(e) =>
                    set({ layers: { ...viewport.layers, [row.key]: e.target.checked } })
                  }
                />
                {row.label}
              </label>
            ))}
          </div>
        </PanelSection>
      )}
    </div>
  )
}

function SettingsPanel({ sheet }: { sheet: SheetNode | undefined }) {
  if (!sheet) {
    return (
      <p className="px-1 py-4 text-center text-muted-foreground text-xs">No sheet selected.</p>
    )
  }
  const set = (patch: Partial<SheetNode>) =>
    (useScene.getState() as unknown as {
      updateNode: (id: string, data: Record<string, unknown>) => void
    }).updateNode(sheet.id, patch as Record<string, unknown>)
  return (
    <PanelSection title="Sheet">
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <label className={labelCls}>
          Number
          <input className={input} value={sheet.number} onChange={(e) => set({ number: e.target.value })} />
        </label>
        <label className={labelCls}>
          Title
          <input className={input} value={sheet.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
      </div>
      <label className={labelCls}>
        Paper
        <select
          className={input}
          value={sheet.size}
          onChange={(e) => set({ size: e.target.value as SheetNode['size'] })}
        >
          {Object.entries(PAPER_SIZES).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Order
        <input
          className={input}
          type="number"
          value={sheet.order}
          onChange={(e) => set({ order: Number(e.target.value) })}
        />
      </label>
    </PanelSection>
  )
}
