'use client'

import { motion, useScroll, useTransform, useSpring, useMotionValue } from 'framer-motion'
import { useEffect, useRef } from 'react'

export default function LiquidBackground() {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  // Smooth mouse movement
  const smoothX = useSpring(mouseX, { damping: 20, stiffness: 100 })
  const smoothY = useSpring(mouseY, { damping: 20, stiffness: 100 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [mouseX, mouseY])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#fafafa]">
      {/* SVG Filter for gooey effect */}
      <svg className="hidden">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div className="absolute inset-0 filter blur-[80px] opacity-40 mix-blend-multiply" style={{ filter: 'url(#goo) blur(80px)' }}>
        {/* Animated Blobs */}
        <motion.div
          animate={{
            x: [0, 100, -50, 0],
            y: [0, -100, 50, 0],
            scale: [1, 1.2, 0.8, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-100 rounded-full"
        />
        <motion.div
          animate={{
            x: [0, -150, 100, 0],
            y: [0, 100, -150, 0],
            scale: [1, 0.9, 1.3, 1],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute top-1/2 right-1/4 w-[500px] h-[500px] bg-indigo-50 rounded-full"
        />
        <motion.div
          animate={{
            x: [0, 200, -100, 0],
            y: [0, -50, 150, 0],
            scale: [1, 1.1, 0.7, 1],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-violet-50 rounded-full"
        />

        {/* Mouse Following Blob */}
        <motion.div
          style={{
            x: smoothX,
            y: smoothY,
            translateX: '-50%',
            translateY: '-50%',
          }}
          className="absolute w-64 h-64 bg-white/60 rounded-full blur-3xl pointer-events-none"
        />
      </div>

      {/* Subtle Grid Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none" 
        style={{
          backgroundImage: `
            linear-gradient(to right, #888 1px, transparent 1px),
            linear-gradient(to bottom, #888 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          maskImage: 'linear-gradient(180deg, white, rgba(255,255,255,0))'
        }}
      />
    </div>
  )
}
