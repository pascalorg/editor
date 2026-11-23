import { z } from 'zod'

export const WallTrimProfile = z.enum([
  'flat',
  'bevel',
  'triangle',
  'cove',
  'bullnose',
  'base-modern',
  'base-colonial',
  'base-shoe',
  'base-ogee',
  'crown-cove',
  'crown-ogee',
  'crown-craftsman',
  'crown-layered',
  'rail-rounded',
  'rail-ogee',
  'rail-picture',
  'rail-stepped',
])
export type WallTrimProfile = z.infer<typeof WallTrimProfile>
