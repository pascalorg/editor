import type { MetadataRoute } from 'next'
import { siteConfig } from './seo'

export default function sitemap(): MetadataRoute.Sitemap {
  const currentDate = new Date()
  const baseUrl = siteConfig.url

  return [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/viewer/demo_1`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ]
}
