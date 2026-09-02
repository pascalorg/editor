/**
 * Sidebar panel — the project, the button, the last set. The big surface is
 * the overlay (Ctrl+K → Generate plans).
 */
import { FileText, Printer, RefreshCw, Sparkles } from 'lucide-react'
import { printSet } from './overlay'
import { ProjectCard, ProjectEditor, SettingsSection, SheetList } from './rail'
import { generatePlans } from './run'
import { SitePlanControls } from './site-panel'
import { usePlans } from './store'

export default function PlansPanel() {
  const S = usePlans()
  const running = S.run === 'running'
  if (S.editingProject && !S.open) {
    return (
      <div className="h-full">
        <ProjectEditor onClose={() => S.setEditingProject(false)} />
      </div>
    )
  }
  return (
    <div className="flex flex-col text-sidebar-foreground">
      <ProjectCard onEdit={() => S.setEditingProject(true)} />
      <div className="flex gap-1.5 p-3">
        <button type="button" onClick={() => void generatePlans()} disabled={running} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground text-xs shadow-sm disabled:opacity-60">
          {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : S.sheets.length ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {running ? 'Generating…' : S.sheets.length ? 'Regenerate' : 'Generate plans'}
        </button>
        {S.sheets.length > 0 && (
          <>
            <button type="button" onClick={() => S.setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-sidebar-border/60 px-3 py-2 text-xs hover:bg-sidebar-accent" title="Open the set"><FileText className="h-3.5 w-3.5" />Open</button>
            <button type="button" onClick={() => printSet(S.sheets)} className="rounded-lg border border-sidebar-border/60 px-2.5 py-2 text-xs hover:bg-sidebar-accent" title="Print / PDF"><Printer className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
      <p className="px-3 text-[11px] text-sidebar-foreground/50">Also: Ctrl+K → “Generate plans”.</p>
      {S.run === 'failed' && <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">{S.error}</div>}
      <div className="mt-3 border-sidebar-border/50 border-t p-3">
        <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Sheets</div>
        {S.sheets.length ? <SheetList /> : <p className="text-[11px] text-sidebar-foreground/50">No set yet.</p>}
      </div>
      <div className="border-sidebar-border/50 border-t p-3">
        <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Site plan</div>
        <SitePlanControls compact />
      </div>
      <div className="border-sidebar-border/50 border-t p-3">
        <div className="mb-2 font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Settings</div>
        <SettingsSection />
      </div>
    </div>
  )
}
