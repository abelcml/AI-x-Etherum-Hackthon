"""CLI entry point: run one task without the HTTP server.

Usage:
    ANTHROPIC_API_KEY=... python run_task.py "Research the current price of ETH"
"""
import json
import sys
import uuid

from runtime.graph import run_task


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    result = run_task(
        agent_id="research-agent-001",
        task_id=f"task-{uuid.uuid4().hex[:8]}",
        task=" ".join(sys.argv[1:]),
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
