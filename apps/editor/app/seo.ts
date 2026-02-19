import { BASE_URL } from '@/lib/utils'

export const siteConfig = {
  name: 'Pascal Editor',
  description:
    'Pascal Editor is an open-source 3D building editor for designing, editing, and sharing home projects.',
  url: BASE_URL,
  website: 'editor.pascal.app',
  ogImage: '/og',
  keywords: [
    'Pascal Editor',
    'open-source 3D editor',
    '3D building editor',
    'home design software',
    'architecture editor',
    'collaborative design',
  ],
  twitterHandle: '@pascal_app',
  links: {
    github: 'https://github.com/pascalorg/editor',
  },
} as const
