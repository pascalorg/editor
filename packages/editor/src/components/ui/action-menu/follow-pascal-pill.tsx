'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../../../hooks/use-reduced-motion'
import useFollowPascal from '../../../store/use-follow-pascal'

/**
 * Offered while a build plays and the person has the camera: one press and the camera goes back to
 * following. It comes up from where the toolbar is (origin-aware) and goes the same way.
 */
export function FollowPascalPill() {
  const shows = useFollowPascal((state) => state.on && state.paused && state.building)
  const resume = useFollowPascal((state) => state.resume)
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {shows ? (
        <motion.button
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="-translate-x-1/2 fixed bottom-24 left-1/2 z-50 rounded-full border border-violet-400/40 bg-background/90 px-4 py-2 font-medium text-sm text-violet-200 shadow-xl backdrop-blur-md active:scale-[0.97]"
          exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.96 }}
          initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.96 }}
          onClick={resume}
          transition={reduced ? { duration: 0.12 } : { type: 'spring', bounce: 0, duration: 0.3 }}
          type="button"
        >
          Resume following
        </motion.button>
      ) : null}
    </AnimatePresence>
  )
}
