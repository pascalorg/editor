/**
 * The brand mark, path for path from the corporate asset — the same paths the
 * console's header uses, so the public pages and the signed-in application
 * carry one identity rather than a stand-in square.
 *
 * Colours are `fill` attributes rather than classes: an SVG `<style>` block
 * inside an HTML document is not scoped to its own svg, so two marks on one
 * page would fight over the same class name.
 */

const MARK_VIEW = '111.3 65.6 94.9 69.8'

const MARK_PATHS = [
  'M149.5,65.7s-46.7,13.2-36.8,38.8c0,0,7.5,20.8,36.5,30.9,0,0-36.5-26.2-22.1-48.7,0,0,3.5-6.8,22.4-21.1Z',
  'M169.5,77.6s-42.2,8.2-36.8,25.3c0,0,4.6,13.6,36.5,23.5,0,0-34.6-20.1-21.8-33.6,0,0,3.6-5.6,22.2-15.2Z',
  'M188.8,86s-38.7,4.8-33.6,17.7c0,0,1.2,9.3,33.7,16.7,0,0-32.6-11.9-19.3-23.4,0,0,7.2-7,19.2-11Z',
  'M183.2,103.6c0-4.6,5.1-8.2,11.5-8.2s11.5,3.7,11.5,8.2-5.1,8.2-11.5,8.2-11.5-3.7-11.5-8.2Z',
]

export function BrandMark({ className = 'h-[22px] w-auto' }: { className?: string }) {
  return (
    <svg
      aria-label="DigitalTwin"
      className={className}
      role="img"
      style={{ display: 'block' }}
      viewBox={MARK_VIEW}
    >
      <g fill="#FFC629" fillRule="evenodd">
        {MARK_PATHS.map((d) => (
          <path d={d} key={d} />
        ))}
      </g>
    </svg>
  )
}

/** Mark plus wordmark — the lockup every public header uses. */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-[9px] ${className}`}>
      <BrandMark />
      <span className="font-semibold text-[15px] tracking-[-0.015em]">DigitalTwin</span>
    </span>
  )
}
