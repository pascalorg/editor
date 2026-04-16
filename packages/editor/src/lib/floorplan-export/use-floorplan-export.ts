'use client'

import { useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store/use-viewer'
import { useCallback, useState } from 'react'

import { exportFloorplanAsPdf } from './pdf-export'
import { generateFloorplanSvg } from './svg-generator'

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export interface FloorplanExportOptions {
  projectName?: string
  scale?: number
  unit?: 'metric' | 'imperial'
  showDimensions?: boolean
  showGrid?: boolean
}

export function useFloorplanExport(opts: FloorplanExportOptions = {}) {
  const [isExporting, setIsExporting] = useState(false)

  // Scene data
  const nodes = useScene((s) => s.nodes)

  // Active level from viewer selection
  const levelId = useViewer((s) => s.selection?.levelId)

  // Derive level node and building rotation
  const levelNode = levelId ? (nodes[levelId] as any) : null

  // Find the building node to get its rotation
  const buildingRotationDeg = (() => {
    if (!levelNode) return 0
    for (const node of Object.values(nodes)) {
      if ((node as any).type === 'building') {
        const building = node as any
        const rotY = building.rotation?.[1] ?? 0
        return (rotY * 180) / Math.PI
      }
    }
    return 0
  })()

  // Find site name as fallback project name
  const projectName = (() => {
    if (opts.projectName) return opts.projectName
    for (const node of Object.values(nodes)) {
      if ((node as any).type === 'site') {
        return (node as any).name ?? 'Untitled Project'
      }
    }
    return 'Untitled Project'
  })()

  const canExport = !!levelNode

  const getFilename = (ext: string) => {
    const levelName = levelNode?.name ?? `level-${levelNode?.level ?? 0}`
    const date = new Date().toISOString().split('T')[0]
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
    return `${safe(projectName)}-${safe(levelName)}-${date}.${ext}`
  }

  const buildInput = () => ({
    levelNode,
    nodes,
    buildingRotationDeg,
    projectName,
    unit: opts.unit ?? 'metric',
    scale: opts.scale ?? 100,
    showDimensions: opts.showDimensions ?? true,
    showGrid: opts.showGrid ?? false,
  })

  const exportSvg = useCallback(() => {
    if (!canExport) return
    const svg = generateFloorplanSvg(buildInput())
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(blob, getFilename('svg'))
  }, [canExport, nodes, levelId, buildingRotationDeg, projectName, opts])

  const exportPdf = useCallback(async () => {
    if (!canExport) return
    setIsExporting(true)
    try {
      const svg = generateFloorplanSvg(buildInput())
      await exportFloorplanAsPdf(svg, getFilename('pdf'))
    } finally {
      setIsExporting(false)
    }
  }, [canExport, nodes, levelId, buildingRotationDeg, projectName, opts])

  return { exportSvg, exportPdf, canExport, isExporting }
}
