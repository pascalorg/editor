/**
 * The Generate rail panel: the options form (style, beds, baths, garage,
 * seed), the Generate button, the templates, and the last run's summary —
 * counts, the warnings the builder raised, and the errors when it refused.
 */
import { type SiteNode, useScene } from '@pascal-app/core'
import { LotAddressBox } from '@pascal-app/plugin-lot'
import { Dices, Home, RefreshCw, Sparkles } from 'lucide-react'
import { describeFinishes } from './finishes'
import { generateHouse, generateTemplate } from './run'
import { useGenerate } from './store'
import { SERVICE_CHOICES, type ServiceChoices } from './roll'
import { STYLES } from './styles'
import { TEMPLATES } from './templates/poppy'

const field =
  'w-full rounded-md border border-sidebar-border/60 bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground'
const label = 'mb-1 block font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider'

const FT = 0.3048
const FLOOR_HEIGHTS = [8, 12, 18, 24, 30, 36, 48] as const
const CONTOUR_INTERVALS = [6, 12, 24] as const

/** The scene's site (the lot the generator sits the house on), live. */
function useSiteNode(): SiteNode | null {
  return useScene((state) => {
    for (const n of Object.values(state.nodes)) if ((n as { type?: string }).type === 'site') return n as unknown as SiteNode
    return null
  })
}

export default function GeneratePanel() {
  const S = useGenerate()
  const beds = S.options.beds ?? 0
  const baths = S.options.baths ?? 0
  const garage = S.options.garage
  const site = useSiteNode()
  const writeSite = (patch: Record<string, unknown>) => {
    if (site) useScene.getState().updateNode(site.id as never, patch as never)
  }
  const setbackFt = (key: 'front' | 'rear' | 'left' | 'right'): string => {
    const s = site?.setbacks
    if (!s) return ''
    const v = key === 'left' || key === 'right' ? (s[key] ?? s.side) : s[key]
    return typeof v === 'number' ? String(Math.round((v / FT) * 10) / 10) : ''
  }
  const writeSetback = (key: 'front' | 'rear' | 'left' | 'right', text: string) => {
    const feet = Number(text)
    if (!Number.isFinite(feet) || feet < 0) return
    const base = site?.setbacks ?? { front: 20 * FT, side: 5 * FT, rear: 15 * FT }
    writeSite({
      setbacks: { ...base, [key]: feet * FT },
      setbacksSource: `${site?.setbacksSource ?? 'setbacks'} — ${key} set by hand in the Generate panel`,
    })
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto text-sidebar-foreground">
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2 font-semibold text-sm">
          <Home className="h-4 w-4" /> Generate
        </div>
        <p className="text-[11px] text-sidebar-foreground/60">
          A complete house from a seed: rooms, walls, doors, egress windows, zones, slab and roof,
          placed on the parcel at the front setback. Leave a field on “roll” and the seed decides
          it.
        </p>
      </div>

      <div className="border-sidebar-border/50 border-b px-3 pb-3">
        <div className={label}>Lot</div>
        <LotAddressBox
          buttonLabel="Drop in lot & generate"
          onDone={(result) => {
            if (result.ok) generateHouse()
          }}
        />
        <p className="mt-1.5 text-[11px] text-sidebar-foreground/50">
          The parcel, the streets and the front edge drop in first; the house is then placed on the
          buildable envelope facing the street.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3">
        <div className="col-span-2">
          <span className={label}>Style</span>
          <select
            className={field}
            value={S.options.style ?? ''}
            onChange={(e) => S.setOptions({ style: e.target.value || undefined })}
          >
            <option value="">roll</option>
            {STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Bedrooms</span>
          <select
            className={field}
            value={beds}
            onChange={(e) =>
              S.setOptions({ beds: (Number(e.target.value) || undefined) as 2 | 3 | 4 | undefined })
            }
          >
            <option value={0}>roll</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>
        <div>
          <span className={label}>Baths</span>
          <select
            className={field}
            value={baths}
            onChange={(e) =>
              S.setOptions({
                baths: (Number(e.target.value) || undefined) as 1 | 2 | 3 | undefined,
              })
            }
          >
            <option value={0}>roll</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>
        <div>
          <span className={label}>Garage</span>
          <select
            className={field}
            value={garage === undefined ? '' : garage ? 'yes' : 'no'}
            onChange={(e) =>
              S.setOptions({ garage: e.target.value === '' ? undefined : e.target.value === 'yes' })
            }
          >
            <option value="">roll</option>
            <option value="yes">attached</option>
            <option value="no">none</option>
          </select>
        </div>
        <div>
          <span className={label}>Floor above grade</span>
          <select
            className={field}
            value={S.options.floorAboveGradeIn ?? ''}
            onChange={(e) => S.setOptions({ floorAboveGradeIn: e.target.value === '' ? undefined : Number(e.target.value) })}
          >
            <option value="">by the rule (8 in slab, 18 in raised)</option>
            {FLOOR_HEIGHTS.map((n) => (
              <option key={n} value={n}>
                {n} in above the high side
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Foundation</span>
          <select
            className={field}
            value={S.options.foundation ?? ''}
            onChange={(e) => S.setOptions({ foundation: e.target.value === '' ? undefined : (e.target.value as 'slab' | 'raised') })}
          >
            <option value="">by the grade and the style</option>
            <option value="slab">slab on a built-up pad</option>
            <option value="raised">raised on a stem wall (stepped on a hill)</option>
          </select>
        </div>
        {site && (
          <div className="col-span-2">
            <span className={label}>Setbacks (ft) — front · rear · left · right</span>
            <div className="grid grid-cols-4 gap-1">
              {(['front', 'rear', 'left', 'right'] as const).map((key) => (
                <input
                  className={field}
                  defaultValue={setbackFt(key)}
                  inputMode="decimal"
                  key={`${key}-${setbackFt(key)}`}
                  onBlur={(e) => writeSetback(key, e.target.value)}
                  placeholder={key}
                  title={key}
                  type="number"
                />
              ))}
            </div>
            <p className="mt-1 text-[10px] text-sidebar-foreground/50">
              {site.setbacksSource ?? 'No setbacks yet — drop a lot in.'}
            </p>
          </div>
        )}
        {site && (
          <div className="col-span-2">
            <span className={label}>Terrain contours (site plan)</span>
            <select
              className={field}
              value={site.contourIntervalIn ?? 12}
              onChange={(e) => writeSite({ contourIntervalIn: Number(e.target.value) })}
            >
              <option value={0}>none</option>
              {CONTOUR_INTERVALS.map((n) => (
                <option key={n} value={n}>
                  every {n} in
                </option>
              ))}
            </select>
          </div>
        )}
        {SERVICE_CHOICES.map((c) => (
          <div key={c.key}>
            <span className={label}>{c.label}</span>
            <select
              className={field}
              value={S.options.services?.[c.key] ?? ''}
              onChange={(e) => {
                const next: ServiceChoices = { ...(S.options.services ?? {}) }
                if (e.target.value === '') delete next[c.key]
                else (next as Record<string, string>)[c.key] = e.target.value
                S.setOptions({ services: Object.keys(next).length > 0 ? next : undefined })
              }}
            >
              <option value="">auto (the state's practice)</option>
              {c.values.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <span className={label}>Seed</span>
          <div className="flex gap-1">
            <input
              className={field}
              type="number"
              value={S.seed}
              onChange={(e) => S.setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <button
              type="button"
              onClick={S.reroll}
              className="rounded-md border border-sidebar-border/60 px-2 hover:bg-sidebar-accent"
              title="New seed"
            >
              <Dices className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 p-3">
        <button
          type="button"
          onClick={() => {
            generateHouse()
          }}
          disabled={S.running}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs shadow-sm disabled:opacity-60"
        >
          {S.running ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Generate house
        </button>
        <button
          type="button"
          onClick={() => {
            S.reroll()
            generateHouse()
          }}
          disabled={S.running}
          className="flex items-center gap-1.5 rounded-lg border border-sidebar-border/60 px-3 py-2 text-xs hover:bg-sidebar-accent"
          title="New seed, same options"
        >
          <Dices className="h-3.5 w-3.5" /> Random
        </button>
      </div>
      <p className="px-3 text-[11px] text-sidebar-foreground/50">
        Also: Ctrl+K → “Generate house”. Generating again replaces the generated building;
        hand-built ones are left alone.
      </p>

      <div className="mt-3 border-sidebar-border/50 border-t p-3">
        <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">
          Templates
        </div>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              generateTemplate(t.id)
            }}
            disabled={S.running}
            className="mb-1.5 block w-full rounded-md border border-sidebar-border/60 px-2.5 py-2 text-left hover:bg-sidebar-accent"
          >
            <div className="font-semibold text-xs">{t.label}</div>
            <div className="text-[11px] text-sidebar-foreground/60">{t.summary}</div>
          </button>
        ))}
      </div>

      {S.last && (
        <div className="border-sidebar-border/50 border-t p-3 text-[11px]">
          <div className="mb-1 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">
            Last run
          </div>
          <div className="font-semibold text-xs">{S.last.name}</div>
          {S.last.stats && (
            <div className="mt-1 text-sidebar-foreground/70">
              {S.last.stats.rooms} rooms · {S.last.stats.walls} walls · {S.last.stats.doors} doors ·{' '}
              {S.last.stats.windows} windows · {S.last.stats.zones} zones
              {S.last.stats.items > 0 ? ` · ${S.last.stats.items} items` : ''}
              <br />
              {S.last.stats.livingSqFt.toLocaleString('en-US')} sf living ·{' '}
              {S.last.stats.footprintSqFt.toLocaleString('en-US')} sf footprint
              {S.last.seed !== null ? ` · seed ${S.last.seed}` : ''}
              {!S.last.placed && <span> · no parcel in the scene — placed at the origin</span>}
              {S.last.foundation && (
                <>
                  <br />
                  foundation:{' '}
                  {S.last.foundation.type === 'raised'
                    ? 'raised floor over a crawl space'
                    : 'slab on grade'}
                  , finish floor {S.last.foundation.ffAboveGradeIn}" above grade (
                  {S.last.foundation.source})
                  {S.last.foundation.terrain
                    ? ` · ground under the footprint: ${Math.round(S.last.foundation.terrain.reliefIn)}" of fall`
                    : ''}
                </>
              )}
              {S.last.finishes && (
                <>
                  <br />
                  finishes: {describeFinishes(S.last.finishes)}
                </>
              )}
              {[S.last.porch, S.last.rear].map((e) =>
                e ? (
                  <span key={e.entrance}>
                    <br />
                    {e.entrance === 'rear' ? 'rear' : 'porch'}:{' '}
                    {e.policy === 'none'
                      ? 'covered stoop'
                      : e.policy === 'full' || e.policy === 'entry'
                        ? `${e.policy} porch`
                        : e.policy}{' '}
                    ({e.landing}) {e.widthFt}' × {e.depthFt}' ·{' '}
                    {e.roof === 'none'
                      ? 'no cover'
                      : e.roof === 'flat'
                        ? 'flat canopy'
                        : `${e.roof} roof`}
                    {e.posts > 0 ? ` · ${e.posts} posts` : ''}
                    {e.guard ? ` · 36" ${e.railStyle === 'cable' ? 'cable rail' : 'guard'}` : ''}
                    {e.risers > 0
                      ? ` · ${e.risers} riser${e.risers === 1 ? '' : 's'} @ ${e.riserIn.toFixed(2)}"`
                      : ' · at grade'}
                  </span>
                ) : null,
              )}
            </div>
          )}
          {S.last.errors.map((e) => (
            <div
              key={e}
              className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 p-1.5 text-destructive"
            >
              {e}
            </div>
          ))}
          {S.last.warnings.map((w) => (
            <div key={w} className="mt-1 text-amber-600 dark:text-amber-400">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
