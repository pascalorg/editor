'use client'

import { Activity, CreditCard, LogOut, Settings, Zap } from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type DialogType = 'activities' | 'payments' | 'settings' | null

export function UserMenu() {
  const [openDialog, setOpenDialog] = useState<DialogType>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const handleMenuClick = (type: DialogType) => {
    setPopoverOpen(false)
    if (type) {
      setOpenDialog(type)
    }
  }

  const handleSignOut = () => {
    setPopoverOpen(false)
    // TODO: Implement sign out logic
    console.log('Sign out clicked')
  }

  return (
    <>
      <Popover onOpenChange={setPopoverOpen} open={popoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="h-12 w-12 cursor-pointer overflow-hidden rounded-full border-2 border-white/20 bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg transition-all duration-300 hover:scale-105 hover:border-white/40 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-white/50"
            type="button"
          >
            {/* Placeholder avatar - can be replaced with actual user image */}
            <img
              alt="User avatar"
              className="h-full w-full object-cover"
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=user123"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-2" sideOffset={8}>
          <div className="flex flex-col gap-1">
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
              onClick={() => handleMenuClick('activities')}
              type="button"
            >
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span>Activities</span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
              onClick={() => setPopoverOpen(false)}
              type="button"
            >
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span>Appliances</span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
              onClick={() => handleMenuClick('payments')}
              type="button"
            >
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span>Payments</span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted"
              onClick={() => handleMenuClick('settings')}
              type="button"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span>Settings</span>
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-red-600 text-sm transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
              onClick={handleSignOut}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Activities Dialog */}
      <Dialog
        onOpenChange={(open) => !open && setOpenDialog(null)}
        open={openDialog === 'activities'}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activities</DialogTitle>
            <DialogDescription>View and manage your recent activities.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <Activity className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">Room edited</p>
                  <p className="text-muted-foreground text-xs">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <Activity className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">New appliance added</p>
                  <p className="text-muted-foreground text-xs">Yesterday</p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payments Dialog */}
      <Dialog
        onOpenChange={(open) => !open && setOpenDialog(null)}
        open={openDialog === 'payments'}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payments</DialogTitle>
            <DialogDescription>Manage your payment methods and billing history.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-14 items-center justify-center rounded bg-gradient-to-r from-blue-600 to-blue-800">
                      <span className="font-bold text-white text-xs">VISA</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">**** **** **** 4242</p>
                      <p className="text-muted-foreground text-xs">Expires 12/25</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-1 text-green-700 text-xs">
                    Default
                  </span>
                </div>
              </div>
              <button
                className="w-full rounded-lg border border-dashed p-4 text-muted-foreground text-sm transition-colors hover:border-primary hover:text-primary"
                type="button"
              >
                + Add new payment method
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog
        onOpenChange={(open) => !open && setOpenDialog(null)}
        open={openDialog === 'settings'}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Customize your preferences and account settings.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Email notifications</p>
                  <p className="text-muted-foreground text-xs">Receive updates via email</p>
                </div>
                <button
                  className="h-6 w-11 rounded-full bg-blue-600 p-0.5 transition-colors"
                  type="button"
                >
                  <span className="block h-5 w-5 translate-x-5 rounded-full bg-white shadow transition-transform" />
                </button>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Dark mode</p>
                  <p className="text-muted-foreground text-xs">Toggle dark theme</p>
                </div>
                <button
                  className="h-6 w-11 rounded-full bg-muted p-0.5 transition-colors"
                  type="button"
                >
                  <span className="block h-5 w-5 translate-x-0 rounded-full bg-white shadow transition-transform" />
                </button>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Language</p>
                  <p className="text-muted-foreground text-xs">Select your preferred language</p>
                </div>
                <select className="rounded-md border bg-background px-2 py-1 text-sm">
                  <option>English</option>
                  <option>Spanish</option>
                  <option>French</option>
                </select>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
