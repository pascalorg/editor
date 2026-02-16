'use client'

import { Howl } from 'howler'
import { Disc3, Pause, Play, Settings2, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives/popover'
import { Switch } from '@/components/ui/primitives/switch'
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const { masterVolume, radioVolume, muted, autoplay, setAutoplay } = useAudio()
  const soundRef = useRef<Howl | null>(null)
  const hasAutoplayedRef = useRef(false)

  const currentTrack = shuffledPlaylist[currentTrackIndex]!

  // Calculate effective volume (masterVolume * radioVolume, both are 0-100)
  const effectiveVolume = (masterVolume / 100) * (radioVolume / 100)

  const handleNext = useCallback(() => {
    setCurrentTrackIndex((prev) => (prev + 1) % shuffledPlaylist.length)
  }, [shuffledPlaylist.length])

  const handlePrevious = useCallback(() => {
    setCurrentTrackIndex((prev) => (prev - 1 + shuffledPlaylist.length) % shuffledPlaylist.length)
  }, [shuffledPlaylist.length])

  // Initialize Howler when track changes
  useEffect(() => {
    // Clean up previous sound
    if (soundRef.current) {
      soundRef.current.unload()
    }

    const wasPlaying = isPlaying

    // Create new sound
    soundRef.current = new Howl({
      src: [currentTrack.file],
      volume: muted ? 0 : effectiveVolume,
      onend: handleNext,
    })

    // If was playing, play new track
    if (wasPlaying && !muted) {
      soundRef.current?.play()
    }

    return () => {
      soundRef.current?.unload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleNext, currentTrack.file, muted, isPlaying, effectiveVolume])

  // Update volume when settings change
  useEffect(() => {
    if (soundRef.current) {
      soundRef.current.volume(muted ? 0 : effectiveVolume)

      // Pause if muted, resume if unmuted and was playing
      if (muted && isPlaying) {
        soundRef.current.pause()
      } else if (!muted && isPlaying && !soundRef.current.playing()) {
        soundRef.current.play()
      }
    }
  }, [effectiveVolume, muted, isPlaying])

  // Autoplay on first user click
  useEffect(() => {
    if (!autoplay || hasAutoplayedRef.current || muted) return

    const handleFirstClick = () => {
      if (!soundRef.current || hasAutoplayedRef.current) return

      hasAutoplayedRef.current = true
      soundRef.current.play()
      setIsPlaying(true)

      // Remove listener after first click
      document.removeEventListener('click', handleFirstClick)
    }

    document.addEventListener('click', handleFirstClick)
    return () => {
      document.removeEventListener('click', handleFirstClick)
    }
  }, [autoplay, muted])

  const handlePlayPause = () => {
    if (!soundRef.current || muted) return

    if (isPlaying) {
      soundRef.current.pause()
    } else {
      soundRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleVolumeChange = (value: number[]) => {
    useAudio.setState({ radioVolume: value[0] })
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-md">
      <Disc3 className={cn('h-4 w-4', isPlaying && 'animate-spin')} />
      <span className="hidden sm:inline">Radio Pascal</span>
      <div
        onClick={handlePlayPause}
        className="rounded-sm p-1 transition-all cursor-pointer bg-accent/30 hover:bg-accent hover:text-accent-foreground hover:shadow-sm"
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handlePlayPause()
          }
        }}
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="rounded-sm p-1 transition-all cursor-pointer hover:bg-accent hover:text-accent-foreground"
            aria-label="Radio Settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="end">
          <div className="space-y-3">
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
                <p className="text-sm font-medium text-center flex-1 truncate">{currentTrack.title}</p>
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
              <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Slider
                value={[radioVolume]}
                onValueChange={handleVolumeChange}
                max={100}
                step={1}
                className="flex-1"
                aria-label="Radio Volume"
              />
              <span className="w-8 text-right text-xs text-muted-foreground">{radioVolume}%</span>
            </div>

            {/* Autoplay setting */}
            <div className="flex items-center justify-between pt-2 border-t">
              <label htmlFor="autoplay" className="text-sm font-medium cursor-pointer">
                Autoplay
              </label>
              <Switch
                id="autoplay"
                checked={autoplay}
                onCheckedChange={setAutoplay}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
