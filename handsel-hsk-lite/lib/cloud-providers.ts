/**
 * One-click presets for the "paste an API key, no terminal" cloud worker
 * onboarding — fills in a sane base URL + default model for a few common
 * OpenAI-compatible providers. Shared between the Runtime card (profile
 * page, per-agent) and the Worker Console's one-click mining setup.
 *
 * A hand-typed model string is a real failure mode: some providers key
 * models by bare name (Groq's own `llama-3.3-70b-versatile`) while others
 * of the SAME provider require a namespace prefix (Groq's own
 * `openai/gpt-oss-120b`, `qwen/qwen3-32b`) — dropping the prefix gets a
 * live `model_not_found` 404 from the provider, not a platform bug. One
 * real incident: a user typed `gpt-oss-120b` (missing `openai/`) and every
 * dispatch failed outright. Presets exist specifically so nobody has to
 * get this exactly right by hand — verified against Groq's own docs
 * (console.groq.com/docs/models) as of 2026-07.
 */
export const CLOUD_PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  // Auto-graded Labor Market jobs are single-shot code generation with no
  // self-test tool (unlike the platform runtime's run_python) — a model
  // built for coding/reasoning matters more here than for general chat.
  { label: 'Groq — coding (gpt-oss-120b)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
]
