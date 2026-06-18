import { z } from 'zod'

const localSceneThumbnailPath = z
  .string()
  .regex(/^\/scene-thumbnails\/[A-Za-z0-9_-]+\.(?:png|jpg|webp)(?:\?v=\d+)?$/)

export const sceneThumbnailUrlSchema = z
  .union([z.string().url(), localSceneThumbnailPath])
  .nullable()
  .optional()
