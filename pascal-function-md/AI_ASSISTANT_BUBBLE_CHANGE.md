# AI Assistant Bubble Change

Date: 2026-05-28

## Summary

Added an AI assistant bubble to the saved scene editing page. Clicking the bubble opens a floating panel that embeds:

`http://localhost:5900/#/thread/019e6cd5-8332-76c1-9338-6e20185faea5`

## Files Changed

Total changed files: 2

- `apps/editor/components/ai-assistant-bubble.tsx`
  - Added a client-side floating AI assistant bubble.
  - Added open/close state for the popup.
  - Embedded the localhost AI assistant thread in an iframe.
  - Added responsive sizing for desktop and smaller screens.

- `apps/editor/components/scene-loader.tsx`
  - Imported `AiAssistantBubble`.
  - Rendered the bubble inside the saved scene editor shell, so it appears after opening a scene edit page.

## Verification

- User confirmed the feature is working.
- `npm.cmd run check-types --workspace=editor` was attempted, but the repository currently has unrelated existing TypeScript errors in `packages/editor`.
