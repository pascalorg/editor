'use client'

import {
  getCatalogMaterialById,
  getCurtainWallConfig,
  parseMaterialRef,
  resolveMaterial,
  type SceneMaterialId,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useLibraryMaterialsVersion } from '@pascal-app/viewer'
import { wallPaint } from './paint'

export function CurtainFrameMaterial({ node, onCommit }: { node: WallNode; onCommit: () => void }) {
  const brush = useEditor((state) => state.activePaintMaterial)
  const materials = useScene((state) => state.materials)
  const readOnly = useScene((state) => state.readOnly)
  useLibraryMaterialsVersion()
  const ref = node.slots?.['curtain-frame']
  const parsed = parseMaterialRef(ref)
  const catalog = parsed?.kind === 'library' ? getCatalogMaterialById(parsed.id) : undefined
  const custom = parsed?.kind === 'scene' ? materials[parsed.id as SceneMaterialId] : undefined
  const name = catalog?.label ?? custom?.name ?? (ref ? 'Unavailable material' : 'Frame color')
  const color =
    catalog?.previewColor ??
    (custom ? resolveMaterial(custom.material).color : getCurtainWallConfig(node).frameColor)
  const canApply = Boolean(brush?.material || brush?.materialPreset)
  const apply = (reset = false) => {
    onCommit()
    const current = useScene.getState().nodes[node.id]
    if (current?.type !== 'wall') return
    wallPaint.commit?.({
      node: current,
      role: 'curtain-frame',
      material: reset ? undefined : brush?.material,
      materialPreset: reset ? undefined : brush?.materialPreset,
    })
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="text-xs text-muted-foreground">Frame material</div>
      <div className="flex items-center gap-2 text-xs">
        {catalog?.previewThumbnailUrl ? (
          <img alt="" className="h-7 w-7 rounded object-cover" src={catalog.previewThumbnailUrl} />
        ) : (
          <span
            className="h-7 w-7 shrink-0 rounded border border-border"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate" title={name}>
          {name}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded border border-border px-2 py-1 text-xs"
          disabled={readOnly}
          onClick={() => {
            onCommit()
            useEditor.getState().armMaterialPaint(brush ?? undefined)
          }}
          type="button"
        >
          Choose in paint tool
        </button>
        <button
          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
          disabled={readOnly || !canApply}
          onClick={() => apply()}
          type="button"
        >
          Apply selected paint to frame
        </button>
        {ref && (
          <button
            className="rounded border border-border px-2 py-1 text-xs"
            disabled={readOnly}
            onClick={() => apply(true)}
            type="button"
          >
            Use frame color
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Choose a paint material, then click the frame in 3D or apply it here.
      </p>
    </div>
  )
}
