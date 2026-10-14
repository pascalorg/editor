'use client'

import { applySceneOperationPatch, emitter, generateCollectionId, useScene } from '@pascal-app/core'
import { computeSceneBoundsXZ, useEditor, useViewer } from '@pascal-app/editor'
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { createIfcImportOperations } from './import-scene'
import styles from './panel.module.css'

type PanelStatus = {
  kind: 'idle' | 'working' | 'success' | 'warning' | 'error'
  message: string
}

function downloadText(text: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function IfcPanel() {
  const importFileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle', message: '' })
  const modelExport = useEditor((state) => state.modelExport)

  const importFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      setStatus({ kind: 'error', message: 'Choose an IFC (.ifc) file.' })
      return
    }

    setStatus({ kind: 'working', message: `Reading ${file.name}…` })
    try {
      const { convertIfcToPascal } = await import('@pascal-app/ifc-converter')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const graph = await convertIfcToPascal(
        bytes,
        (message) => setStatus({ kind: 'working', message }),
        { wasmPath: '/' },
      )
      const importToken = crypto.randomUUID().replaceAll('-', '')
      const importedNodeIds = new Map(
        Object.keys(graph.nodes).map((id): [string, string] => [id, `${id}_imp_${importToken}`]),
      )
      const importedCollectionIds = new Map(
        Object.keys(graph.collections ?? {}).map((id): [string, string] => [
          id,
          generateCollectionId(),
        ]),
      )
      const operations = createIfcImportOperations(
        graph,
        importToken,
        importedCollectionIds,
      )
      if (!operations.length) throw new Error('No importable elements were found in the IFC file.')

      const scene = useScene.getState()
      const nodesById = new Map(operations.map(({ node }) => [node.id, node]))
      const rootOffset = scene.rootNodeIds.length
      let rootCount = 0
      const nodeCreates = operations.map(({ node, parentId }) => {
        if (!parentId) {
          return { node, position: rootOffset + rootCount++ }
        }
        const parent = nodesById.get(parentId)
        const siblings = parent && 'children' in parent ? parent.children : []
        const position = siblings.indexOf(node.id)
        if (!parent || position < 0) {
          throw new Error(`Imported parent ${parentId} is missing child ${node.id}.`)
        }
        return { node, position }
      })
      const collectionChanges = Object.entries(graph.collections ?? {}).map(
        ([sourceId, collection]) => {
          const id = importedCollectionIds.get(sourceId) as typeof collection.id
          const nodeIds = collection.nodeIds
            .map((nodeId) => importedNodeIds.get(nodeId))
            .filter((nodeId): nodeId is string => nodeId !== undefined)
          const controlNodeId = collection.controlNodeId
            ? importedNodeIds.get(collection.controlNodeId)
            : undefined
          return {
            id,
            collection: {
              ...collection,
              id,
              nodeIds: nodeIds as typeof collection.nodeIds,
              ...(controlNodeId ? { controlNodeId: controlNodeId as typeof collection.controlNodeId } : {}),
            },
          }
        },
      )
      const imported = applySceneOperationPatch(
        {
          nodeUpdates: [],
          materialChanges: [],
          nodeCreates,
          nodeDeletes: [],
          collectionChanges,
        },
        { undoable: true },
      )
      if (!imported) throw new Error('Pascal could not add the converted model to this scene.')
      const building = operations.find(({ node }) => node.type === 'building')?.node
      const level = operations.find(({ node }) => node.type === 'level')?.node
      if (building?.type === 'building' && level?.type === 'level') {
        useViewer.getState().setSelection({
          buildingId: building.id,
          levelId: level.id,
          zoneId: null,
          selectedIds: [],
        })
      }
      const bounds = computeSceneBoundsXZ(operations.map(({ node }) => node))
      emitter.emit('camera-controls:fit-scene', bounds ? { bounds } : {})
      const types = new Set(operations.map(({ node }) => node.type))
      setStatus({
        kind: 'success',
        message: `Imported ${operations.length} elements from ${file.name} (${types.size} Pascal types).`,
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'IFC import failed.',
      })
    } finally {
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }, [])

  const onChooseFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      if (file) void importFile(file)
    },
    [importFile],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (file) void importFile(file)
    },
    [importFile],
  )

  const onExport = useCallback(async () => {
    if (!modelExport) {
      setStatus({ kind: 'error', message: 'The scene exporter is not ready yet.' })
      return
    }
    setStatus({ kind: 'working', message: 'Preparing IFC4 export…' })
    try {
      const scene = useScene.getState()
      const projectName = scene.rootNodeIds
        .map((id) => scene.nodes[id])
        .find((node) => node?.type === 'site')?.name
      const artifact = await modelExport('ifc', { projectName, download: false, onlyVisible: false })
      if (!artifact) throw new Error('Pascal could not export the current scene.')
      downloadText(await artifact.blob.text(), artifact.filename, 'application/x-step')
      setStatus({
        kind: artifact.warnings?.length ? 'warning' : 'success',
        message: artifact.warnings?.length
          ? `Exported ${artifact.filename}. ${artifact.warnings.join(' ')}`
          : `Exported ${artifact.filename}.`,
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'IFC export failed.',
      })
    }
  }, [modelExport])

  const isWorking = status.kind === 'working'

  return (
    <section className={styles.panel}>
      <p className={styles.intro}>
        Bring IFC building models into this scene, then export Pascal edits as IFC4.
      </p>

      <input
        ref={importFileRef}
        className={styles.hiddenInput}
        type="file"
        accept=".ifc,application/x-step"
        onChange={onChooseFile}
      />
      <div
        className={styles.dropzone}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <strong>Import an IFC model</strong>
        <span>Drop a .ifc file here or pick one from your computer.</span>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={isWorking}
          onClick={() => importFileRef.current?.click()}
        >
          Choose IFC file
        </button>
      </div>

      <div className={styles.exportRow}>
        <div>
          <strong>Export the current scene</strong>
          <span>Writes an IFC4 file from Pascal’s scene graph.</span>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={isWorking || !modelExport}
          onClick={() => void onExport()}
        >
          Export IFC
        </button>
      </div>

      {status.message && (
        <p className={`${styles.status} ${styles[status.kind]}`} role="status">
          {status.message}
        </p>
      )}
    </section>
  )
}
