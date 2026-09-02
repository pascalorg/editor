/**
 * Sidebar panel — the small surface. The big one is the overlay (Ctrl+K →
 * Generate plans). This shows the last run and offers the same actions.
 */
import { generatePlans } from './run'
import { usePlans } from './store'

export default function PlansPanel() {
  const S = usePlans()
  return (
    <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
      <div>
        <h2 className="font-semibold text-sm">Plans</h2>
        <p className="mt-1 text-sidebar-foreground/60 text-xs">
          A permit-ready construction set from the open scene — cover, site plan, floor plans, elevations, sections, framing, schedules. The scene goes to the Plans API; what comes back is shown verbatim, defects included.
        </p>
      </div>
      <button type="button" onClick={() => void generatePlans()} disabled={S.run === 'running'} className="rounded-lg bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm shadow-sm disabled:opacity-60">
        {S.run === 'running' ? 'Generating…' : 'Generate plans'}
      </button>
      <p className="text-sidebar-foreground/50 text-[11px]">Also in the command palette: Ctrl+K → “Generate plans”.</p>
      {S.run !== 'idle' && (
        <div className="rounded-md border border-sidebar-border/50 bg-sidebar-accent/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span>{S.run === 'done' ? `${S.sheets.length} sheets` : S.run === 'failed' ? 'Failed' : 'Running…'}</span>
            <button type="button" className="rounded-md border border-sidebar-border/60 px-2 py-1 hover:bg-sidebar-accent" onClick={() => S.setOpen(true)}>Open</button>
          </div>
          {S.error && <div className="mt-2 text-destructive">{S.error}</div>}
          {S.skipped.map((k) => (
            <div key={k.id} className="mt-1 text-amber-500">not shipped — {k.id}: {k.reason}</div>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1 text-[11px] text-sidebar-foreground/60">
        Plans API
        <input className="rounded-md border border-sidebar-border/60 bg-transparent px-2 py-1 font-mono text-[11px] text-sidebar-foreground" value={S.apiBase} onChange={(e) => S.setApiBase(e.target.value)} />
      </label>
    </div>
  )
}
