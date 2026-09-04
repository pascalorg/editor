import { cn } from '@/lib/utils'

// The lingo mark: a single handwritten stroke (creator-drawn). Inherits
// currentColor so it follows the theme wherever it sits.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('h-5 w-auto shrink-0', className)}
      viewBox="185 94.7 66.1 46"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m195.3 121.7 4-7.7c1.9-3.3 3.8-6.9 4.9-7.4s2.1 0 2.2 1.8-1.7 18.6-0.4 22.1c1 2.7 2.7 2.4 4.7-2.5l2.6-6.8c1.7-4.2 4.3-11.3 5.3-16.7l-2.2 24.5c0.1 3.7 1.8 2 2.3 0.8l4.6-8.2 0.3-0.5 0.1-0.1 0.2-0.3v-0.1l3.4-5.7c0.5-0.7 1.2-2.5 1.7-2.2 0.5 0.2 1.9 7.5 3.2 10.3 2.1 5.1 2.7 1.1 3.5-1.6 0.5-1.6 1.5-4.3 3.3-1.3 1.4 2.3 1.9 7.4 3.2 9.1s2.5-1.8 3.5-4.2 2.7-4.8 3.4-5.7l0.7-1.3m0.6-7.7h0.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  )
}
