'use client'

import { ChevronDown, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'

export type PicTo3DParams = {
  seed: number
  steps: number
  cfg: number
  denoise: number
  samplerName: string
  latentResolution: number
  numChunks: number
  octreeResolution: number
  modelShift: number
  meshAlgorithm: string
  meshThreshold: number
  meshBasicThreshold: number
  removeBackground: boolean
  remBgMode: string
  remBgBackground: string
  checkpointName: string
  glbFilenamePrefix: string
}

type Preset = {
  id: string
  label: string
  description: string
  params: PicTo3DParams
}

type ParamGroup = {
  id: string
  title: string
  fields: Array<{ key: keyof PicTo3DParams; label: string; hint: string }>
}

const NUMBER_KEYS: Array<keyof PicTo3DParams> = [
  'seed',
  'steps',
  'cfg',
  'denoise',
  'latentResolution',
  'numChunks',
  'octreeResolution',
  'modelShift',
  'meshThreshold',
  'meshBasicThreshold',
]

const STRING_KEYS: Array<keyof PicTo3DParams> = [
  'samplerName',
  'meshAlgorithm',
  'remBgMode',
  'remBgBackground',
  'checkpointName',
  'glbFilenamePrefix',
]

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="font-medium text-xs">{label}</span>
      {children}
      <span className="block text-[10px] text-muted-foreground leading-snug">{hint}</span>
    </label>
  )
}

export function PicTo3DParamPanel({
  params,
  presets,
  paramGroups,
  nodes,
  disabled,
  onChange,
  onReset,
}: {
  params: PicTo3DParams
  presets: Preset[]
  paramGroups: ParamGroup[]
  nodes: Record<string, string>
  disabled?: boolean
  onChange: (next: PicTo3DParams) => void
  onReset: () => void
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    sampler: true,
    mesh: true,
    latent: false,
    preprocess: false,
  })

  const patch = useCallback(
    (partial: Partial<PicTo3DParams>) => {
      onChange({ ...params, ...partial })
    },
    [onChange, params],
  )

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-4 border-border/60 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">Workflow Parameters</h2>
        <button
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={disabled}
          onClick={onReset}
          type="button"
        >
          <RotateCcw className="size-3.5" />
          Reset defaults
        </button>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        ComfyUI nodes: KSampler <code className="rounded bg-muted px-0.5">{nodes.ksampler}</code>,
        VoxelToMesh <code className="rounded bg-muted px-0.5">{nodes.mesh}</code>, SaveGLB{' '}
        <code className="rounded bg-muted px-0.5">{nodes.saveGlb}</code>, and related nodes. Changes
        apply when you press Generate 3D Model.
      </p>

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            className="rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50"
            disabled={disabled}
            key={preset.id}
            onClick={() => onChange({ ...preset.params })}
            title={preset.description}
            type="button"
          >
            <span className="font-medium">{preset.label}</span>
          </button>
        ))}
      </div>

      {paramGroups.map((group) => {
        const open = openGroups[group.id] ?? false
        return (
          <div className="rounded-lg border border-border/60 bg-muted/10" key={group.id}>
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-xs"
              disabled={disabled}
              onClick={() => toggleGroup(group.id)}
              type="button"
            >
              {group.title}
              <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="grid gap-3 border-border/40 border-t px-3 py-3 sm:grid-cols-2">
                {group.fields.map((field) => {
                  const key = field.key
                  if (key === 'removeBackground') {
                    return (
                      <FieldRow hint={field.hint} key={key} label={field.label}>
                        <input
                          checked={params.removeBackground}
                          className="size-4 rounded border-border"
                          disabled={disabled}
                          onChange={(e) => patch({ removeBackground: e.target.checked })}
                          type="checkbox"
                        />
                      </FieldRow>
                    )
                  }
                  if (NUMBER_KEYS.includes(key)) {
                    return (
                      <FieldRow hint={field.hint} key={key} label={field.label}>
                        <input
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                          disabled={disabled}
                          onChange={(e) => {
                            const v = Number.parseFloat(e.target.value)
                            if (Number.isFinite(v)) patch({ [key]: v } as Partial<PicTo3DParams>)
                          }}
                          step={key === 'denoise' || key.includes('Threshold') ? 0.05 : 1}
                          type="number"
                          value={params[key] as number}
                        />
                      </FieldRow>
                    )
                  }
                  if (STRING_KEYS.includes(key)) {
                    return (
                      <FieldRow hint={field.hint} key={key} label={field.label}>
                        <input
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                          disabled={disabled}
                          onChange={(e) => patch({ [key]: e.target.value } as Partial<PicTo3DParams>)}
                          type="text"
                          value={params[key] as string}
                        />
                      </FieldRow>
                    )
                  }
                  return null
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
