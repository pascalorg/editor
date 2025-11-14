import { z } from 'zod'
import { createId } from '@/lib/utils'

export const nodeId = (id: string) => z.string().transform(() => createId(id))
