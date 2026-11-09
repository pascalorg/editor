'use client'

import { type AnyNode, formatNumber, nodeRegistry, usePascalI18n, useScene } from '@pascal-app/core'
import { Vector3 } from 'three'
import { activateDuctCollarContinuation } from '../duct-segment/continuation'

export default function DuctCollarInspector({ node }: { node: AnyNode }) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  const ports = nodeRegistry.get(node.type)?.ports?.(node) ?? []
  const others = Object.values(nodes)
    .filter((other) => other.id !== node.id && other.parentId === node.parentId)
    .flatMap((other) => nodeRegistry.get(other.type)?.ports?.(other) ?? [])
  const airPorts = ports.filter((port) => port.system === 'supply' || port.system === 'return')
  if (!airPorts.length) return null
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">
        {i18n._({ id: 'node.shared.ductCollarInspector.connectDuct', message: 'Connect duct' })}
      </h3>
      {airPorts.map((port) => {
        const occupied = others.some(
          (other) =>
            new Vector3(...other.position).distanceTo(new Vector3(...port.position)) < 0.005 &&
            new Vector3(...other.direction).dot(new Vector3(...port.direction)) < -0.99,
        )
        const locale = i18n.getLocale()
        const size =
          port.shape &&
          port.shape !== 'round' &&
          port.width !== undefined &&
          port.height !== undefined
            ? `${formatNumber(port.width, { locale })} × ${formatNumber(port.height, { locale })}`
            : formatNumber(port.diameter, { locale })
        return (
          <button
            key={port.id}
            type="button"
            disabled={occupied}
            className="block w-full rounded border px-2 py-1 text-left text-xs disabled:opacity-50"
            onClick={() => activateDuctCollarContinuation(node, port)}
          >
            {i18n._({
              id: 'node.shared.ductCollarInspector.collarButton',
              message:
                '{system, select, return {Return} other {Supply}} · {size} in · {state, select, connected {Connected} other {Draw from collar}}',
              values: {
                system: port.system === 'return' ? 'return' : 'supply',
                size,
                state: occupied ? 'connected' : 'open',
              },
            })}
          </button>
        )
      })}
    </section>
  )
}
