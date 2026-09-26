# AI Agent Runtime

Claude-powered autonomous Research Agent built with LangGraph.

```
Task Input → Planner → Tool Execution → Evaluation → Structured Events
```

Every run emits structured behavioral events (`TASK_STARTED`, `PLAN_CREATED`,
`TOOL_EXECUTED`, `TASK_COMPLETED` / `TASK_FAILED`). The Next.js API persists
those events in Neon PostgreSQL and feeds them to the credit scoring engine —
this runtime itself is stateless.

## Execution model (asynchronous)

`POST /run` returns `202 Accepted` immediately and runs the agent in a
background thread. When the run finishes it POSTs the events + result to the
`callback_url` supplied in the request. This keeps the caller's request short
(no serverless timeout) and lets the dashboard poll for the result.

Both `/run` (inbound) and the callback (outbound) are authenticated with a
shared secret via the `X-Runtime-Secret` header. Set `RUNTIME_SHARED_SECRET`
to the SAME value here and on the Next.js side. If unset, the runtime runs
open (local dev only).

## Setup

```bash
cd agent-runtime
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run the HTTP service (used by the dashboard)

```bash
uvicorn runtime.server:app --port 8000
```

The dashboard reaches it via the `AGENT_RUNTIME_URL` env var
(default `http://localhost:8000`).

## Run a single task from the CLI

```bash
python run_task.py "Summarize the key risks of algorithmic stablecoins"
```

## Configuration

| Env var               | Default            | Purpose                       |
| --------------------- | ------------------ | ----------------------------- |
| `ANTHROPIC_API_KEY`     | —                  | Claude API access (required)  |
| `ANTHROPIC_MODEL`       | `claude-sonnet-5`  | Reasoning model               |
| `RUNTIME_SHARED_SECRET` | —                  | Auth secret (match Next.js)   |
| `MAX_TOOL_ITERATIONS`   | `6`                | Tool-use loop budget          |
| `MAX_OUTPUT_TOKENS`     | `2048`             | Per-call output token budget  |
