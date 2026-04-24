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
      console.log(`User ${socket.id} joined project: ${projectId}`)

      // Initialize Y.Doc if it doesn't exist
      if (!docs.has(projectId)) {
        const doc = new Y.Doc()
        docs.set(projectId, doc)
        
        // We don't load from DB here yet, we'll let the first client 
        // who has the data upload the initial state if the doc is empty.
        // For a more robust system, we would load from S3/Prisma here.
      }

      const doc = docs.get(projectId)!
      
      // Send initial sync state to the joining user
      const stateVector = Y.encodeStateVector(doc)
      socket.emit('yjs-sync-step-1', stateVector)
    })

    socket.on('yjs-sync-step-1', (stateVector: Uint8Array) => {
      if (!currentProjectId) return
      const doc = docs.get(currentProjectId)
      if (!doc) return

      const update = Y.encodeStateAsUpdate(doc, stateVector)
      socket.emit('yjs-sync-step-2', update)
    })

    socket.on('yjs-sync-step-2', (update: Uint8Array) => {
      if (!currentProjectId) return
      const doc = docs.get(currentProjectId)
      if (!doc) return

      Y.applyUpdate(doc, update, 'remote')
    })

    socket.on('yjs-update', (update: Uint8Array) => {
      if (!currentProjectId) return
      const doc = docs.get(currentProjectId)
      if (!doc) return

      // Apply update locally to the server's doc
      Y.applyUpdate(doc, update, 'remote')
      
      // Broadcast update to others in the same project
      socket.to(`project:${currentProjectId}`).emit('yjs-update', update)
    })

    socket.on('awareness-update', (update: Uint8Array) => {
      if (!currentProjectId) return
      // Awareness is ephemeral, just broadcast it
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

