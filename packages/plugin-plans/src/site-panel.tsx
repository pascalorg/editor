/**
 * Site-plan controls — move the house on the lot, set the yards, regenerate.
 * Used in the overlay's left rail and the sidebar panel. Theme tokens only.
 */
import { useScene } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { generatePlans } from './run'
import { FT, fmtFt, nudgeBuilding, readSite, rotateBuildingDeg, setBuildingPosition, setBuildingRotationDeg, setSetbacks, type SiteRead } from './site'
import { usePlans } from './store'

const btn = 'rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40'
const inp = 'w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[11px] text-foreground'

function useSite(): SiteRead {
  const [s, setS] = useState<SiteRead>(() => readSite())
  useEffect(() => {
    const sub = (useScene as unknown as { subscribe: (fn: () => void) => () => void }).subscribe(() => setS(readSite()))
    return sub
  }, [])
  return s
}

function NumFt({ value, onCommit, disabled }: { value: number; onCommit: (m: number) => void; disabled?: boolean }) {
  const [txt, setTxt] = useState((value / FT).toFixed(2))
  useEffect(() => { setTxt((value / FT).toFixed(2)) }, [value])
  return (
    <input
      className={inp}
      value={txt}
      disabled={disabled}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { const v = Number(txt); if (Number.isFinite(v)) onCommit(v * FT) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

async function regenerateToSitePlan() {
  await generatePlans()
  const S = usePlans.getState()
  const i = S.sheets.findIndex((s) => s.number === 'A1.0')
  if (i >= 0) S.setCurrent(i)
  S.setOpen(true)
}

export function SitePlanControls({ compact = false }: { compact?: boolean }) {
  const s = useSite()
  const P = usePlans()
  const [front, setFront] = useState('')
  const [side, setSide] = useState('')
  const [rear, setRear] = useState('')
  const [source, setSource] = useState('')
  const [zone, setZone] = useState('')
  useEffect(() => {
    setFront(s.setbacks.front === undefined ? '' : (s.setbacks.front / FT).toFixed(1))
    setSide(s.setbacks.side === undefined ? '' : (s.setbacks.side / FT).toFixed(1))
    setRear(s.setbacks.rear === undefined ? '' : (s.setbacks.rear / FT).toFixed(1))
    setSource(s.setbacksSource)
    setZone(s.zone)
  }, [s.setbacks.front, s.setbacks.side, s.setbacks.rear, s.setbacksSource, s.zone])

  const noBuilding = !s.buildingId
  const noLot = s.lot.length < 3
  const degs = Math.round(((s.rotationY * 180) / Math.PI) * 10) / 10
  const commitSetbacks = () => {
    const ft = (t: string) => { const v = Number(t); return t.trim() === '' || !Number.isFinite(v) ? undefined : v * FT }
    setSetbacks({ front: ft(front), side: ft(side), rear: ft(rear) }, source, zone)
  }

  return (
    <div className="flex flex-col gap-3 text-xs">
      {noLot && (
        <p className="text-muted-foreground">
          {s.siteId ? 'The site has no lot polygon yet — resolve the parcel first (Generate plans does it when the project has an address).' : 'No site node in the scene.'}
        </p>
      )}
      {!noLot && (
        <p className="text-muted-foreground">
          Lot: {s.isParcel ? `recorded parcel${s.apn ? ` · APN ${s.apn}` : ''}` : 'drawn polygon (not a recorded parcel — A1.0 will say so)'}
        </p>
      )}

      {/* yards now */}
      {s.yards && (
        <div className="grid grid-cols-4 gap-1 rounded-md border border-border bg-muted/30 p-2 text-center">
          {(['north', 'east', 'south', 'west'] as const).map((k) => (
            <div key={k}>
              <div className="font-mono text-[9px] text-muted-foreground uppercase">{k}</div>
              <div className={`font-mono ${s.yards![k] === null ? 'text-destructive' : ''}`}>{s.yards![k] === null ? 'off lot' : fmtFt(s.yards![k])}</div>
            </div>
          ))}
          <div className="col-span-4 text-[10px] text-muted-foreground">yards now — wall-bbox estimate; A1.0 is authoritative{s.footprintOutsideLot ? ' · footprint crosses the lot line' : ''}</div>
        </div>
      )}

      {/* move */}
      <div>
        <div className="mb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Move the house</div>
        <div className="grid grid-cols-3 gap-1">
          <span />
          <button type="button" className={btn} disabled={noBuilding} onClick={() => nudgeBuilding(0, -FT)} title="north 1 ft (shift: 5 ft)" onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); nudgeBuilding(0, -5 * FT) } }}>▲ N</button>
          <span />
          <button type="button" className={btn} disabled={noBuilding} onClick={() => nudgeBuilding(-FT, 0)} onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); nudgeBuilding(-5 * FT, 0) } }}>◀ W</button>
          <button type="button" className={btn} disabled={noBuilding} onClick={() => nudgeBuilding(0, FT)} onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); nudgeBuilding(0, 5 * FT) } }}>▼ S</button>
          <button type="button" className={btn} disabled={noBuilding} onClick={() => nudgeBuilding(FT, 0)} onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); nudgeBuilding(5 * FT, 0) } }}>E ▶</button>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">1 ft per click · hold Shift for 5 ft · or drag the building with the editor's move handle</div>
        {!compact && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">east (ft)
              <NumFt value={s.position[0]} disabled={noBuilding} onCommit={(m) => setBuildingPosition(m, s.position[2])} />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">south (ft)
              <NumFt value={s.position[2]} disabled={noBuilding} onCommit={(m) => setBuildingPosition(s.position[0], m)} />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">rotation (°)
              <input className={inp} disabled={noBuilding} defaultValue={degs} key={degs} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBuildingRotationDeg(v) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            </label>
          </div>
        )}
        <div className="mt-1 flex gap-1">
          <button type="button" className={btn} disabled={noBuilding} onClick={() => rotateBuildingDeg(-15)}>↺ 15°</button>
          <button type="button" className={btn} disabled={noBuilding} onClick={() => rotateBuildingDeg(15)}>↻ 15°</button>
          <button type="button" className={btn} disabled={noBuilding} onClick={() => rotateBuildingDeg(90)}>↻ 90°</button>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{degs}°</span>
        </div>
      </div>

      {/* setbacks */}
      <div>
        <div className="mb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Required yards</div>
        <div className="grid grid-cols-3 gap-2">
          {[['front', front, setFront], ['side', side, setSide], ['rear', rear, setRear]].map(([k, v, set]) => (
            <label key={k as string} className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">{k as string} (ft)
              <input className={inp} value={v as string} placeholder="—" onChange={(e) => (set as (s: string) => void)(e.target.value)} onBlur={commitSetbacks} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            </label>
          ))}
        </div>
        <label className="mt-1 flex flex-col gap-0.5 text-[10px] text-muted-foreground">source (zoning section — required to count as established)
          <input className={inp} value={source} placeholder="e.g. Sacramento County Zoning Code §5.2.2, RD-5" onChange={(e) => setSource(e.target.value)} onBlur={commitSetbacks} />
        </label>
        <label className="mt-1 flex flex-col gap-0.5 text-[10px] text-muted-foreground">zoning district
          <input className={inp} value={zone} placeholder="e.g. RD-5" onChange={(e) => setZone(e.target.value)} onBlur={commitSetbacks} />
        </label>
        <div className="mt-1 text-[10px] text-muted-foreground">Numbers without a source print as drawing state, not a requirement — that is the sheet's rule, not a bug.</div>
      </div>

      <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-60" disabled={P.run === 'running' || noBuilding} onClick={() => void regenerateToSitePlan()}>
        {P.run === 'running' ? 'Generating…' : 'Regenerate → site plan'}
      </button>
    </div>
  )
}
