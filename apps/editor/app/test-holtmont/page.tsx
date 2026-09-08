'use client'

/**
 * Banco de pruebas del puente con Holtmont.
 *
 * Carga las escenas que genera el agente (`public/holtmont-fixtures/`, escritas
 * por `scripts/generar_escenas_pascal.py` del repositorio HOLTMONT-PYTHON) y las
 * manda al editor por el mismo `postMessage` que usa la Pre Work Order. Sirve a
 * mano y también para la prueba de humo con navegador
 * (`scripts/holtmont-smoke.mjs`), que entra con `?scene=<nombre>` y lee el
 * resultado de `window.__holtmontTest`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Registro = { hora: string; texto: string; entrante: boolean }

type EstadoDePrueba = {
  ready: boolean
  ack: Record<string, unknown> | null
  error: Record<string, unknown> | null
  enviada: string | null
}

declare global {
  interface Window {
    __holtmontTest?: EstadoDePrueba
  }
}

export default function TestHoltmontPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [log, setLog] = useState<Registro[]>([])
  const [ready, setReady] = useState(false)
  const [escenas, setEscenas] = useState<string[]>([])
  const [seleccionada, setSeleccionada] = useState<string>('')
  const estado = useRef<EstadoDePrueba>({ ready: false, ack: null, error: null, enviada: null })

  const anotar = useCallback((texto: string, entrante = false) => {
    setLog((prev) =>
      [{ hora: new Date().toISOString().slice(11, 23), texto, entrante }, ...prev].slice(0, 60),
    )
  }, [])

  const publicarEstado = useCallback(() => {
    window.__holtmontTest = { ...estado.current }
  }, [])

  // Catálogo de escenas disponibles y la que pide la URL (`?scene=`).
  useEffect(() => {
    publicarEstado()
    const pedida = new URLSearchParams(window.location.search).get('scene')
    fetch('/holtmont-fixtures/index.json')
      .then((r) => r.json())
      .then((lista: string[]) => {
        setEscenas(lista)
        setSeleccionada(pedida && lista.includes(pedida) ? pedida : (lista[0] ?? ''))
      })
      .catch((err) => anotar(`no se pudo leer el índice de escenas: ${err}`))
  }, [anotar, publicarEstado])

  const enviarEscena = useCallback(
    async (nombre: string) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || !nombre) return
      estado.current = { ...estado.current, ack: null, error: null, enviada: null }
      publicarEstado()
      anotar(`→ HOLTMONT_3D_IMPORT (${nombre})`)
      const projectData = await fetch(`/holtmont-fixtures/${nombre}.json`).then((r) => r.json())
      iframe.contentWindow.postMessage({ type: 'HOLTMONT_3D_IMPORT', projectData }, '*')
      estado.current = { ...estado.current, enviada: nombre }
      publicarEstado()
    },
    [anotar, publicarEstado],
  )

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null
      if (!data?.type) return

      if (data.type === 'PASCAL_READY') {
        anotar('← PASCAL_READY', true)
        setReady(true)
        estado.current = { ...estado.current, ready: true }
      } else if (data.type === 'HOLTMONT_3D_IMPORT_ACK') {
        const descartes = (data.dropped as unknown[]) ?? []
        anotar(
          `← HOLTMONT_3D_IMPORT_ACK (${data.nodeCount} nodos, ${descartes.length} descartes)`,
          true,
        )
        estado.current = { ...estado.current, ack: data }
      } else if (data.type === 'HOLTMONT_3D_IMPORT_ERROR') {
        anotar(`← HOLTMONT_3D_IMPORT_ERROR: ${data.reason}`, true)
        estado.current = { ...estado.current, error: data }
      } else if (data.type === 'HOLTMONT_3D_EXPORT') {
        const exportData = data.data as Record<string, unknown>
        anotar(`← HOLTMONT_3D_EXPORT (${Object.keys(exportData?.nodes ?? {}).length} nodos)`, true)
      } else {
        return
      }
      publicarEstado()
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [anotar, publicarEstado])

  // Autoenvío en cuanto el editor avisa que está listo: así la prueba de humo
  // no depende de un temporizador.
  useEffect(() => {
    if (ready && seleccionada && !estado.current.enviada) {
      void enviarEscena(seleccionada)
    }
  }, [ready, seleccionada, enviarEscena])

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace' }}>
      <div
        style={{
          width: 320,
          padding: 16,
          borderRight: '1px solid #333',
          background: '#111',
          color: '#eee',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>Puente Holtmont — banco de pruebas</h2>

        <div style={{ fontSize: 11, color: ready ? '#4ade80' : '#facc15', marginBottom: 8 }}>
          Editor: {ready ? '✓ listo' : 'esperando…'}
        </div>

        <select
          onChange={(e) => setSeleccionada(e.target.value)}
          style={{ width: '100%', marginBottom: 6, padding: 4, fontSize: 12 }}
          value={seleccionada}
        >
          {escenas.map((nombre) => (
            <option key={nombre} value={nombre}>
              {nombre}
            </option>
          ))}
        </select>

        <button
          data-testid="enviar-escena"
          disabled={!(ready && seleccionada)}
          onClick={() => void enviarEscena(seleccionada)}
          style={{
            width: '100%',
            padding: '6px 0',
            cursor: ready ? 'pointer' : 'not-allowed',
            background: ready ? '#16a34a' : '#374151',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          Enviar escena (IMPORT)
        </button>

        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>Bitácora:</div>
        <div style={{ fontSize: 10, lineHeight: 1.6 }}>
          {log.map((entrada) => (
            <div
              key={`${entrada.hora}-${entrada.texto}`}
              style={{ color: entrada.entrante ? '#86efac' : '#93c5fd' }}
            >
              {entrada.hora} {entrada.texto}
            </div>
          ))}
        </div>
      </div>

      <iframe ref={iframeRef} src="/" style={{ flex: 1, border: 'none' }} title="Pascal Editor" />
    </div>
  )
}
