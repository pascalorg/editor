'use client'

import { lazy, Suspense } from 'react'

const PoolSectionBar = lazy(async () => {
  const pool = await import('@pascal-app/plugin-pool')
  return { default: pool.PoolSectionBar }
})

export function PoolSectionBanner() {
  return (
    <div data-pool-section-global>
      <Suspense fallback={null}>
        <PoolSectionBar />
      </Suspense>
    </div>
  )
}
