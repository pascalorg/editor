/**
 * The Auto roof rail panel: form, pitch, overhang, style, the Rebuild button,
 * and the last run — masses, coverage, the policy decisions and the warnings
 * the engine raised.
 */
import { Home, RefreshCw } from 'lucide-react'
import { rebuildAutoRoof } from './run'
import { useAutoRoof } from './store'
import { STYLE_ROOF_FORMS, styleRoofForm } from './styles'

const field = 'w-full rounded-md border border-sidebar-border/60 bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground'
const label = 'mb-1 block font-mono text-[10px] text-sidebar-foreground/60 uppercase tracking-wider'

export default function AutoRoofPanel() {
  const S = useAutoRoof()
  const last = S.last
  return (
    <div className="flex flex-col text-sidebar-foreground">
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2 font-semibold text-sm">
          <Home className="h-4 w-4" /> Auto roof
        </div>
        <p className="text-[11px] text-sidebar-foreground/60">
          Derives the roof from the level’s exterior walls: the wall loop becomes masses, each mass a segment seated on the plate, gable or hip by the style and the massing, a shed rising away from the street. Every exterior wall is told what it carries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3">
        <div>
          <span className={label}>Form</span>
          <select className={field} value={S.options.form} onChange={(e) => S.setOptions({ form: e.target.value as never })}>
            <option value="auto">by style</option>
            <option value="gable">Gable</option>
            <option value="hip">Hip</option>
            <option value="shed">Shed</option>
            <option value="flat">Flat</option>
          </select>
        </div>
        <div>
          <span className={label}>Style</span>
          <select className={field} value={S.options.style} onChange={(e) => S.setOptions({ style: e.target.value })}>
            <option value="">none</option>
            {STYLE_ROOF_FORMS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Pitch (rise : 12)</span>
          <input
            className={field}
            type="number"
            min={0.5}
            max={18}
            step={0.5}
            value={S.options.pitchTwelfths}
            onChange={(e) => S.setOptions({ pitchTwelfths: Math.max(0.5, Math.min(18, Number(e.target.value) || 6)) })}
          />
        </div>
        <div>
          <span className={label}>Overhang (in)</span>
          <input
            className={field}
            type="number"
            min={0}
            max={48}
            step={1}
            value={S.options.overhangIn}
            onChange={(e) => S.setOptions({ overhangIn: Math.max(0, Math.min(48, Number(e.target.value) || 0)) })}
          />
        </div>
      </div>

      <div className="px-3 pt-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-xs disabled:opacity-50"
          disabled={S.running}
          onClick={() => rebuildAutoRoof(S.options, styleRoofForm)}
          type="button"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Rebuild roof from walls
        </button>
        <p className="mt-2 text-[10px] text-sidebar-foreground/50">
          Replaces the roof this panel made on the selected level. Roofs you placed by hand stay.
        </p>
      </div>

      {last && (
        <div className="mt-3 border-sidebar-border/60 border-t px-3 pt-3 text-[11px]">
          <span className={label}>Last run</span>
          {last.errors.length > 0 ? (
            <ul className="list-disc pl-4 text-destructive">
              {last.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p>
              {last.segments} segment{last.segments === 1 ? '' : 's'} over {last.masses} mass{last.masses === 1 ? '' : 'es'} · {Math.round(last.coverage * 100)}% of the footprint covered
              {last.popped ? ' · popped massing → hip' : ''}
            </p>
          )}
          {last.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-500">
              {last.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
