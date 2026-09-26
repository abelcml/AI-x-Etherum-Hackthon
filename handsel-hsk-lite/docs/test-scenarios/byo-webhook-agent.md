# Test scenario: BYO Agent (bring your own webhook)

Verifies the "run this agent on my own infrastructure instead of the
platform runtime" path end to end. No code of yours ever runs on our
servers — we POST a task to your endpoint, and your server POSTs the
result back to `/api/runtime/callback` in the same shape the Python
runtime uses (see `lib/agent-tasks.ts` / `lib/webhook.ts`).

For this test, "your own infrastructure" is a ~30-line local script that
just echoes the task back — it proves the plumbing (dispatch → your
server → callback → credit recalculation), not real agent intelligence.
Swap in your actual agent once the plumbing is confirmed.

## Prerequisites

- An agent already created (any existing one works — you don't need a
  fresh one).
- Node.js (already required for the rest of this repo).
- A way to expose `localhost` over HTTPS, since the deployed app must be
  able to reach your machine: [ngrok](https://ngrok.com) (free account) or
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  (no account needed). The webhook URL field rejects anything that isn't
  `https://` (`app/actions/webhook.ts`), so plain `http://localhost` will
  not work here even for local testing.

## Step 1 — start the local test agent

Save as `webhook-agent.cjs` anywhere on your machine:

```js
// webhook-agent.cjs — minimal test double for the BYO webhook contract.
// Run: node webhook-agent.cjs
const http = require('node:http')

const PORT = 8787
const SECRET = 'PASTE_THE_SECRET_SHOWN_IN_THE_DASHBOARD_HERE'

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404)
    return res.end()
  }

  let body = ''
  for await (const chunk of req) body += chunk
  const { agent_id, task_id, task, callback_url } = JSON.parse(body)

  console.log(`[agent] got task ${task_id}: ${task}`)
  // Respond fast — the app just needs to know we accepted it.
  res.writeHead(202, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'accepted' }))

  // --- do the "work" (stand-in — plug in your real agent here) ---
  const output = `Echo from local webhook agent: ${task}`
  const events = [
    { agent_id, task_id, event_type: 'TASK_STARTED', success: true, execution_time: 0, token_cost: 0, quality_score: null, detail: { task } },
    { agent_id, task_id, event_type: 'TASK_COMPLETED', success: true, execution_time: 1, token_cost: 0, quality_score: 1, detail: { output } },
  ]

  await fetch(callback_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Runtime-Secret': SECRET },
    body: JSON.stringify({
      task_id, agent_id, success: true, output,
      plan: 'Echo the task back (test double, not a real agent).',
      quality_score: 1,
      evaluation: 'Self-graded test double — always passes.',
      token_cost: 0, execution_time: 1, events,
    }),
  })
  console.log(`[agent] called back for ${task_id}`)
})

server.listen(PORT, () => console.log(`Test webhook agent listening on :${PORT}`))
```

Leave `SECRET` as the placeholder for now — you'll fill it in after Step 3.

```bash
node webhook-agent.cjs
```

## Step 2 — tunnel it publicly

```bash
ngrok http 8787
```

Copy the `https://xxxx.ngrok-free.app` URL it prints (or use `cloudflared
tunnel --url http://localhost:8787` if you'd rather not create an ngrok
account — it prints a `https://xxxx.trycloudflare.com` URL instead).

## Step 3 — point the agent at it

On `/profile`, select the agent, find the **Runtime** card:

1. Paste the tunnel URL (e.g. `https://xxxx.ngrok-free.app`) into the
   webhook URL field → **Use this webhook**. Confirm the badge flips to
   "Bring-your-own webhook".
2. Click **Generate** under "Callback secret" → copy the secret shown
   (it's shown once).
3. Paste that secret into `webhook-agent.cjs`'s `SECRET` constant, save,
   and restart `node webhook-agent.cjs` so it picks up the new value.

## Step 4 — run a task

Back on `/profile`, in **Run a Task**, type anything (e.g. `Say hello`)
and click **Execute Task**. Confirm:

- Your local terminal prints `[agent] got task ...` almost immediately —
  this is the app dispatching to your webhook
- The page's live progress log (`<LiveTaskProgress>`) shows `TASK_STARTED`
  then `TASK_COMPLETED` within a couple of polls
- Your terminal prints `[agent] called back for ...`
- The task card shows **Task completed** with output
  `Echo from local webhook agent: Say hello`
- A **Credit update** block appears — confirms the callback's events
  actually reached `agent_events` and fed `recalculateCredit()`, exactly
  like a platform-runtime task would

## Troubleshooting

- **Webhook URL field rejects your URL** — must start with `https://`
  exactly; the ngrok/cloudflared URL already satisfies this.
- **Your terminal never logs "got task"** — the app couldn't reach the
  tunnel. Confirm `ngrok`/`cloudflared` is still running and the URL
  saved on `/profile` matches the current tunnel (free ngrok URLs change
  every restart).
- **Terminal logs "got task" but the app never shows completion** —
  almost certainly a secret mismatch: `resolveCallbackAuth()` fails
  closed on any mismatch, so double check the secret in
  `webhook-agent.cjs` is the exact one generated in Step 3 (regenerating
  it invalidates the old one).
- **Want to test the failure path too** — have your script call back
  with `success: false` and no `FINAL_ANSWER`-style output, and confirm
  the task card shows **Task failed** with no credit bump.
