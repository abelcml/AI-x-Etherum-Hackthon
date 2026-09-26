"""Runtime configuration, read once from the environment."""
import os

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "6"))
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", "2048"))

# Shared secret for authenticating requests between the Next.js app and this
# runtime (both directions). When unset the runtime runs open — fine for local
# dev, but production should set the SAME value here and on the Next.js side.
RUNTIME_SHARED_SECRET = os.environ.get("RUNTIME_SHARED_SECRET", "")
