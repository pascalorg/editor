'use client'

import {
  getWallTrimFaces,
  linearControlValueToMeters,
  metersToLinearUnit,
  usePascalI18n,
  type WallTrimConfig,
  type WallTrimSpan,
} from '@pascal-app/core'

/** Bounds remain editable in the same wall inspector that edits the moulding. */
export function WallTrimBounds({
  trim,
  length,
  unit,
  onChange,
}: {
  trim: WallTrimConfig
  length: number
  unit: 'metric' | 'imperial'
  onChange: (patch: Partial<WallTrimConfig>) => void
}) {
  const i18n = usePascalI18n()
  const spans = trim.spans
  const changeSpans = (next: WallTrimSpan[] | undefined) => {
    const faces = [...new Set(next?.map((span) => span.face))]
    onChange({
      spans: next,
      sides: faces.length === 2 ? 'both' : (faces[0] ?? trim.sides),
    })
  }
  const update = (index: number, patch: Partial<WallTrimSpan>) =>
    changeSpans(spans?.map((span, i) => (i === index ? { ...span, ...patch } : span)))
  const button = 'rounded-full border border-border/50 px-2.5 py-0.5 text-xs hover:bg-accent'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          type="button"
          onClick={() =>
            changeSpans([
              ...(spans ??
                getWallTrimFaces(trim.sides).map((face) => ({ face, u0: 0, u1: length }))),
              ...(spans ? [{ face: getWallTrimFaces(trim.sides)[0]!, u0: 0, u1: length }] : []),
            ])
          }
        >
          {i18n._({ id: 'node.wall.trim.addStretch', message: 'Add stretch' })}
        </button>
        {spans !== undefined && (
          <button className={button} type="button" onClick={() => changeSpans(undefined)}>
            {i18n._({ id: 'node.wall.trim.wholeFace', message: 'Whole face' })}
          </button>
        )}
      </div>
      {spans?.map((span, index) => (
        <div className="flex items-center gap-1" key={`${index}-${span.face}`}>
          <select
            aria-label={i18n._({ id: 'node.wall.trim.face', message: 'Trim face' })}
            value={span.face}
            onChange={(event) => update(index, { face: event.target.value as 'a' | 'b' })}
          >
            {(['a', 'b'] as const).map((face) => (
              <option key={face} value={face}>
                {face.toUpperCase()}
              </option>
            ))}
          </select>
          {(['u0', 'u1'] as const).map((bound) => (
            <label className="min-w-0 flex-1 text-xs" key={bound}>
              {bound === 'u0'
                ? i18n._({ id: 'node.wall.trim.start', message: 'Start' })
                : i18n._({ id: 'node.wall.trim.end', message: 'End' })}
              {` (${unit === 'imperial' ? 'ft' : 'm'})`}
              <input
                className="w-full rounded border border-border bg-background px-1"
                key={`${span[bound]}-${unit}`}
                type="number"
                min={0}
                max={metersToLinearUnit(length, unit)}
                step="any"
                defaultValue={metersToLinearUnit(
                  span[bound] ?? (bound === 'u0' ? 0 : length),
                  unit,
                )}
                onBlur={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  const reset = () => {
                    event.currentTarget.value = String(
                      metersToLinearUnit(span[bound] ?? (bound === 'u0' ? 0 : length), unit),
                    )
                  }
                  if (!Number.isFinite(value)) return reset()
                  const metres = linearControlValueToMeters(value, unit, {
                    minMeters: 0,
                    maxMeters: length,
                  })
                  if (bound === 'u0' ? metres < (span.u1 ?? length) : metres > (span.u0 ?? 0))
                    update(index, { [bound]: metres })
                  else reset()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
          ))}
          <button
            className={button}
            type="button"
            onClick={() => changeSpans(spans.filter((_, i) => i !== index))}
          >
            {i18n._({ id: 'node.wall.panel.remove', message: 'Remove' })}
          </button>
        </div>
      ))}
    </div>
  )
}
