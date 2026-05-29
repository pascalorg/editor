'use client'

import { useEffect, useRef, useState } from 'react'

// Minimal test scene: Site → Building → Level → 4 walls + slab + ceiling
const TEST_SCENE = {
  nodes: {
    'site-test': {
      object: 'node',
      id: 'site-test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      children: ['building-test'],
    },
    'building-test': {
      object: 'node',
      id: 'building-test',
      type: 'building',
      parentId: 'site-test',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      children: ['level-test'],
    },
    'level-test': {
      object: 'node',
      id: 'level-test',
      type: 'level',
      parentId: 'building-test',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      level: 0,
      children: ['wall-n', 'wall-s', 'wall-e', 'wall-w', 'slab-test', 'ceiling-test'],
    },
    'wall-n': {
      object: 'node',
      id: 'wall-n',
      type: 'wall',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      start: [-4, 0],
      end: [4, 0],
      height: 3,
      thickness: 0.2,
      children: [],
    },
    'wall-s': {
      object: 'node',
      id: 'wall-s',
      type: 'wall',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      start: [4, -6],
      end: [-4, -6],
      height: 3,
      thickness: 0.2,
      children: [],
    },
    'wall-e': {
      object: 'node',
      id: 'wall-e',
      type: 'wall',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      start: [4, 0],
      end: [4, -6],
      height: 3,
      thickness: 0.2,
      children: [],
    },
    'wall-w': {
      object: 'node',
      id: 'wall-w',
      type: 'wall',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      start: [-4, -6],
      end: [-4, 0],
      height: 3,
      thickness: 0.2,
      children: [],
    },
    'slab-test': {
      object: 'node',
      id: 'slab-test',
      type: 'slab',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      points: [
        [-4, 0],
        [4, 0],
        [4, -6],
        [-4, -6],
      ],
      thickness: 0.2,
      children: [],
    },
    'ceiling-test': {
      object: 'node',
      id: 'ceiling-test',
      type: 'ceiling',
      parentId: 'level-test',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      points: [
        [-4, 0],
        [4, 0],
        [4, -6],
        [-4, -6],
      ],
      thickness: 0.1,
      height: 3,
      children: [],
    },
  },
  rootNodeIds: ['site-test'],
  collections: {},
}

export default function TestHoltmontPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [log, setLog] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  const appendLog = (msg: string) =>
    setLog((prev) => [`${new Date().toISOString().slice(11, 23)} ${msg}`, ...prev].slice(0, 50))

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null
      if (!data?.type) return

      if (data.type === 'PASCAL_READY') {
        appendLog('← PASCAL_READY received')
        setReady(true)
      } else if (data.type === 'HOLTMONT_3D_IMPORT_ACK') {
        appendLog('← HOLTMONT_3D_IMPORT_ACK received')
      } else if (data.type === 'HOLTMONT_3D_EXPORT') {
        const exportData = data.data as Record<string, unknown>
        appendLog(
          `← HOLTMONT_3D_EXPORT received (${Object.keys(exportData?.nodes ?? {}).length} nodes)`,
        )
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const sendScene = () => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    appendLog('→ Sending HOLTMONT_3D_IMPORT...')
    iframe.contentWindow.postMessage({ type: 'HOLTMONT_3D_IMPORT', projectData: TEST_SCENE }, '*')
  }

  const sendAgain = () => {
    setReady(false)
    sendScene()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace' }}>
      <div style={{ width: 280, padding: 16, borderRight: '1px solid #333', background: '#111', color: '#eee', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>Holtmont Bridge Test</h2>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: ready ? '#4ade80' : '#facc15', marginBottom: 8 }}>
            Editor status: {ready ? '✓ READY' : 'waiting…'}
          </div>
          <button
            disabled={!ready}
            onClick={sendScene}
            style={{ width: '100%', padding: '6px 0', marginBottom: 6, cursor: ready ? 'pointer' : 'not-allowed', background: ready ? '#16a34a' : '#374151', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12 }}
          >
            Send test scene (IMPORT)
          </button>
          <button
            onClick={sendAgain}
            style={{ width: '100%', padding: '6px 0', cursor: 'pointer', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12 }}
          >
            Force resend (reload test)
          </button>
        </div>

        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>Log (newest first):</div>
        <div style={{ fontSize: 10, lineHeight: 1.6 }}>
          {log.map((entry, i) => (
            <div key={i} style={{ color: entry.includes('←') ? '#86efac' : '#93c5fd' }}>
              {entry}
            </div>
          ))}
        </div>
      </div>

      <iframe
        ref={iframeRef}
        src="/"
        style={{ flex: 1, border: 'none' }}
        title="Pascal Editor"
      />
    </div>
  )
}
