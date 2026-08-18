'use client'

import { useTranslation } from '@pascal-app/editor'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function CookieConsent() {
  const t = useTranslation()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Check if user has already consented
    const hasConsented = localStorage.getItem('pascal-cookie-consent')
    if (!hasConsented) {
      // Small delay so it doesn't pop in instantly
      const timer = setTimeout(() => setShow(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleAccept = () => {
    localStorage.setItem('pascal-cookie-consent', 'true')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-4xl rounded-lg border border-border bg-background p-4 shadow-lg sm:bottom-8 sm:left-auto sm:right-8 sm:w-96 sm:p-6">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-semibold text-sm">{t('We value your privacy')}</h3>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {t('We use cookies to enhance your browsing experience and analyze our traffic. By clicking "Accept", you consent to our use of cookies.')}{' '}
            <Link href="/privacy" className="underline hover:text-foreground">
              {t('Learn more')}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 self-end">
          <button
            onClick={handleAccept}
            className="rounded-md bg-foreground px-4 py-2 font-medium text-background text-xs transition-colors hover:bg-foreground/90"
          >
            {t('Accept')}
          </button>
        </div>
      </div>
    </div>
  )
}
