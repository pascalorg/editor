import {
  createXRStore,
  DefaultXRController,
  DefaultXRHand,
  type XRStore,
  type XRStoreOptions,
} from '@react-three/xr'

export type ViewerXRStore = XRStore

export function createViewerXRStore(options: XRStoreOptions = {}): ViewerXRStore {
  return createXRStore({
    controller: DefaultXRController,
    hand: DefaultXRHand,
    offerSession: false,
    ...options,
  })
}
