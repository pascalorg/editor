'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export const getSocket = () => {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002'
    console.log('[Socket] Initializing connection to:', url)
    socket = io(url)
  }
  return socket
}

export const joinProject = (projectId: string) => {
  const s = getSocket()
  s.emit('join-project', projectId)
}
