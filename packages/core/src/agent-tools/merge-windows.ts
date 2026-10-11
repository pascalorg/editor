import { z } from 'zod'

export const mergeWindowsTool = {
  name: 'merge_windows',
  title: 'Merge windows',
  description:
    "Make two windows that exist one window, as the editor's Merge windows does: nothing is recreated. On two walls that meet at a corner, each window within 0.30 m of that corner, they become one corner window (the add_corner_window result): each is slid to the corner keeping its width, the glass fused (post none), and both take the first window's height, sill and type, so name first the window whose look you want; the corner is refused over 170° or under 10° (walls_not_meeting, corner_angle, window_not_at_corner, height_exceeds_wall). On one wall, two windows with at most 0.30 m between them and nothing between become one window spanning both outer edges, from the lower sill to the higher head, with the first window's type and style (windows_not_adjacent, opening_between). Refused with a code and a sentence that says why: window_not_found, not_a_window, same_window, window_not_on_wall, window_already_joined (unwrap it first), windows_already_joined, opening_overlap (sliding to the corner would land on another opening). Returns kind (corner or same_wall), the windows that stay (windowIds) and the one that went (removedIds). Use it for two windows already built that open a corner or one wide opening; add_corner_window builds a new pair, and verify_scene's corner_unjoined names two windows this joins.",
  input: {
    windowIds: z
      .array(z.string())
      .length(2)
      .describe(
        'The two windows, the one whose height, sill and type the result keeps named first.',
      ),
  },
}
