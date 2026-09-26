import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { callMcpTool } from '@/lib/mcp-client'

/**
 * Drives the SHIPPED reference worker (examples/mcp-worker/server.mjs) through
 * the REAL client (lib/mcp-client) — the exact path the platform takes at
 * dispatch. Guarantees the example we tell users to run stays protocol-correct
 * against our own adapter. Echo mode, so no model/network is needed.
 */

const PORT = 8794
let proc: ChildProcess

beforeAll(async () => {
  proc = spawn(process.execPath, ['examples/mcp-worker/server.mjs', '--port', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
  // Wait for the server to accept connections (GET returns its info JSON).
  const url = `http://127.0.0.1:${PORT}/`
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('reference worker did not start')
}, 15_000)

afterAll(() => {
  proc?.kill()
})

describe('reference MCP worker (real server, real client)', () => {
  it('runs a task end-to-end via callMcpTool', async () => {
    const out = await callMcpTool({
      serverUrl: `http://127.0.0.1:${PORT}/mcp`,
      toolName: 'do_task',
      task: 'summarize the escrow flow in one line',
    })
    expect(out).toBe('ECHO: summarize the escrow flow in one line')
  })

  it('surfaces an unknown-tool error rather than hanging', async () => {
    await expect(
      callMcpTool({ serverUrl: `http://127.0.0.1:${PORT}/mcp`, toolName: 'nope', task: 'x' }),
    ).rejects.toThrow()
  })
})
