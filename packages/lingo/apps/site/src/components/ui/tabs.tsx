'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

const TAB_ACTIVE_SURFACE_CLASS =
  'absolute inset-0 z-0 rounded-md border border-[var(--tabs-trigger-active-border)] bg-[var(--tabs-trigger-active-background)] shadow-[var(--tabs-trigger-active-shadow)]'

interface TabsContextValue {
  baseId: string
  orientation: 'horizontal' | 'vertical'
  setValue: (value: string) => void
  value: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabs() {
  const context = React.use(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be rendered inside <Tabs>')
  }
  return context
}

function Tabs({
  className,
  defaultValue,
  value,
  onValueChange,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<'div'> & {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
}) {
  const baseId = React.useId()
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? '')
  const currentValue = value ?? uncontrolledValue

  const setValue = React.useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setUncontrolledValue(nextValue)
      }
      onValueChange?.(nextValue)
    },
    [onValueChange, value],
  )
  const contextValue = React.useMemo(
    () => ({ baseId, orientation, value: currentValue, setValue }),
    [baseId, currentValue, orientation, setValue],
  )

  return (
    <TabsContext.Provider value={contextValue}>
      <div
        className={cn('flex min-w-0 flex-col gap-4', className)}
        data-orientation={orientation}
        data-slot="tabs"
        {...props}
      />
    </TabsContext.Provider>
  )
}

function TabsList({ className, onKeyDown, ...props }: React.ComponentProps<'div'>) {
  const { orientation } = useTabs()

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) {
      return
    }

    const keys =
      orientation === 'vertical'
        ? ['ArrowUp', 'ArrowDown', 'Home', 'End']
        : ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) {
      return
    }

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    )
    if (tabs.length === 0) {
      return
    }

    event.preventDefault()
    const activeIndex = tabs.findIndex((tab) => tab === document.activeElement)
    const currentIndex = activeIndex < 0 ? 0 : activeIndex
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + delta + tabs.length) % tabs.length
    const nextTab = tabs[nextIndex]
    nextTab?.focus()
    nextTab?.click()
  }

  return (
    <div
      aria-orientation={orientation}
      className={cn(
        'inline-flex w-fit items-center justify-center rounded-lg bg-[var(--tabs-list-background)] p-1 text-muted-foreground shadow-[var(--tabs-list-shadow)]',
        orientation === 'vertical' && 'flex-col',
        className,
      )}
      data-slot="tabs-list"
      onKeyDown={handleKeyDown}
      role="tablist"
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  value,
  disabled,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value'> & { value: string }) {
  const { baseId, setValue, value: activeValue } = useTabs()
  const active = activeValue === value
  const tabId = `${baseId}-tab-${value}`
  const panelId = `${baseId}-panel-${value}`

  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      className={cn(
        'relative isolate inline-flex h-7 min-w-0 cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-md border border-transparent px-2.5 py-1 font-medium text-sm outline-none transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--tabs-trigger-hover-background)] hover:text-foreground focus-visible:border-[var(--control-focus-border)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        active ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      data-slot="tabs-trigger"
      data-state={active ? 'active' : 'inactive'}
      disabled={disabled}
      id={tabId}
      onClick={(event) => {
        setValue(value)
        onClick?.(event)
      }}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
      {...props}
    >
      {active ? <span aria-hidden="true" className={TAB_ACTIVE_SURFACE_CLASS} /> : null}
      <span className="relative z-10 min-w-0 truncate">{children}</span>
    </button>
  )
}

function TabsContent({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<'div'> & { value: string }) {
  const { baseId, value: activeValue } = useTabs()
  const active = activeValue === value
  const tabId = `${baseId}-tab-${value}`
  const panelId = `${baseId}-panel-${value}`

  return (
    <div
      aria-labelledby={tabId}
      className={cn(
        'min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      data-slot="tabs-content"
      data-state={active ? 'active' : 'inactive'}
      hidden={!active}
      id={panelId}
      role="tabpanel"
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
