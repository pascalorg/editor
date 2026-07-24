import { create } from 'zustand'

type DeleteConfirmationRequest = {
  count: number
  onConfirm: () => void
}

type DeleteConfirmationStore = {
  request: DeleteConfirmationRequest | null
  cancel: () => void
  confirm: () => void
  requestConfirmation: (request: DeleteConfirmationRequest) => void
}

const useDeleteConfirmation = create<DeleteConfirmationStore>((set, get) => ({
  request: null,
  cancel: () => set({ request: null }),
  confirm: () => {
    const request = get().request
    if (!request) return
    set({ request: null })
    request.onConfirm()
  },
  requestConfirmation: (request) => set({ request }),
}))

export default useDeleteConfirmation
