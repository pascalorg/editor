'use client'

import { type AnyNodeId, type CadUnderlayNode, useScene } from '@pascal-app/core'
import { useCallback, useState } from 'react'
import type { ImportCadResult } from '../components/ui/dialogs/import-cad-dialog'
import { analyzeCadFile, type CadImportAnalysis, commitCadImport } from '../lib/cad-import'

/**
 * The CAD import flow: pick a file, look at what came out, commit it to a
 * level.
 *
 * Analysis is deliberately separate from the commit. Every real drawing
 * carries surprises — decoration layers that dwarf the architecture, missing
 * units, several sheets side by side — and the user has to see them before
 * anything lands in the scene.
 */
export function useCadImport(levelId: string | null) {
  const createNode = useScene((s) => s.createNode)
  const [analysis, setAnalysis] = useState<CadImportAnalysis | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = useCallback(async (file: File) => {
    setError(null)
    setBusy(true)
    setSourceFile(file)
    try {
      setAnalysis(await analyzeCadFile(file))
    } catch (err) {
      setAnalysis(null)
      setError(err instanceof Error ? err.message : 'That file could not be read as a DXF.')
    } finally {
      setBusy(false)
    }
  }, [])

  const cancel = useCallback(() => {
    setAnalysis(null)
    setSourceFile(null)
    setError(null)
  }, [])

  const confirm = useCallback(
    async ({ metersPerUnit, hiddenLayers }: ImportCadResult): Promise<CadUnderlayNode | null> => {
      if (!(analysis && levelId)) return null
      setBusy(true)
      try {
        const node = await commitCadImport({
          analysis,
          levelId,
          metersPerUnit,
          hiddenLayers,
          createNode: (created, parentId) => createNode(created, parentId as AnyNodeId),
          sourceFile: sourceFile ?? undefined,
        })
        setAnalysis(null)
        setSourceFile(null)
        return node
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The drawing could not be imported.')
        return null
      } finally {
        setBusy(false)
      }
    },
    [analysis, levelId, sourceFile, createNode],
  )

  return { analysis, error, busy, open, cancel, confirm }
}
