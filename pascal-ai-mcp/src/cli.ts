import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { PascalAiAgent } from './agent'
import { loadConfig } from './config'
import { PascalMcpClient } from './mcp'

const config = loadConfig()
const mcp = new PascalMcpClient(config)
await mcp.connect()

const agent = new PascalAiAgent(config, mcp)
const sessionId = process.env.AI_MCP_CLI_SESSION || 'cli'
const rl = createInterface({ input, output })

console.log(`Pascal AI MCP CLI. sessionId=${sessionId}. Type "exit" to quit.`)

try {
  while (true) {
    const message = await rl.question('> ')
    if (message.trim().toLowerCase() === 'exit') break
    const normalized = message.trim().toLowerCase()
    const result = await agent.chat(
      normalized === 'confirm'
        ? { sessionId, action: 'confirm' }
        : normalized === 'cancel'
          ? { sessionId, action: 'cancel' }
          : { sessionId, message },
    )
    console.log(result.reply)
    if (result.session.phase === 'awaiting_confirmation') {
      console.log('Type "confirm" to generate, or continue with a correction.')
    }
  }
} finally {
  rl.close()
  await mcp.close()
}
