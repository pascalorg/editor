import * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { authenticateCollabConnection, type CollabAuthResult } from './auth-guard'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1

export interface CollabRoom {
  name: string
  sceneId: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Set<WebSocket>
  authMap: Map<WebSocket, CollabAuthResult>
}

export class CollabWebSocketServer {
  public server: http.Server
  public wss: WebSocketServer
  public rooms = new Map<string, CollabRoom>()
  public droppedViewerPacketsCount = 0

  constructor(server?: http.Server) {
    this.server = server ?? http.createServer()
    this.wss = new WebSocketServer({ noServer: true })
    this.setupUpgradeHandler()
    this.setupConnectionHandler()
  }

  private setupUpgradeHandler() {
    this.server.on('upgrade', async (req: http.IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      const match = url.pathname.match(/^\/collab\/v1\/scene:([^/]+)/)
      const sceneId = match ? match[1] : url.searchParams.get('sceneId') || 'default-scene'

      const auth = await authenticateCollabConnection(req, sceneId)
      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req, auth)
      })
    })
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, auth: CollabAuthResult) => {
      const room = this.getOrCreateRoom(auth.sceneId)
      room.conns.add(ws)
      room.authMap.set(ws, auth)

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
      ws.on('message', (message: Buffer | ArrayBuffer) => {
        try {
          const uint8 = new Uint8Array(message as ArrayBuffer)
          const decoder = decoding.createDecoder(uint8)
          const messageType = decoding.readVarUint(decoder)

          if (messageType === MESSAGE_SYNC) {
            const clientAuth = room.authMap.get(ws)
            const savedPos = decoder.pos
            const syncMessageType = decoding.readVarUint(decoder)

            // RBAC Guard: Drop sync step 2 / update mutations from readOnly viewer
            if (clientAuth?.readOnly && syncMessageType !== syncProtocol.messageYjsSyncStep1) {
              this.droppedViewerPacketsCount++
              return
            }

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
          console.error('[CollabServer] Error handling client message:', err)
        }
      })

      ws.on('close', () => {
        room.conns.delete(ws)
        room.authMap.delete(ws)
        if (room.conns.size === 0) {
          // Room idle
        }
      })
    })
  }

  public getOrCreateRoom(sceneId: string): CollabRoom {
    let room = this.rooms.get(sceneId)
    if (!room) {
      const doc = new Y.Doc()
      const awareness = new awarenessProtocol.Awareness(doc)

      // Broadcast Doc updates to all connected peers in room
      doc.on('update', (update: Uint8Array, origin: any) => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        const message = encoding.toUint8Array(encoder)

        for (const conn of room!.conns) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(message)
          }
        }
      })

      // Broadcast Awareness updates to all connected peers in room
      awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
        const changedClients = [...added, ...updated, ...removed]
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        )
        const message = encoding.toUint8Array(encoder)

        for (const conn of room!.conns) {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            conn.send(message)
          }
        }
      })

      room = {
        name: `scene:${sceneId}`,
        sceneId,
        doc,
        awareness,
        conns: new Set(),
        authMap: new Map(),
      }
      this.rooms.set(sceneId, room)
    }
    return room
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      for (const room of this.rooms.values()) {
        for (const conn of room.conns) {
          conn.close()
        }
        room.doc.destroy()
        room.awareness.destroy()
      }
      this.rooms.clear()
      this.wss.close(() => {
        if (this.server.listening) {
          this.server.close(() => resolve())
        } else {
          resolve()
        }
      })
    })
  }
}

export function createCollabWebSocketServer(server: http.Server): CollabWebSocketServer {
  return new CollabWebSocketServer(server)
}
