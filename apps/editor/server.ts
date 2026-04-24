import { createServer } from 'node:http'
import { parse } from 'node:url'
import next from 'next'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import * as Y from 'yjs'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = 3002
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const pubClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null
const subClient = pubClient ? pubClient.duplicate() : null

// In-memory store for Yjs documents
const docs = new Map<string, Y.Doc>()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: {
      origin: dev ? '*' : (process.env.NEXTAUTH_URL || 'https://archly.cloud'),
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8 // 100MB for large scene syncs
  })

  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient))
    console.log('[Socket.io] Redis adapter enabled')
  } else {
    console.log('[Socket.io] Redis adapter disabled (standard in-memory mode)')
  }

  io.on('connection', (socket) => {
    let currentProjectId: string | null = null

    console.log('User connected:', socket.id)

    socket.on('join-project', (projectId) => {
      currentProjectId = projectId
      socket.join(`project:${projectId}`)
      console.log(`[Socket] User ${socket.id} joined project: ${projectId}`)

      if (!docs.has(projectId)) {
        console.log(`[Yjs] Initializing new doc for project: ${projectId}`)
        docs.set(projectId, new Y.Doc())
      }

      const doc = docs.get(projectId)!
      
      // Step 1: Send server's state vector to the client
      const stateVector = Y.encodeStateVector(doc)
      socket.emit('yjs-sync-step-1', stateVector)
    })

    socket.on('yjs-sync-step-1', (clientStateVector: Uint8Array) => {
      if (!currentProjectId) return
      const doc = docs.get(currentProjectId)
      if (!doc) return

      console.log(`[Yjs] Received sync-step-1 from ${socket.id} for project: ${currentProjectId}`)

      // Step 2: Send missing updates to the client based on their state vector
      const update = Y.encodeStateAsUpdate(doc, new Uint8Array(clientStateVector))
      socket.emit('yjs-sync-step-2', update)
    })

    socket.on('yjs-update', (update: Uint8Array) => {
      if (!currentProjectId) return
      const doc = docs.get(currentProjectId)
      if (!doc) return

      console.log(`[Yjs] Received update from ${socket.id} (size: ${update.length} bytes)`)

      try {
        // Apply update locally to the server's doc
        Y.applyUpdate(doc, new Uint8Array(update), 'remote')
        
        // Broadcast update to others in the same project
        socket.to(`project:${currentProjectId}`).emit('yjs-update', update)
      } catch (err) {
        console.error('[Yjs] Failed to apply update:', err)
      }
    })

    socket.on('awareness-update', (update: Uint8Array) => {
      if (!currentProjectId) return
      socket.to(`project:${currentProjectId}`).emit('awareness-update', update)
    })

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)
    })
  })

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})

