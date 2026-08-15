import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId, CommentId, CommentThread } from '@pascal-app/core/schema'
import { sortCommentThreads } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'

/**
 * Let the agent read the feedback left on the model, and answer it.
 *
 * Comments are scene-side state but deliberately not nodes, so every node
 * accessor in this server looks straight past them: an agent could rebuild a
 * plan while a thread saying "this wall is on the wrong side" sat unread on it.
 * That is the whole loop the comment feature was built for, and the agent was
 * the half that could not see it.
 *
 * Replying is its own call rather than a patch because comments are exempt from
 * history on purpose — a reply must not become an undo step, and undo must not
 * swallow one.
 */

/** Threads returned in one page. Bodies are user prose and can run long. */
const DEFAULT_LIMIT = 30

/** What the agent is called when it answers a thread and no name is given. */
const DEFAULT_AUTHOR = 'Assistant'

function shape(thread: CommentThread) {
  return {
    id: thread.id as string,
    body: thread.body,
    author: thread.author.name,
    createdAt: thread.createdAt,
    resolved: thread.resolved === true,
    anchor: {
      position: thread.anchor.position,
      ...(thread.anchor.nodeId ? { nodeId: thread.anchor.nodeId as string } : {}),
    },
    ...(thread.levelId ? { levelId: thread.levelId as string } : {}),
    replies: thread.replies.map((reply) => ({
      author: reply.author.name,
      body: reply.body,
      createdAt: reply.createdAt,
    })),
  }
}

export const listCommentsInput = {
  status: z
    .enum(['open', 'resolved', 'all'])
    .optional()
    .describe('Which threads to return. Defaults to open — the ones still asking for something.'),
  nodeId: z
    .string()
    .optional()
    .describe('Only threads pinned to this node. Threads pinned to empty space have no node.'),
  limit: z.number().int().positive().max(200).optional(),
}

export const listCommentsOutput = {
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      author: z.string(),
      createdAt: z.string(),
      resolved: z.boolean(),
      anchor: z.object({
        position: z.tuple([z.number(), z.number(), z.number()]),
        nodeId: z.string().optional(),
      }),
      levelId: z.string().optional(),
      replies: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.string() })),
    }),
  ),
  total: z.number().describe('Matches before the limit was applied.'),
  openCount: z.number().describe('Unresolved threads on the whole scene.'),
}

export const replyToCommentInput = {
  commentId: z.string().describe('Thread to answer, from list_comments.'),
  body: z.string().min(1).max(4000),
  author: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(`Display name. Defaults to ${DEFAULT_AUTHOR}.`),
  resolve: z
    .boolean()
    .optional()
    .describe(
      'Mark the thread resolved as well. Do this when the reply is the fix, not a question.',
    ),
}

export const replyToCommentOutput = {
  commentId: z.string(),
  replyCount: z.number(),
  resolved: z.boolean(),
}

export function registerCommentTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'list_comments',
    {
      title: 'List comments',
      description:
        'Read the comment threads people have left on the scene — the feedback channel the model is reviewed through. Each thread carries where it is pinned, which node it is against, and any replies. Read this before reworking a plan someone has already looked at, and after finishing a change, to check nothing was asked for that you missed.',
      inputSchema: listCommentsInput,
      outputSchema: listCommentsOutput,
    },
    async ({ status, nodeId, limit }) => {
      const all = sortCommentThreads(bridge.getComments())
      const wanted = status ?? 'open'
      const matches = all.filter((thread) => {
        if (wanted === 'open' && thread.resolved === true) return false
        if (wanted === 'resolved' && thread.resolved !== true) return false
        if (nodeId && thread.anchor.nodeId !== (nodeId as AnyNodeId)) return false
        return true
      })

      const payload = {
        comments: matches.slice(0, limit ?? DEFAULT_LIMIT).map(shape),
        total: matches.length,
        openCount: all.filter((thread) => thread.resolved !== true).length,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )

  server.registerTool(
    'reply_to_comment',
    {
      title: 'Reply to comment',
      description:
        'Answer a comment thread, and optionally mark it resolved. Use this to close the loop after acting on feedback — say what you changed. Replies are not part of the undo history, so this never disturbs the scene.',
      inputSchema: replyToCommentInput,
      outputSchema: replyToCommentOutput,
    },
    async ({ commentId, body, author, resolve }) => {
      const id = commentId as CommentId
      if (!bridge.getComments()[id]) {
        throwMcpError(ErrorCode.InvalidParams, `Comment not found: ${commentId}`)
      }

      const name = author ?? DEFAULT_AUTHOR
      const replyId = bridge.addCommentReply(id, { author: { name }, body })
      if (!replyId) {
        throwMcpError(ErrorCode.InternalError, `Could not append a reply to ${commentId}`)
      }
      if (resolve) bridge.setCommentResolved(id, true, { name })

      // Comments ride the scene snapshot like everything else, and nothing else
      // notifies the editor a thread has moved — there is no history entry for
      // a reply to piggyback on.
      await publishLiveSceneSnapshot(bridge, 'reply_to_comment')

      const thread = bridge.getComments()[id]
      const payload = {
        commentId,
        replyCount: thread?.replies.length ?? 0,
        resolved: thread?.resolved === true,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
