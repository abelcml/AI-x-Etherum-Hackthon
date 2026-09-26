"""LangGraph workflow for the Research Agent.

    Task Input → Planner → Tool Execution → Evaluation → Event log

Every node appends structured events to the run state; the caller
(server.py / run_task.py) hands those events to the credit layer.
Claude is the reasoning model for planning, tool selection, execution
and evaluation.
"""
from __future__ import annotations

import json
import time
from typing import Any, TypedDict

import anthropic
import httpx
from langgraph.graph import END, StateGraph

from . import config
from .tools import TOOL_SCHEMAS, run_tool

_default_client: anthropic.Anthropic | None = None


def _get_client(state: "AgentState | None" = None) -> anthropic.Anthropic:
    """Per-run client. BYOK: when the request carries the user's own API key
    (state["api_key"]), the run bills that key; otherwise fall back to a lazy
    singleton on the runtime's ANTHROPIC_API_KEY. Lazy so the service can boot
    (and /health respond) before any key is configured. Keys are never logged."""
    if state is not None and state.get("api_key"):
        return anthropic.Anthropic(api_key=state["api_key"])
    global _default_client
    if _default_client is None:
        _default_client = anthropic.Anthropic()
    return _default_client


class AgentState(TypedDict, total=False):
    agent_id: str
    task_id: str
    task: str
    api_key: str  # BYOK — the user's own Anthropic key for this run
    wallet_api: str  # app endpoint for the agent's wallet tools
    progress_url: str  # app endpoint for live (cosmetic) per-step updates
    messages_api: str  # app endpoint for agent-to-agent negotiation tools
    plan: str
    output: str
    success: bool
    quality_score: float
    evaluation: str
    token_cost: int
    started_at: float
    events: list[dict[str, Any]]


def _event(state: AgentState, event_type: str, *, success: bool = True,
           quality_score: float | None = None, token_cost: int = 0,
           detail: dict | None = None) -> dict[str, Any]:
    return {
        "agent_id": state["agent_id"],
        "task_id": state["task_id"],
        "event_type": event_type,
        "success": success,
        "execution_time": int(time.monotonic() - state["started_at"]),
        "token_cost": token_cost,
        "quality_score": quality_score,
        "detail": detail or {},
    }


def _push_progress(state: AgentState, event: dict[str, Any]) -> None:
    """Best-effort live push of one step to the app, so the dashboard can
    show what the agent is doing right now. Cosmetic only — agent_events
    (written once, from the full event list, when the run finishes) is the
    real record, so a failure or timeout here must never affect the run."""
    url = state.get("progress_url")
    if not url:
        return
    try:
        headers = {"Content-Type": "application/json"}
        if config.RUNTIME_SHARED_SECRET:
            headers["X-Runtime-Secret"] = config.RUNTIME_SHARED_SECRET
        httpx.post(
            url,
            json={"task_id": state["task_id"], "event": event},
            headers=headers,
            timeout=3,
        )
    except Exception:
        pass


def _emit(state: AgentState, event_type: str, **kwargs: Any) -> dict[str, Any]:
    """Record an event (for the final callback) and live-push it (cosmetic)."""
    event = _event(state, event_type, **kwargs)
    state["events"].append(event)
    _push_progress(state, event)
    return event


def _usage(message: anthropic.types.Message) -> int:
    return message.usage.input_tokens + message.usage.output_tokens


def planner_node(state: AgentState) -> AgentState:
    """Ask Claude for a short execution plan before touching any tools."""
    message = _get_client(state).messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=512,
        system=(
            "You are the planning module of an autonomous research agent. "
            "Produce a concise numbered plan (max 5 steps) to accomplish the task. "
            "Available tools: fetch_url, calculator, current_date, run_python (execute Python "
            "code — use it to build and verify code deliverables before submitting), "
            "wallet_balance, send_usdc (payments only when the task explicitly requires one). "
            "Plan only — do not execute."
        ),
        messages=[{"role": "user", "content": state["task"]}],
    )
    plan = "".join(block.text for block in message.content if block.type == "text").strip()
    tokens = _usage(message)
    state["plan"] = plan
    state["token_cost"] = state.get("token_cost", 0) + tokens
    _emit(state, "PLAN_CREATED", token_cost=tokens, detail={"plan": plan})
    return state


def executor_node(state: AgentState) -> AgentState:
    """Tool-use loop: Claude selects and calls tools until it can answer."""
    messages: list[dict] = [
        {
            "role": "user",
            "content": (
                f"Task: {state['task']}\n\nExecution plan:\n{state['plan']}\n\n"
                "Execute the plan using the available tools where useful, then give the final answer."
            ),
        }
    ]
    output = ""
    for _ in range(config.MAX_TOOL_ITERATIONS):
        message = _get_client(state).messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=config.MAX_OUTPUT_TOKENS,
            system=(
                "You are an autonomous research agent executing a planned task. "
                "Use tools when they improve accuracy. Be factual and concise."
            ),
            tools=TOOL_SCHEMAS,
            messages=messages,
        )
        state["token_cost"] = state.get("token_cost", 0) + _usage(message)
        tool_uses = [b for b in message.content if b.type == "tool_use"]
        text = "".join(b.text for b in message.content if b.type == "text").strip()

        if not tool_uses:
            output = text
            break

        messages.append({"role": "assistant", "content": message.content})
        tool_ctx = {
            "agent_id": state["agent_id"],
            "wallet_api": state.get("wallet_api", ""),
            "messages_api": state.get("messages_api", ""),
            "secret": config.RUNTIME_SHARED_SECRET,
        }
        results = []
        for tool_use in tool_uses:
            result = run_tool(tool_use.name, tool_use.input, ctx=tool_ctx)
            _emit(
                state,
                "TOOL_EXECUTED",
                success=not result.startswith("error:"),
                detail={"tool": tool_use.name, "input": tool_use.input,
                        "result_preview": result[:300]},
            )
            results.append(
                {"type": "tool_result", "tool_use_id": tool_use.id, "content": result}
            )
        messages.append({"role": "user", "content": results})
    else:
        output = text or "Tool iteration budget exhausted before a final answer was produced."

    state["output"] = output
    state["success"] = bool(output) and "iteration budget exhausted" not in output
    return state


def evaluator_node(state: AgentState) -> AgentState:
    """Claude grades the run; the grade feeds the credit scoring engine."""
    message = _get_client(state).messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=512,
        system=(
            "You are the evaluation module of an agent runtime. Grade how well the "
            "output fulfills the task. Respond with STRICT JSON only: "
            '{"quality_score": <float 0..1>, "verdict": "pass"|"fail", "feedback": "<one sentence>"}'
        ),
        messages=[
            {
                "role": "user",
                "content": f"Task:\n{state['task']}\n\nAgent output:\n{state['output']}",
            }
        ],
    )
    state["token_cost"] = state.get("token_cost", 0) + _usage(message)
    raw = "".join(b.text for b in message.content if b.type == "text").strip()
    try:
        parsed = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        quality = max(0.0, min(1.0, float(parsed.get("quality_score", 0))))
        verdict_pass = parsed.get("verdict") == "pass"
        feedback = str(parsed.get("feedback", ""))
    except (ValueError, json.JSONDecodeError):
        quality, verdict_pass, feedback = 0.0, False, f"Unparseable evaluation: {raw[:200]}"

    state["quality_score"] = quality
    state["evaluation"] = feedback
    state["success"] = state.get("success", False) and verdict_pass

    terminal = "TASK_COMPLETED" if state["success"] else "TASK_FAILED"
    _emit(
        state,
        terminal,
        success=state["success"],
        quality_score=quality,
        token_cost=state["token_cost"],
        detail={"feedback": feedback, "output_preview": state["output"][:500]},
    )
    return state


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("evaluator", evaluator_node)
    graph.set_entry_point("planner")
    graph.add_edge("planner", "executor")
    graph.add_edge("executor", "evaluator")
    graph.add_edge("evaluator", END)
    return graph.compile()


AGENT_GRAPH = build_graph()


def run_task(
    agent_id: str,
    task_id: str,
    task: str,
    api_key: str | None = None,
    wallet_api: str | None = None,
    progress_url: str | None = None,
    messages_api: str | None = None,
) -> dict[str, Any]:
    """Execute one task end-to-end and return the structured run record."""
    state: AgentState = {
        "agent_id": agent_id,
        "task_id": task_id,
        "task": task,
        "started_at": time.monotonic(),
        "token_cost": 0,
        "events": [],
    }
    if api_key:
        state["api_key"] = api_key
    if wallet_api:
        state["wallet_api"] = wallet_api
    if progress_url:
        state["progress_url"] = progress_url
    if messages_api:
        state["messages_api"] = messages_api
    _emit(state, "TASK_STARTED", detail={"task": task})

    try:
        final: AgentState = AGENT_GRAPH.invoke(state)
    except Exception as exc:
        # Runtime failures are behavioral data too — they must reach the ledger.
        _emit(state, "TASK_FAILED", success=False, quality_score=0.0,
              token_cost=state.get("token_cost", 0), detail={"error": str(exc)[:500]})
        return {
            "success": False,
            "output": f"Agent runtime error: {exc}",
            "plan": state.get("plan", ""),
            "quality_score": 0.0,
            "token_cost": state.get("token_cost", 0),
            "execution_time": int(time.monotonic() - state["started_at"]),
            "events": state["events"],
        }

    return {
        "success": final.get("success", False),
        "output": final.get("output", ""),
        "plan": final.get("plan", ""),
        "quality_score": final.get("quality_score", 0.0),
        "evaluation": final.get("evaluation", ""),
        "token_cost": final.get("token_cost", 0),
        "execution_time": int(time.monotonic() - state["started_at"]),
        "events": final.get("events", state["events"]),
    }
