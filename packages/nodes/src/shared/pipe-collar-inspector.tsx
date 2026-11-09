'use client'

import {
  type AnyNode,
  formatFixed,
  formatNumber,
  nodeRegistry,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { pipeCollarOccupied } from '../pipe-segment/collar-connection'
import { activatePipeCollarContinuation } from '../pipe-segment/continuation'

export default function PipeCollarInspector({ node }: { node: AnyNode }) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  const ports = nodeRegistry.get(node.type)?.ports?.(node) ?? []
  const pipePorts = ports.filter((port) => port.system === 'waste' || port.system === 'vent')
  if (!pipePorts.length) return null
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">
        {i18n._({ id: 'node.shared.pipeCollarInspector.connectPipe', message: 'Connect pipe' })}
      </h3>
      {pipePorts.map((port, index) => {
        const occupied = pipeCollarOccupied(nodes, { ...port, nodeId: node.id })
        return (
          <button
            key={port.id}
            type="button"
            disabled={occupied}
            className="block w-full rounded border px-2 py-1 text-left text-xs disabled:opacity-50"
            onClick={() => activatePipeCollarContinuation(node, port)}
          >
            {i18n._({
              id: 'node.shared.pipeCollarInspector.collarButton',
              message:
                '{port, select, inlet {Inlet} outlet {Outlet} branch {Branch} branch2 {Second branch} other {Collar {number}}} · {diameter} in · {elevation} m · {state, select, connected {Connected} other {Draw from collar}}',
              values: {
                port: port.id,
                number: String(index + 1),
                diameter: formatNumber(port.diameter, { locale: i18n.getLocale() }),
                elevation: formatFixed(port.position[1], 3, i18n.getLocale()),
                state: occupied ? 'connected' : 'open',
              },
            })}
          </button>
        )
      })}
    </section>
  )
}
