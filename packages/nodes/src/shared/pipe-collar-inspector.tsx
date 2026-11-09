'use client'

import {
  type AnyNode,
  formatFixed,
  formatNumber,
  nodeRegistry,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { pipeCollarOccupied } from '../pipe-segment/collar-connection'
import { pipeGrade } from '../pipe-segment/slope'

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
      {pipePorts.map((port) => {
        const occupied = pipeCollarOccupied(nodes, { ...port, nodeId: node.id })
        return (
          <button
            key={port.id}
            type="button"
            disabled={occupied}
            className="block w-full rounded border px-2 py-1 text-left text-xs disabled:opacity-50"
            onClick={() => {
              const editor = useEditor.getState()
              editor.setToolDefaults('pipe-segment', {
                ...editor.toolDefaults['pipe-segment'],
                continuation: { nodeId: node.id, portId: port.id },
                diameter: port.diameter,
                system: port.system,
                pipeMaterial: 'pipeMaterial' in node ? node.pipeMaterial : 'pvc',
                elevation: port.position[1],
                routingMode:
                  Math.hypot(port.direction[0], port.direction[2]) < 1e-6
                    ? 'vertical'
                    : 'horizontal',
                targetElevation: port.position[1] + Math.sign(port.direction[1] || 1),
                ...(() => {
                  const grade = pipeGrade([0, 0, 0], [...port.direction]) ?? 0
                  return {
                    fall: Math.abs(grade) > 1e-6 ? 'sloped' : 'level',
                    gradePercent: Math.abs(grade) * 100,
                    flowDirection: grade < 0 ? 'reverse' : 'forward',
                  }
                })(),
                crossingMode: 'connect',
              })
              useViewer.getState().setSelection({ selectedIds: [] })
              editor.setTool('pipe-segment')
            }}
          >
            {i18n._({
              id: 'node.shared.pipeCollarInspector.collarButton',
              message:
                '{port} · {diameter} in · {elevation} m · {state, select, connected {Connected} other {Draw from collar}}',
              values: {
                port: port.id,
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
