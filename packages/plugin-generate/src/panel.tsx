/**
 * The Generate rail panel: the options form (style, beds, baths, garage,
 * seed), the Generate button, the templates, and the last run's summary —
 * counts, the warnings the builder raised, and the errors when it refused.
 */
import { LotAddressBox } from '@pascal-app/plugin-lot'
import { Dices, Home, RefreshCw, Sparkles } from 'lucide-react'
import { generateHouse, generateTemplate } from './run'
import { useGenerate } from './store'
import { STYLES } from './styles'
import { TEMPLATES } from './templates/poppy'

const field = 'w-full rounded-md border border-sidebar-border/60 bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground'
const label = 'mb-1 block font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider'

export default function GeneratePanel() {
  const S = useGenerate()
  const beds = S.options.beds ?? 0
  const baths = S.options.baths ?? 0
  const garage = S.options.garage
  return (
    <div className="flex flex-col text-sidebar-foreground">
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2 font-semibold text-sm">
          <Home className="h-4 w-4" /> Generate
        </div>
        <p className="text-[11px] text-sidebar-foreground/60">
          A complete house from a seed: rooms, walls, doors, egress windows, zones, slab and roof, placed on the parcel at the front setback. Leave a field on
          “roll” and the seed decides it.
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
          The parcel, the streets and the front edge drop in first; the house is then placed on the buildable envelope facing the street.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3">
        <div className="col-span-2">
          <span className={label}>Style</span>
          <select className={field} value={S.options.style ?? ''} onChange={(e) => S.setOptions({ style: e.target.value || undefined })}>
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
          <select className={field} value={beds} onChange={(e) => S.setOptions({ beds: (Number(e.target.value) || undefined) as 2 | 3 | 4 | undefined })}>
            <option value={0}>roll</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>
        <div>
          <span className={label}>Baths</span>
          <select className={field} value={baths} onChange={(e) => S.setOptions({ baths: (Number(e.target.value) || undefined) as 1 | 2 | 3 | undefined })}>
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
            onChange={(e) => S.setOptions({ garage: e.target.value === '' ? undefined : e.target.value === 'yes' })}
          >
            <option value="">roll</option>
            <option value="yes">attached</option>
            <option value="no">none</option>
          </select>
        </div>
        <div>
          <span className={label}>Seed</span>
          <div className="flex gap-1">
            <input
              className={field}
              type="number"
              value={S.seed}
              onChange={(e) => S.setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <button type="button" onClick={S.reroll} className="rounded-md border border-sidebar-border/60 px-2 hover:bg-sidebar-accent" title="New seed">
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
          {S.running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
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
      <p className="px-3 text-[11px] text-sidebar-foreground/50">Also: Ctrl+K → “Generate house”. Generating again replaces the generated building; hand-built ones are left alone.</p>

      <div className="mt-3 border-sidebar-border/50 border-t p-3">
        <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Templates</div>
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
          <div className="mb-1 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Last run</div>
          <div className="font-semibold text-xs">{S.last.name}</div>
          {S.last.stats && (
            <div className="mt-1 text-sidebar-foreground/70">
              {S.last.stats.rooms} rooms · {S.last.stats.walls} walls · {S.last.stats.doors} doors · {S.last.stats.windows} windows · {S.last.stats.zones} zones
              <br />
              {S.last.stats.livingSqFt.toLocaleString('en-US')} sf living · {S.last.stats.footprintSqFt.toLocaleString('en-US')} sf footprint
              {S.last.seed !== null ? ` · seed ${S.last.seed}` : ''}
              {!S.last.placed && <span> · no parcel in the scene — placed at the origin</span>}
              {S.last.porch && (
                <>
                  <br />
                  porch: {S.last.porch.policy === 'none' ? 'covered stoop' : `${S.last.porch.policy} porch`} {S.last.porch.widthFt}' × {S.last.porch.depthFt}' ·{' '}
                  {S.last.porch.roof === 'flat' ? 'flat canopy' : `${S.last.porch.roof} roof`} · {S.last.porch.posts} posts
                  {S.last.porch.guard ? ' · 36" guard' : ''}
                  {S.last.porch.risers > 0 ? ` · ${S.last.porch.risers} riser${S.last.porch.risers === 1 ? '' : 's'} @ ${S.last.porch.riserIn.toFixed(2)}"` : ' · at grade'}
                </>
              )}
            </div>
          )}
          {S.last.errors.map((e) => (
            <div key={e} className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 p-1.5 text-destructive">
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
