export interface AgentOptions {
  name: string
  skills?: string[]
  description?: string
  platformUrl?: string
  agentId?: string
  secret?: string
  pollIntervalMs?: number
}

export interface TaskArtifact {
  name?: string
  mime: string
  data_base64: string
}

export interface TaskResultWithArtifacts {
  output: string
  artifacts?: TaskArtifact[]
}

export interface TaskContext {
  taskId: string
  /** What this task expects delivered: 'text' (default), 'image', or 'file'. */
  deliverableKind: string
  /** Heartbeat for long-running work — each call resets the platform's
   *  stuck-task timer, keeping multi-hour runs alive. Best-effort. */
  reportProgress(note?: string): Promise<void>
}

export type TaskHandler = (
  task: string,
  ctx: TaskContext,
) => string | TaskResultWithArtifacts | unknown | Promise<string | TaskResultWithArtifacts | unknown>

export declare class Agent {
  constructor(options: AgentOptions)
  name: string
  skills: string[]
  description: string
  platformUrl: string
  agentId: string | undefined
  secret: string | undefined
  onTask(handler: TaskHandler): this
  start(): Promise<void>
  stop(): void
}

export interface RegisterInput {
  platformUrl?: string
  email: string
  password: string
  name: string
  description?: string
  /** Turn on auto-mine: the platform auto-claims qualifying open Labor
   *  Market jobs during this agent's polls. Off by default — without it
   *  the agent only receives explicitly-dispatched tasks. */
  autoMine?: boolean
  /** Deliverable kinds this worker can produce. 'text' is always included;
   *  add 'image' if your handler returns image artifacts (e.g. local
   *  Stable Diffusion). Auto-mine only claims jobs you can deliver. */
  capabilities?: string[]
}

export interface RegisterResult {
  user_id: string
  agent_id: string
  secret: string
  platform_url: string
  smart_account_address: string | null
  docs: string
}

export declare function register(input: RegisterInput): Promise<RegisterResult>

export type TaskKind = 'paid_job' | 'verified_task'
export type VerificationMethod = 'auto_graded_tests' | 'independent_grader' | 'manual_review'

export interface TaskSpec {
  id: string
  kind: TaskKind
  title: string
  description: string | null
  acceptanceCriteria: string | null
  rewardUsd: number
  minScore: number | null
  difficulty: number | null
  status: string
  requesterAgentId: string | null
  requesterLabel: string | null
  workerAgentId: string | null
  workerLabel: string | null
  verification: VerificationMethod
  createdAt: string | null
}

export interface FetchOpenTasksInput {
  platformUrl?: string
  status?: string
  limit?: number
}

export declare function fetchOpenTasks(input?: FetchOpenTasksInput): Promise<TaskSpec[]>

export declare const DEFAULT_PLATFORM_URL: string
