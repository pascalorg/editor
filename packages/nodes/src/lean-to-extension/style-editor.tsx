'use client'

import type { LeanToExtensionNode } from '@pascal-app/core'

export function CanopyStyleEditor({
  node,
  onUpdate,
}: {
  node: LeanToExtensionNode
  onUpdate: (patch: Partial<LeanToExtensionNode>) => void
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(['mono', 'gable', 'butterfly'] as const).map((canopyForm) => (
          <button
            type="button"
            key={canopyForm}
            aria-pressed={node.canopyForm === canopyForm}
            disabled={node.hostKind !== 'freestanding' && canopyForm !== 'mono'}
            onClick={() => onUpdate({ canopyForm })}
            className={`rounded-lg border p-2 text-xs disabled:opacity-40 ${node.canopyForm === canopyForm ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
          >
            <img
              src={`/icons/canopy/${canopyForm}.webp`}
              alt=""
              className="mx-auto h-16 w-16 object-contain"
            />
            {canopyForm === 'mono' ? 'Mono' : canopyForm === 'gable' ? 'Gable' : 'Butterfly'}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {node.hostKind === 'freestanding'
          ? 'Mono slopes to one side; gable drains outward; butterfly drains to the centre.'
          : 'Attached canopies use a mono roof. Place on open ground for all three forms.'}
      </p>
    </div>
  )
}
