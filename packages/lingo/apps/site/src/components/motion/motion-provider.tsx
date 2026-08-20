'use client'

import { LazyMotion } from 'motion/react'
import type { ReactNode } from 'react'

// domMax (not domAnimation): docs-nav and tabs animate their active
// indicators with layout animations. The feature bundle is imported lazily so
// it splits out of the initial chunk; `strict` throws in dev if a full
// motion.* component sneaks back in (m.* only).
const loadFeatures = () => import('motion/react').then((mod) => mod.domMax)

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  )
}
