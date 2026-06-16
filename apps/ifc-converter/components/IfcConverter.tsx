'use client'

import { convertIfcToPascal, type PascalSceneGraph } from '@pascal-app/ifc-converter'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { availableTestFiles, exampleFileUrl, testFiles } from '@/lib/test-files'

// The viewer uses three's WebGPU renderer + the registry-driven scene
// store, neither of which run during SSR — dynamic-import with ssr:false
// so the bundle doesn't hit the server.
const PascalViewer = dynamic(() => import('./PascalSceneViewer'), { ssr: false })

type Status = 'idle' | 'loading' | 'converting' | 'ready' | 'error'

// The converter writes a fixed shape into BaseNode.metadata, but the
// underlying type is z.json() — a loose JSON value. This helper gives
// the UI dot-access on the fields the converter actually writes.
type ConverterMetadata = {
  ifcType?: string
  expressID?: number
  globalId?: string
  levelId?: string
  elevation?: number
  material?: string
  typeName?: string
  properties?: Record<string, Record<string, string | number | boolean>>
  [key: string]: unknown
}

function meta(node: { metadata?: unknown } | null | undefined): ConverterMetadata {
  return (node?.metadata ?? {}) as ConverterMetadata
}

export default function IfcConverter() {
  const [pascalData, setPascalData] = useState<PascalSceneGraph | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<string>('01-duplex.ifc')
  const [ifcData, setIfcData] = useState<Uint8Array | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(new Set())
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [conversionProgress, setConversionProgress] = useState<number>(0)
  const [conversionMessage, setConversionMessage] = useState<string>('')

  const levels = useMemo(() => {
    if (!pascalData) return []
    return Object.values(pascalData.nodes)
      .filter((n) => n.type === 'level')
      .sort((a, b) => (meta(a).elevation ?? 0) - (meta(b).elevation ?? 0))
      .map((n) => ({ id: n.id, name: n.name ?? n.id, elevation: meta(n).elevation ?? 0 }))
  }, [pascalData])

  const typeCounts = useMemo(() => {
    if (!pascalData) return {}
    const counts: Record<string, number> = {}
    for (const n of Object.values(pascalData.nodes)) {
      counts[n.type] = (counts[n.type] || 0) + 1
    }
    return counts
  }, [pascalData])

  const elementTypes = useMemo(() => {
    const order = ['wall', 'slab', 'door', 'window', 'stair', 'roof', 'column', 'item']
    return order.filter((t) => typeCounts[t])
  }, [typeCounts])

  useEffect(() => {
    if (levels.length > 0) {
      setVisibleLevels(new Set(levels.map((l) => l.id)))
    }
  }, [levels])

  useEffect(() => {
    if (elementTypes.length > 0) {
      setVisibleTypes(new Set(elementTypes))
    }
  }, [elementTypes])

  const searchResults = useMemo(() => {
    if (!pascalData || !searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const results: { id: string; name: string; type: string; match: string }[] = []
    for (const node of Object.values(pascalData.nodes)) {
      if (['site', 'building', 'level'].includes(node.type)) continue
      const m = meta(node)
      let match: string | null = null
      if (node.name?.toLowerCase().includes(q)) match = `Name: ${node.name}`
      else if (node.type.includes(q)) match = `Type: ${node.type}`
      else if (m.ifcType?.toLowerCase().includes(q)) match = `IFC: ${m.ifcType}`
      else if (m.typeName?.toLowerCase().includes(q)) match = `Type: ${m.typeName}`
      else if (m.material?.toLowerCase().includes(q)) match = `Material: ${m.material}`
      else if (m.globalId?.toLowerCase().includes(q)) match = `ID: ${m.globalId}`
      else if (m.properties) {
        for (const [psetName, props] of Object.entries(m.properties) as [string, any][]) {
          for (const [k, v] of Object.entries(props)) {
            if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
              match = `${psetName}: ${k} = ${v}`
              break
            }
          }
          if (match) break
        }
      }
      if (match) {
        results.push({ id: node.id, name: node.name ?? node.id, type: node.type, match })
        if (results.length >= 50) break
      }
    }
    return results
  }, [pascalData, searchQuery])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount to load the initial file from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('file')
    const matched = testFiles.some((f) => f.name === requested)
    const initial = matched ? requested! : '01-duplex.ifc'
    loadExampleFile(initial)
    if (matched) {
      document.getElementById('try')?.scrollIntoView({ block: 'start' })
    }
  }, [])

  const loadAndConvert = async (data: Uint8Array, name: string) => {
    setFileName(name)
    setStatus('converting')
    setSearchQuery('')
    setSelectedNodeId(null)
    setConversionProgress(0)
    setConversionMessage('Starting conversion...')

    try {
      const result = await convertIfcToPascal(data, (message, percent) => {
        setConversionMessage(message)
        setConversionProgress(percent)
      })
      setPascalData(result)
      setStatus('ready')
      setConversionProgress(100)
      setConversionMessage('Conversion complete!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed')
      setStatus('error')
      setConversionProgress(0)
    }
  }

  const loadExampleFile = async (filename: string) => {
    setStatus('loading')
    setSelectedFile(filename)
    setError(null)

    const params = new URLSearchParams(window.location.search)
    if (params.get('file') !== filename) {
      params.set('file', filename)
      const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`
      window.history.replaceState(null, '', newUrl)
    }

    try {
      const file = testFiles.find((f) => f.name === filename)
      const url = file ? exampleFileUrl(file) : `/test-ifc-files/${filename}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Could not load ${filename} (${response.status})`)
      const arrayBuffer = await response.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      setIfcData(uint8Array)
      await loadAndConvert(uint8Array, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
      setStatus('error')
    }
  }

  const handleFile = async (file: File) => {
    setStatus('loading')
    setError(null)
    setSelectedFile('')

    const params = new URLSearchParams(window.location.search)
    if (params.has('file')) {
      params.delete('file')
      const qs = params.toString()
      const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', newUrl)
    }

    try {
      const arrayBuffer = await file.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      setIfcData(uint8Array)
      await loadAndConvert(uint8Array, file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
      setStatus('error')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable drop handler; handleFile only calls setState setters, so a mount-time capture stays correct.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.toLowerCase().endsWith('.ifc')) {
      handleFile(file)
    } else {
      setError('Please drop a valid IFC file')
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const downloadPascalJson = () => {
    if (!pascalData) return
    const json = JSON.stringify(pascalData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace('.ifc', '')}_pascal.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadIfc = () => {
    if (!ifcData) return
    const blob = new Blob([ifcData as any], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyJsonToClipboard = () => {
    if (!pascalData) return
    const json = JSON.stringify(pascalData, null, 2)
    navigator.clipboard.writeText(json)
  }

  const isWorking = status === 'loading' || status === 'converting'

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900">Try It</h2>
        <p className="text-sm text-gray-500 mt-1">Upload an IFC file or pick an example below</p>
      </div>

      {/* Upload — compact */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-50 scale-[1.01]'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        }`}
      >
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="file" accept=".ifc" onChange={handleFileInput} className="hidden" />
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="text-sm text-gray-600">
            Drop an IFC file here or{' '}
            <span className="text-blue-600 font-medium">browse to upload</span>
          </span>
        </label>
      </div>

      {/* Example IFC files — 2 rows x 5 cards */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
          Or pick an example
        </p>
        <div className="grid grid-cols-5 gap-3">
          {availableTestFiles().map((file) => (
            <button
              key={file.name}
              onClick={() => loadExampleFile(file.name)}
              disabled={isWorking}
              className={`rounded-lg border p-3 text-left transition-all ${
                selectedFile === file.name
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              } ${isWorking ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <p
                className={`text-sm font-medium truncate ${
                  selectedFile === file.name ? 'text-blue-700' : 'text-gray-900'
                }`}
              >
                {file.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{file.detail}</p>
              <p className="text-xs text-gray-500 mt-1">{file.description}</p>
              {file.warning && (
                <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
                  <span aria-hidden>⚠️</span>
                  <span>{file.warning}</span>
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {status === 'error' && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Results — always rendered once we have data, with loading overlay */}
      {(pascalData || isWorking) && (
        <div className="space-y-4">
          {/* Header with stats and download buttons */}
          {pascalData && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">{fileName}</h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {Object.keys(pascalData.nodes).length} nodes
                  </span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {new Set(Object.values(pascalData.nodes).map((n) => n.type)).size} types
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadIfc}
                    className="px-3 py-1.5 text-sm font-medium bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors"
                  >
                    Download IFC
                  </button>
                  <button
                    onClick={downloadPascalJson}
                    className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Download Pascal JSON
                  </button>
                </div>
              </div>

              {/* Type filter */}
              {elementTypes.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Types
                  </span>
                  <button
                    onClick={() => setVisibleTypes(new Set(elementTypes))}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                  >
                    All
                  </button>
                  {elementTypes.map((t) => {
                    const active = visibleTypes.has(t)
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          const next = new Set(visibleTypes)
                          if (active) next.delete(t)
                          else next.add(t)
                          setVisibleTypes(next)
                        }}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          active
                            ? 'bg-gray-800 text-white border-gray-800'
                            : 'bg-white text-gray-400 border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {typeCounts[t]} {t}
                        {(typeCounts[t] ?? 0) > 1 ? 's' : ''}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Level filter */}
              {levels.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Levels
                  </span>
                  <button
                    onClick={() => setVisibleLevels(new Set(levels.map((l) => l.id)))}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setVisibleLevels(new Set())}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                  >
                    None
                  </button>
                  {levels.map((level) => {
                    const active = visibleLevels.has(level.id)
                    return (
                      <button
                        key={level.id}
                        onClick={() => {
                          const next = new Set(visibleLevels)
                          if (active) next.delete(level.id)
                          else next.add(level.id)
                          setVisibleLevels(next)
                        }}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-400 border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {level.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search elements by name, type, material, property..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setSearchOpen(true)
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSearchOpen(false)
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    &times;
                  </button>
                )}
                {searchOpen && searchQuery.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-400 text-center">No results</div>
                    ) : (
                      searchResults.map((r) => (
                        <button
                          key={r.id}
                          className={`w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-gray-50 last:border-0 ${
                            selectedNodeId === r.id ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => {
                            setSelectedNodeId(r.id)
                            setSearchOpen(false)
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                              {r.type}
                            </span>
                            <span className="text-sm text-gray-900 truncate">{r.name}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{r.match}</p>
                        </button>
                      ))
                    )}
                    {searchResults.length >= 50 && (
                      <div className="px-3 py-2 text-xs text-gray-400 text-center">
                        Showing first 50 results
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Pascal 3D Viewer */}
          <div className="flex gap-4">
            <div className="flex-1 min-w-0 relative">
              {/* Loading overlay */}
              {isWorking && (
                <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm rounded-lg flex flex-col items-center justify-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600"></div>
                  <p className="font-medium text-gray-900 text-sm">
                    {status === 'loading' ? 'Loading file...' : 'Converting to Pascal'}
                  </p>
                  {status === 'converting' && (
                    <div className="w-48 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">{conversionMessage}</span>
                        <span className="text-blue-600 font-medium">{conversionProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-blue-600 h-full rounded-full transition-all duration-300"
                          style={{ width: `${conversionProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {pascalData && (
                <PascalViewer sceneGraph={pascalData} onSelectNode={setSelectedNodeId} />
              )}
              {!pascalData && <div className="w-full h-[600px] bg-gray-900 rounded-lg" />}
              <p className="text-xs text-gray-400 mt-1">
                Orbit (left click) / Pan (right click) / Zoom (scroll) / Click element to inspect
              </p>
            </div>
            {selectedNodeId &&
              Boolean(
                (pascalData?.nodes as Record<string, unknown> | undefined)?.[selectedNodeId],
              ) &&
              (() => {
                const node = (pascalData!.nodes as Record<string, any>)[selectedNodeId] as any
                const meta = node.metadata ?? {}
                const Row = ({ k, v }: { k: string; v: string }) => (
                  <div className="flex justify-between text-xs gap-2">
                    <span className="text-gray-500 shrink-0">{k}</span>
                    <span className="text-gray-900 font-mono text-right truncate" title={v}>
                      {v}
                    </span>
                  </div>
                )
                return (
                  <div className="w-80 shrink-0 max-h-[600px] overflow-y-auto">
                    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2 sticky top-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">
                          {node.name ?? node.type}
                        </h3>
                        <button
                          onClick={() => setSelectedNodeId(null)}
                          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                        >
                          &times;
                        </button>
                      </div>

                      <div className="space-y-1 pb-2 border-b border-gray-100">
                        <Row k="Type" v={node.type} />
                        {meta.typeName && <Row k="Type Name" v={meta.typeName} />}
                        {meta.ifcType && <Row k="IFC Type" v={meta.ifcType} />}
                        {meta.globalId && <Row k="Global ID" v={meta.globalId} />}
                        {meta.expressID != null && (
                          <Row k="Express ID" v={String(meta.expressID)} />
                        )}
                        {meta.levelId && (
                          <Row
                            k="Level"
                            v={pascalData!.nodes[meta.levelId]?.name ?? meta.levelId}
                          />
                        )}
                      </div>

                      {(node.start ||
                        node.thickness != null ||
                        node.height != null ||
                        node.width != null ||
                        node.elevation != null ||
                        node.polygon) && (
                        <div className="space-y-1 pb-2 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Geometry
                          </p>
                          {node.start && (
                            <Row
                              k="Start"
                              v={`[${node.start.map((v: number) => v.toFixed(2)).join(', ')}]`}
                            />
                          )}
                          {node.end && (
                            <Row
                              k="End"
                              v={`[${node.end.map((v: number) => v.toFixed(2)).join(', ')}]`}
                            />
                          )}
                          {node.thickness != null && (
                            <Row k="Thickness" v={`${node.thickness.toFixed(3)} m`} />
                          )}
                          {node.height != null && (
                            <Row k="Height" v={`${node.height.toFixed(3)} m`} />
                          )}
                          {node.width != null && <Row k="Width" v={`${node.width.toFixed(3)} m`} />}
                          {node.position != null && node.type !== 'wall' && (
                            <Row
                              k="Position"
                              v={`[${node.position.map((v: number) => v.toFixed(2)).join(', ')}]`}
                            />
                          )}
                          {node.elevation != null && (
                            <Row k="Elevation" v={`${node.elevation.toFixed(3)} m`} />
                          )}
                          {node.sillHeight != null && (
                            <Row k="Sill Height" v={`${node.sillHeight.toFixed(3)} m`} />
                          )}
                          {node.polygon && <Row k="Polygon" v={`${node.polygon.length} points`} />}
                        </div>
                      )}

                      {(meta.material || meta.materialLayers) && (
                        <div className="space-y-1 pb-2 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Material
                          </p>
                          {meta.material && <Row k="Name" v={meta.material} />}
                          {meta.materialLayers?.map((l: any, i: number) => (
                            <Row
                              key={i}
                              k={l.name}
                              v={
                                l.thickness != null ? `${(l.thickness * 1000).toFixed(0)} mm` : '-'
                              }
                            />
                          ))}
                        </div>
                      )}

                      {meta.properties &&
                        Object.entries(meta.properties).map(([psetName, props]: [string, any]) => (
                          <div key={psetName} className="space-y-1 pb-2 border-b border-gray-100">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              {psetName}
                            </p>
                            {Object.entries(props).map(([k, v]: [string, any]) => (
                              <Row key={k} k={k} v={String(v)} />
                            ))}
                          </div>
                        ))}
                    </div>
                  </div>
                )
              })()}
          </div>
        </div>
      )}

      {/* JSON Drawer - fixed position from top (shows when ready and showJson is true) */}
      {status === 'ready' && pascalData && showJson && (
        <div className="fixed right-0 top-0 h-screen w-96 bg-gray-900 shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300">Pascal JSON</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={copyJsonToClipboard}
                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded"
                title="Copy to clipboard"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setShowJson(false)}
                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="text-green-400 text-xs font-mono">
              {JSON.stringify(pascalData, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* JSON toggle button - fixed position (shows when ready and showJson is false) */}
      {status === 'ready' && pascalData && !showJson && (
        <button
          onClick={() => setShowJson(true)}
          className="fixed right-6 top-24 bg-gray-900 text-white shadow-xl hover:bg-gray-800 transition-all z-10 group rounded-lg px-4 py-2"
          title="Show JSON preview"
        >
          <div className="flex items-center gap-2">
            {/* Curly braces icon */}
            <span className="text-green-400 group-hover:text-green-300 transition-colors font-mono text-lg">
              &#123; &#125;
            </span>
            <span className="text-sm font-medium">JSON</span>
          </div>
        </button>
      )}
    </div>
  )
}
