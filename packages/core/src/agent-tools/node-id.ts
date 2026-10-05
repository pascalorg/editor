import { z } from 'zod'

export const NodeId = z.string().min(1)
