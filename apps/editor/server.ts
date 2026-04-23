import { createServer } from 'node:http'
import { parse } from 'node:url'
import next from 'next'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = 3002
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
const subClient = pubClient.duplicate()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  })

  io.adapter(createAdapter(pubClient, subClient))

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    socket.on('join-project', (projectId) => {
      socket.join(`project:${projectId}`)
      console.log(`User ${socket.id} joined project: ${projectId}`)
    })

    socket.on('node-update', (data) => {
      // data: { projectId, nodeId, updates }
      socket.to(`project:${data.projectId}`).emit('node-update', data)
    })

    socket.on('node-create', (data) => {
      socket.to(`project:${data.projectId}`).emit('node-create', data)
    })

    socket.on('node-delete', (data) => {
      socket.to(`project:${data.projectId}`).emit('node-delete', data)
    })

    socket.on('presence', (data) => {
      // data: { projectId, userId, cursor: [x,y,z], selection: [] }
      socket.to(`project:${data.projectId}`).emit('presence', data)
    })

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)
    })
  })

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
