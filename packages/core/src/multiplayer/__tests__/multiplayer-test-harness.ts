import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import type { SceneSnapshot } from '../../store/history-control'

// Protocol Message Codes
export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1

export type ClientRole = 'editor' | 'viewer'

export interface UserPresenceState {
  userId: string
  name: string
  role: ClientRole
  color: string
  cursor?: {
    worldPosition: [number, number, number] | null
    planPosition?: [number, number] | null
  } | null
  selection?: {
    selectedNodeIds: string[]
  } | null
  activeDrag?: {
    nodeId: string
    position: [number, number, number]
    rotation?: number
  } | null
  lastActive?: number
}

import {
  healSceneCycles,
  writeNodeToYMap,
  readNodeFromYMap,
  snapshotToYDoc,
  yDocToSnapshot,
  type CycleHealingResult,
} from '../index'

export {
  healSceneCycles,
  writeNodeToYMap,
  readNodeFromYMap,
  snapshotToYDoc,
  yDocToSnapshot,
  type CycleHealingResult,
}

// Server Room state
export interface CollabRoom {
  sceneId: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connections: Set<WebSocket>
  clientRoles: Map<WebSocket, ClientRole>
}

/**
 * In-Memory WebSocket Collaboration Server
 */
export class CollabServer {
  public server: http.Server
  public wss: WebSocketServer
  public port = 0
  public rooms = new Map<string, CollabRoom>()
  public droppedViewerPacketsCount = 0

  constructor() {
    this.server = http.createServer()
    this.wss = new WebSocketServer({ server: this.server })
    this.setupRoutes()
  }

  private setupRoutes() {
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sceneId = url.searchParams.get('sceneId') || 'default-scene'
      const role = (url.searchParams.get('role') as ClientRole) || 'editor'

      const room = this.getOrCreateRoom(sceneId)
      room.connections.add(ws)
      room.clientRoles.set(ws, role)

      // 1. Initial Sync Step 1
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, room.doc)
      ws.send(encoding.toUint8Array(encoder))

      // 2. Initial Awareness
      const awarenessStates = room.awareness.getStates()
      if (awarenessStates.size > 0) {
        const awarenessEncoder = encoding.createEncoder()
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(
            room.awareness,
            Array.from(awarenessStates.keys()),
          ),
        )
        ws.send(encoding.toUint8Array(awarenessEncoder))
      }

      // 3. Message Listener
      ws.on('message', (data: Buffer | ArrayBuffer) => {
        try {
          const uint8 = new Uint8Array(data as ArrayBuffer)
          const decoder = decoding.createDecoder(uint8)
          const messageType = decoding.readVarUint(decoder)

          if (messageType === MESSAGE_SYNC) {
            const clientRole = room.clientRoles.get(ws) ?? 'editor'
            const savedPos = decoder.pos
            const syncMessageType = decoding.readVarUint(decoder)

            // RBAC Enforcement: Drop sync step 2 / update mutations from readOnly viewer
            if (clientRole === 'viewer' && syncMessageType !== syncProtocol.messageYjsSyncStep1) {
              this.droppedViewerPacketsCount++
              return
            }

            // Reset decoder pos to before syncMessageType so readSyncMessage can read it
            decoder.pos = savedPos

            const responseEncoder = encoding.createEncoder()
            encoding.writeVarUint(responseEncoder, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, responseEncoder, room.doc, ws)

            if (encoding.length(responseEncoder) > 1 && ws.readyState === WebSocket.OPEN) {
              ws.send(encoding.toUint8Array(responseEncoder))
            }
          } else if (messageType === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(
              room.awareness,
              decoding.readVarUint8Array(decoder),
              ws,
            )
          }
        } catch (err) {
          console.error('[CollabServer] Error handling message:', err)
        }
      })

      ws.on('close', () => {
        room.connections.delete(ws)
        room.clientRoles.delete(ws)
      })
    })
  }

  public getOrCreateRoom(sceneId: string): CollabRoom {
    let room = this.rooms.get(sceneId)
    if (!room) {
      const doc = new Y.Doc()
      const awareness = new awarenessProtocol.Awareness(doc)

      // Broadcast doc updates to room peers
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        const msg = encoding.toUint8Array(encoder)

        for (const conn of room!.connections) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(msg)
          }
        }
      })

      // Broadcast awareness updates to room peers
      awareness.on('update', ({ added, updated, removed }: any, origin: unknown) => {
        const changedClients = added.concat(updated, removed)
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        )
        const msg = encoding.toUint8Array(encoder)

        for (const conn of room!.connections) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(msg)
          }
        }
      })

      room = {
        sceneId,
        doc,
        awareness,
        connections: new Set(),
        clientRoles: new Map(),
      }
      this.rooms.set(sceneId, room)
    }
    return room
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as AddressInfo).port
        resolve(this.port)
      })
    })
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      for (const room of this.rooms.values()) {
        for (const ws of room.connections) {
          ws.terminate()
        }
        room.doc.destroy()
        room.awareness.destroy()
      }
      this.rooms.clear()

      this.wss.close((err) => {
        if (err) return reject(err)
        this.server.close((serverErr) => {
          if (serverErr) return reject(serverErr)
          resolve()
        })
      })
    })
  }
}

/**
 * Simulated Multiplayer Client
 */
export class SimulatedMultiplayerClient {
  public doc: Y.Doc
  public awareness: awarenessProtocol.Awareness
  public undoManager: Y.UndoManager
  public ws: WebSocket | null = null
  public isConnected = false
  public role: ClientRole
  public userId: string
  public sceneId: string
  private serverPort: number

  constructor(role: ClientRole, userId: string, sceneId: string, serverPort: number) {
    this.role = role
    this.userId = userId
    this.sceneId = sceneId
    this.serverPort = serverPort
    this.doc = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)

    // Local-scoped undo manager
    const yNodes = this.doc.getMap('nodes')
    const yRootNodeIds = this.doc.getArray('rootNodeIds')
    const yMaterials = this.doc.getMap('materials')
    const yCollections = this.doc.getMap('collections')
    this.undoManager = new Y.UndoManager([yNodes, yRootNodeIds, yMaterials, yCollections], {
      trackedOrigins: new Set(['local']),
    })

    // Outbound CRDT update broadcast
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (
        (origin === 'local' || origin === this.undoManager) &&
        this.ws &&
        this.ws.readyState === WebSocket.OPEN
      ) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        this.ws.send(encoding.toUint8Array(encoder))
      }
    })

    // Outbound Awareness update broadcast
    this.awareness.on('update', ({ added, updated, removed }: any, origin: unknown) => {
      if (origin === 'local' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const changedClients = added.concat(updated, removed)
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
        )
        this.ws.send(encoding.toUint8Array(encoder))
      }
    })
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.serverPort}/?sceneId=${encodeURIComponent(
        this.sceneId,
      )}&role=${this.role}&userId=${encodeURIComponent(this.userId)}`
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.isConnected = true
        // Set initial awareness
        this.awareness.setLocalStateField('user', {
          userId: this.userId,
          name: `User ${this.userId}`,
          role: this.role,
          color: this.role === 'editor' ? '#3B82F6' : '#10B981',
          lastActive: Date.now(),
        })

        // Send SyncStep1
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeSyncStep1(encoder, this.doc)
        this.ws!.send(encoding.toUint8Array(encoder))

        resolve()
      })

      this.ws.on('message', (data: Buffer | ArrayBuffer) => {
        try {
          const uint8 = new Uint8Array(data as ArrayBuffer)
          const decoder = decoding.createDecoder(uint8)
          const messageType = decoding.readVarUint(decoder)

          if (messageType === MESSAGE_SYNC) {
            const responseEncoder = encoding.createEncoder()
            encoding.writeVarUint(responseEncoder, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, responseEncoder, this.doc, 'remote')
            if (encoding.length(responseEncoder) > 1 && this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(encoding.toUint8Array(responseEncoder))
            }
          } else if (messageType === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(
              this.awareness,
              decoding.readVarUint8Array(decoder),
              'remote',
            )
          }
        } catch (err) {
          console.error(`[Client ${this.userId}] Message handling error:`, err)
        }
      })

      this.ws.on('error', (err) => {
        reject(err)
      })

      this.ws.on('close', () => {
        this.isConnected = false
      })
    })
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.isConnected = false
    }
  }

  // --- High-Level Scene Operations ---

  public addNode(node: AnyNode, options?: { parentId?: string; position?: number }): void {
    this.doc.transact(() => {
      const yNodes = this.doc.getMap<Y.Map<unknown>>('nodes')
      const yRootNodeIds = this.doc.getArray<string>('rootNodeIds')

      const finalNode: AnyNode = {
        ...node,
        parentId: options?.parentId ?? node.parentId ?? null,
      } as AnyNode

      let yNode = yNodes.get(node.id)
      if (!yNode) {
        yNode = new Y.Map<unknown>()
        yNodes.set(node.id, yNode)
      }
      writeNodeToYMap(yNode, finalNode)

      if (!finalNode.parentId) {
        const targetPos = options?.position ?? yRootNodeIds.length
        if (!yRootNodeIds.toArray().includes(node.id)) {
          yRootNodeIds.insert(Math.min(targetPos, yRootNodeIds.length), [node.id])
        }
      } else {
        const parentYNode = yNodes.get(finalNode.parentId)
        if (parentYNode) {
          const children = (parentYNode.get('children') as string[] | undefined) ?? []
          if (!children.includes(node.id)) {
            const nextChildren = [...children]
            const pos = options?.position ?? nextChildren.length
            nextChildren.splice(pos, 0, node.id)
            parentYNode.set('children', nextChildren)
          }
        }
      }
    }, 'local')
  }

  public updateNode(id: string, data: Partial<AnyNode>, removeFields: string[] = []): void {
    this.doc.transact(() => {
      const yNodes = this.doc.getMap<Y.Map<unknown>>('nodes')
      const yNode = yNodes.get(id)
      if (!yNode) return

      for (const field of removeFields) {
        yNode.delete(field)
      }

      for (const [key, val] of Object.entries(data)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          let nestedMap = yNode.get(key)
          if (!(nestedMap instanceof Y.Map)) {
            nestedMap = new Y.Map<unknown>()
            yNode.set(key, nestedMap)
          }
          const yNested = nestedMap as Y.Map<unknown>
          const record = val as Record<string, unknown>
          for (const [subKey, subVal] of Object.entries(record)) {
            yNested.set(subKey, subVal)
          }
          continue
        }
        yNode.set(key, val)
      }
    }, 'local')
  }

  public deleteNode(id: string): void {
    this.doc.transact(() => {
      const yNodes = this.doc.getMap<Y.Map<unknown>>('nodes')
      const yRootNodeIds = this.doc.getArray<string>('rootNodeIds')

      const yNode = yNodes.get(id)
      if (!yNode) return
      const parentId = yNode.get('parentId') as string | null | undefined

      yNodes.delete(id)

      if (!parentId) {
        const idx = yRootNodeIds.toArray().indexOf(id)
        if (idx !== -1) {
          yRootNodeIds.delete(idx, 1)
        }
      } else {
        const parentYNode = yNodes.get(parentId)
        if (parentYNode) {
          const children = (parentYNode.get('children') as string[] | undefined) ?? []
          parentYNode.set(
            'children',
            children.filter((cId) => cId !== id),
          )
        }
      }
    }, 'local')
  }

  public translateNode(id: string, position: [number, number, number]): void {
    this.updateNode(id, { position } as any)
  }

  public rotateNode(id: string, rotation: number | [number, number, number]): void {
    this.updateNode(id, { rotation } as any)
  }

  public scaleNode(id: string, dimensions: Record<string, number>): void {
    this.updateNode(id, dimensions as any)
  }

  public setSelection(nodeIds: string[]): void {
    this.awareness.setLocalStateField('selection', { selectedNodeIds: nodeIds })
  }

  public setCursor(
    worldPosition: [number, number, number] | null,
    planPosition?: [number, number] | null,
  ): void {
    this.awareness.setLocalStateField('cursor', { worldPosition, planPosition })
  }

  public setLiveDrag(
    nodeId: string,
    transform: { position: [number, number, number]; rotation?: number },
  ): void {
    this.awareness.setLocalStateField('activeDrag', {
      nodeId,
      position: transform.position,
      rotation: transform.rotation ?? 0,
    })
  }

  public clearLiveDrag(): void {
    this.awareness.setLocalStateField('activeDrag', null)
  }

  public stopCapturing(): void {
    this.undoManager.stopCapturing()
  }

  public undo(): void {
    this.undoManager.undo()
  }

  public redo(): void {
    this.undoManager.redo()
  }

  public getNode(id: string): AnyNode | undefined {
    const yNodes = this.doc.getMap<Y.Map<unknown>>('nodes')
    const yNode = yNodes.get(id)
    return yNode ? readNodeFromYMap(yNode) : undefined
  }

  public getSnapshot(): SceneSnapshot {
    return yDocToSnapshot(this.doc)
  }

  // --- Synchronization Waiters ---

  public async waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const startTime = Date.now()
    while (!predicate()) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout after ${timeoutMs}ms waiting for condition`)
      }
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  public async waitForSyncWith(targetDoc: Y.Doc, timeoutMs = 2000): Promise<void> {
    await this.waitForCondition(() => {
      const snapA = yDocToSnapshot(this.doc)
      const snapB = yDocToSnapshot(targetDoc)
      return JSON.stringify(snapA) === JSON.stringify(snapB)
    }, timeoutMs)
  }

  public async waitForAwareness(
    predicate: (states: Map<number, any>) => boolean,
    timeoutMs = 2000,
  ): Promise<void> {
    await this.waitForCondition(() => {
      return predicate(this.awareness.getStates())
    }, timeoutMs)
  }

  public destroy(): void {
    this.disconnect()
    this.undoManager.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }
}

/**
 * High-Level Test Harness
 */
export interface MultiplayerTestHarness {
  server: CollabServer
  editor: SimulatedMultiplayerClient
  viewer: SimulatedMultiplayerClient
  createClient: (role: ClientRole, userId?: string) => Promise<SimulatedMultiplayerClient>
  syncAll: (timeoutMs?: number) => Promise<void>
  assertConvergence: (timeoutMs?: number) => Promise<void>
  cleanup: () => Promise<void>
}

/**
 * Creates and initializes an ephemeral in-memory multiplayer test harness.
 */
export async function createMultiplayerTestHarness(options?: {
  sceneId?: string
  initialSnapshot?: SceneSnapshot
}): Promise<MultiplayerTestHarness> {
  const sceneId = options?.sceneId || `test-scene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const server = new CollabServer()
  const port = await server.start()

  if (options?.initialSnapshot) {
    const room = server.getOrCreateRoom(sceneId)
    snapshotToYDoc(options.initialSnapshot, room.doc)
  }

  const clients: SimulatedMultiplayerClient[] = []

  const createClient = async (role: ClientRole, userId?: string): Promise<SimulatedMultiplayerClient> => {
    const id = userId || `${role}-${clients.length + 1}`
    const client = new SimulatedMultiplayerClient(role, id, sceneId, port)
    await client.connect()
    clients.push(client)
    return client
  }

  const editor = await createClient('editor', 'editor-primary')
  const viewer = await createClient('viewer', 'viewer-primary')

  const syncAll = async (timeoutMs = 2000): Promise<void> => {
    const room = server.getOrCreateRoom(sceneId)
    for (const client of clients) {
      if (client.isConnected) {
        await client.waitForSyncWith(room.doc, timeoutMs)
      }
    }
  }

  const assertConvergence = async (timeoutMs = 2000): Promise<void> => {
    await syncAll(timeoutMs)
    const room = server.getOrCreateRoom(sceneId)
    const serverSnapshot = yDocToSnapshot(room.doc)
    const editorSnapshot = editor.getSnapshot()
    const viewerSnapshot = viewer.getSnapshot()

    if (JSON.stringify(editorSnapshot.nodes) !== JSON.stringify(viewerSnapshot.nodes)) {
      throw new Error(
        `Editor and Viewer node states diverged:\nEditor: ${JSON.stringify(
          editorSnapshot.nodes,
        )}\nViewer: ${JSON.stringify(viewerSnapshot.nodes)}`,
      )
    }
    if (JSON.stringify(editorSnapshot.rootNodeIds) !== JSON.stringify(viewerSnapshot.rootNodeIds)) {
      throw new Error(
        `Editor and Viewer rootNodeIds diverged:\nEditor: ${JSON.stringify(
          editorSnapshot.rootNodeIds,
        )}\nViewer: ${JSON.stringify(viewerSnapshot.rootNodeIds)}`,
      )
    }
    if (JSON.stringify(serverSnapshot.nodes) !== JSON.stringify(viewerSnapshot.nodes)) {
      throw new Error('Server and Viewer node states diverged')
    }
  }

  const cleanup = async (): Promise<void> => {
    for (const client of clients) {
      client.destroy()
    }
    await server.close()
  }

  // Ensure initial handshake sync is complete
  await syncAll()

  return {
    server,
    editor,
    viewer,
    createClient,
    syncAll,
    assertConvergence,
    cleanup,
  }
}
