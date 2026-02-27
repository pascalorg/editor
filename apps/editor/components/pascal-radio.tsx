'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Howl } from 'howler'
import { Disc3, Settings2, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import useAudio from '@/store/use-audio'

const PLAYLIST = [
  {
    title: 'Ballroom in Miniature',
    file: '/audios/radios/classic/Ballroom in Miniature.mp3',
  },
  {
    title: 'Blueprints in Springtime',
    file: '/audios/radios/classic/Blueprints in Springtime.mp3',
  },
  {
    title: 'Clockwork Tea Party',
    file: '/audios/radios/classic/Clockwork Tea Party.mp3',
  },
  {
    title: 'Clockwork Tea Party (Alternate)',
    file: '/audios/radios/classic/Clockwork Tea Party (Alternate).mp3',
  },
  {
    title: 'Clockwork Teacups',
    file: '/audios/radios/classic/Clockwork Teacups.mp3',
  },
  {
    title: 'Evening in the Parlor',
    file: '/audios/radios/classic/Evening in the Parlor.mp3',
  },
  {
    title: 'Glass Atrium',
    file: '/audios/radios/classic/Glass Atrium.mp3',
  },
  {
    title: 'Moonlight On The Drafting Table',
    file: '/audios/radios/classic/Moonlight On The Drafting Table.mp3',
  },
  {
    title: 'Sunlit Garden Reverie',
    file: '/audios/radios/classic/Sunlit Garden Reverie.mp3',
  },
  {
    title: 'Sunlit Waltz in Pastel Hues',
    file: '/audios/radios/classic/Sunlit Waltz in Pastel Hues.mp3',
  },
]

// Shuffle array helper
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

export function PascalRadio() {
  const [shuffledPlaylist] = useState(() => shuffleArray(PLAYLIST))
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const { masterVolume, radioVolume, muted, isRadioPlaying, setRadioPlaying } = useAudio()
  const soundRef = useRef<Howl | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentTrack = shuffledPlaylist[currentTrackIndex]!

  // Calculate effective volume (masterVolume * radioVolume, both are 0-100)
  const effectiveVolume = (masterVolume / 100) * (radioVolume / 100)

  // Keep a ref so the track-init effect can read current volume/muted/isRadioPlaying
  // without those values being part of its dependency array (which would restart the song).
  const effectiveVolumeRef = useRef(effectiveVolume)
  const mutedRef = useRef(muted)
  const isPlayingRef = useRef(isRadioPlaying)
  effectiveVolumeRef.current = effectiveVolume
  mutedRef.current = muted
  isPlayingRef.current = isRadioPlaying

  const handleNext = useCallback(() => {
    setCurrentTrackIndex((prev) => (prev + 1) % shuffledPlaylist.length)
  }, [shuffledPlaylist.length])

  const handlePrevious = useCallback(() => {
    setCurrentTrackIndex((prev) => (prev - 1 + shuffledPlaylist.length) % shuffledPlaylist.length)
  }, [shuffledPlaylist.length])

  // Initialize Howler only when the track changes — not on volume/mute/play-state changes.
  // Volume and mute are handled by the separate effect below.
  useEffect(() => {
    if (soundRef.current) {
      soundRef.current.unload()
    }

    const wasPlaying = isPlayingRef.current

    soundRef.current = new Howl({
      src: [currentTrack.file],
      volume: mutedRef.current ? 0 : effectiveVolumeRef.current,
      onend: handleNext,
    })

    if (wasPlaying && !mutedRef.current) {
      soundRef.current?.play()
    }

    return () => {
      soundRef.current?.unload()
    }
  }, [handleNext, currentTrack.file])

  // Update volume when settings change
  useEffect(() => {
    if (soundRef.current) {
      soundRef.current.volume(muted ? 0 : effectiveVolume)

      // Pause if muted, resume if unmuted and was playing
      if (muted && isRadioPlaying) {
        soundRef.current.pause()
      } else if (!muted && isRadioPlaying && !soundRef.current.playing()) {
        soundRef.current.play()
      } else if (!isRadioPlaying && soundRef.current.playing()) {
        soundRef.current.pause()
      }
    }
  }, [effectiveVolume, muted, isRadioPlaying])

  const handlePlayPause = () => {
    if (!soundRef.current || muted) return

    if (isRadioPlaying) {
      soundRef.current.pause()
    } else {
      soundRef.current.play()
    }
    setRadioPlaying(!isRadioPlaying)
  }

  const handleVolumeChange = (value: number[]) => {
    useAudio.setState({ radioVolume: value[0] })
  }

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <motion.div
      ref={containerRef}
      layout
      onClick={() => {
        if (!isOpen) setIsOpen(true)
      }}
      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
      className={cn(
        'flex flex-col rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-md overflow-hidden',
        !isOpen && 'cursor-pointer hover:bg-accent/90 transition-colors',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
        <div className="flex items-center gap-2">
          <Disc3 className={cn('h-4 w-4 shrink-0', isRadioPlaying && 'animate-spin')} />
          <span className="hidden sm:inline whitespace-nowrap">Radio Pascal</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            onClick={(e) => {
              e.stopPropagation()
              handlePlayPause()
            }}
            className="rounded-sm p-1 transition-all cursor-pointer bg-accent/30 hover:bg-accent hover:text-accent-foreground hover:shadow-sm"
            role="button"
            tabIndex={0}
            aria-label={isRadioPlaying ? 'Pause' : 'Play'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                handlePlayPause()
              }
            }}
          >
            {isRadioPlaying ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen(!isOpen)
            }}
            className={cn(
              'rounded-sm p-1 transition-all cursor-pointer hover:bg-accent hover:text-accent-foreground',
              isOpen && 'bg-accent text-accent-foreground',
            )}
            aria-label="Radio Settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          >
            <div className="px-3 pb-3 space-y-3 w-[16rem]">
              <div className="h-px w-full bg-border/50 mb-3" />
              {/* Current song info with prev/next */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Now Playing</p>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={handlePrevious}
                    className="rounded-full p-1.5 transition-colors hover:bg-accent shrink-0"
                    aria-label="Previous"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <p
                    className="text-sm font-medium text-center flex-1 truncate"
                    title={currentTrack.title}
                  >
                    {currentTrack.title}
                  </p>
                  <button
                    onClick={handleNext}
                    className="rounded-full p-1.5 transition-colors hover:bg-accent shrink-0"
                    aria-label="Next"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Volume control */}
              <div className="flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Slider
                  value={[radioVolume]}
                  onValueChange={handleVolumeChange}
                  max={100}
                  step={1}
                  className="flex-1"
                  aria-label="Radio Volume"
                />
                <span className="w-8 text-right text-xs text-muted-foreground shrink-0">
                  {radioVolume}%
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
