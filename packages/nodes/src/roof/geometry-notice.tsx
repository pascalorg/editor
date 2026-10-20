import { type AnyNodeId, useScene } from '@pascal-app/core'
import { ActionButton } from '@pascal-app/editor'
import { useGeometryStatus } from '@pascal-app/viewer'

export function RoofGeometryNotice({ ids }: { ids: readonly AnyNodeId[] }) {
  const failures = useGeometryStatus((state) => state.failures)
  const failedId = ids.find((id) => failures.has(id))
  if (!failedId) return null
  return (
    <div role="alert" className="mx-3 my-2 rounded-md border border-amber-500/40 p-3 text-xs">
      <p>
        {failures.get(failedId) === 'invalid-geometry'
          ? 'Roof geometry is invalid. The previous shape is still shown. Adjust the dimensions or intersections and retry.'
          : 'Roof geometry could not be rebuilt. The previous shape is still shown. Adjust the dimensions or intersections and retry.'}
      </p>
      <ActionButton
        label="Retry roof geometry"
        onClick={() => {
          for (const id of ids) if (failures.has(id)) useScene.getState().markDirty(id)
        }}
      />
    </div>
  )
}
