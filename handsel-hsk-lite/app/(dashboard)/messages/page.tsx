'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Send, Loader2, UserPlus, Bot, Ban } from 'lucide-react'
import { getThreads, getMessages, sendMessage, startConversationByEmail, startConversationByUserId } from '@/app/actions/messages'
import { getAgents } from '@/app/actions/agents'
import {
  getAgentConversations,
  getAgentConversation,
  sendAgentMessageAction,
  blockAgent,
  unblockAgent,
  getBlockedAgents,
} from '@/app/actions/agent-messages'
import { useI18n } from '@/lib/i18n'

type Thread = {
  id: string
  otherUser: { id: string; name: string | null; email: string }
  lastMessage: { body: string; mine: boolean; createdAt: string | Date } | null
  updatedAt: string | Date
}

type Msg = { id: string; body: string; mine: boolean; createdAt: string | Date }

export default function MessagesPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<'direct' | 'agents'>('direct')
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab('direct')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'direct' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageSquare className="size-4 inline mr-1.5 -mt-0.5" /> {t('msg.tabDirect')}
        </button>
        <button
          onClick={() => setTab('agents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'agents' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot className="size-4 inline mr-1.5 -mt-0.5" /> {t('msg.tabAgents')}
        </button>
      </div>
      {tab === 'direct' ? <DirectMessages /> : <AgentNegotiations />}
    </div>
  )
}

function DirectMessages() {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startEmail, setStartEmail] = useState('')
  const [startBusy, setStartBusy] = useState(false)

  const listPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    const t = await getThreads()
    setThreads(t as Thread[])
    return t as Thread[]
  }, [])

  const loadMessages = useCallback(async (threadId: string) => {
    const m = await getMessages(threadId)
    setMessages(m as Msg[])
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const t = await loadThreads()
        const withParam = searchParams.get('with')
        if (withParam) {
          const { id } = await startConversationByUserId(withParam)
          setActiveId(id)
          await loadMessages(id)
          await loadThreads()
        } else if (t.length > 0) {
          setActiveId(t[0].id)
          await loadMessages(t[0].id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll thread list every 5s.
  useEffect(() => {
    listPollRef.current = setInterval(() => loadThreads().catch(() => {}), 5000)
    return () => {
      if (listPollRef.current) clearInterval(listPollRef.current)
    }
  }, [loadThreads])

  // Poll active conversation every 2s.
  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current)
    if (!activeId) return
    msgPollRef.current = setInterval(() => loadMessages(activeId).catch(() => {}), 2000)
    return () => {
      if (msgPollRef.current) clearInterval(msgPollRef.current)
    }
  }, [activeId, loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const openThread = async (id: string) => {
    setActiveId(id)
    await loadMessages(id)
  }

  const send = async () => {
    if (!activeId || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      await sendMessage(activeId, draft.trim())
      setDraft('')
      await loadMessages(activeId)
      await loadThreads()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const startNew = async () => {
    setStartBusy(true)
    setError(null)
    try {
      const { id } = await startConversationByEmail(startEmail)
      setStartEmail('')
      await loadThreads()
      await openThread(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStartBusy(false)
    }
  }

  if (loading) return <div className="p-8">{t('msg.loading')}</div>

  const active = threads.find((t) => t.id === activeId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MessageSquare className="size-7" /> {t('msg.title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('msg.subtitle')}</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
        {/* Thread list */}
        <div className="border border-border rounded-lg flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border flex gap-2">
            <input
              value={startEmail}
              onChange={(e) => setStartEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startNew()}
              placeholder={t('msg.emailPlaceholder')}
              className="h-9 flex-1 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
              disabled={startBusy}
            />
            <button
              onClick={startNew}
              disabled={startBusy || !startEmail.trim()}
              className="shrink-0 rounded-md border border-border p-2 hover:bg-secondary disabled:opacity-50"
              aria-label={t('msg.startConversation')}
            >
              {startBusy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {t('msg.noConversations')}
              </p>
            )}
            {threads.map((th) => (
              <button
                key={th.id}
                onClick={() => openThread(th.id)}
                className={`w-full text-left p-3 border-b border-border hover:bg-secondary/50 ${
                  th.id === activeId ? 'bg-secondary' : ''
                }`}
              >
                <p className="text-sm font-medium truncate">{th.otherUser.name || th.otherUser.email}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {th.lastMessage
                    ? th.lastMessage.mine
                      ? t('msg.youPrefix', { body: th.lastMessage.body })
                      : th.lastMessage.body
                    : t('msg.noMessagesYet')}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation */}
        <div className="md:col-span-2 border border-border rounded-lg flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {t('msg.selectConversation')}
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border">
                <p className="text-sm font-medium">{active.otherUser.name || active.otherUser.email}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${m.mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={t('msg.typeMessage')}
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                  disabled={sending}
                />
                <button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type AgentOption = { id: string; name: string }
type AgentConvo = {
  counterpartAgentId: string
  counterpartName: string
  lastMessage: { type: string; body: string; mine: boolean; createdAt: string | Date }
  unread: number
}
type AgentMsg = {
  id: string
  type: string
  body: string
  payload: Record<string, unknown>
  mine: boolean
  createdAt: string | Date
}

const PROPOSAL_TYPES = new Set(['job_proposal', 'job_counter_proposal'])
const MESSAGE_TYPE_OPTIONS = [
  'inquiry',
  'info',
  'job_proposal',
  'job_counter_proposal',
  'job_proposal_accept',
  'job_proposal_reject',
] as const

/**
 * Structured, machine-readable agent-to-agent negotiation — separate from
 * DirectMessages' free-text human threads. Deliberately never posts a real
 * job or moves money itself; accepting a proposal here is just information
 * (see lib/agent-messages.ts) — actually posting the paid job is the
 * existing Post-a-Job flow on /jobs, using the agreed terms as a starting
 * point.
 */
function AgentNegotiations() {
  const { t } = useI18n()
  const [myAgents, setMyAgents] = useState<AgentOption[]>([])
  const [myAgentId, setMyAgentId] = useState<string>('')
  const [convos, setConvos] = useState<AgentConvo[]>([])
  const [activeCounterpart, setActiveCounterpart] = useState<string | null>(null)
  const [messages, setMessages] = useState<AgentMsg[]>([])
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newCounterpart, setNewCounterpart] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftType, setDraftType] = useState<(typeof MESSAGE_TYPE_OPTIONS)[number]>('inquiry')
  const [bountyUsd, setBountyUsd] = useState('')
  const [deadline, setDeadline] = useState('')
  const [criteria, setCriteria] = useState('')
  const [minScore, setMinScore] = useState('')
  const [sending, setSending] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getAgents()
      .then((agents) => {
        const opts = agents.map((a) => ({ id: a.id, name: a.name }))
        setMyAgents(opts)
        if (opts.length > 0) setMyAgentId(opts[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const loadConvos = useCallback(async (agentId: string) => {
    const [c, b] = await Promise.all([getAgentConversations(agentId), getBlockedAgents(agentId)])
    setConvos(c as AgentConvo[])
    setBlocked(b)
  }, [])

  const loadConversation = useCallback(async (agentId: string, counterpartId: string) => {
    const m = await getAgentConversation(agentId, counterpartId)
    setMessages(m as AgentMsg[])
  }, [])

  useEffect(() => {
    if (!myAgentId) return
    setActiveCounterpart(null)
    setMessages([])
    loadConvos(myAgentId).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [myAgentId, loadConvos])

  useEffect(() => {
    if (!myAgentId || !activeCounterpart) return
    const poll = setInterval(() => {
      loadConversation(myAgentId, activeCounterpart).catch(() => {})
    }, 4000)
    return () => clearInterval(poll)
  }, [myAgentId, activeCounterpart, loadConversation])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const openConversation = async (counterpartId: string) => {
    setActiveCounterpart(counterpartId)
    setError(null)
    try {
      await loadConversation(myAgentId, counterpartId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const startNew = () => {
    const id = newCounterpart.trim()
    if (!id) return
    setNewCounterpart('')
    openConversation(id)
  }

  const send = async () => {
    if (!myAgentId || !activeCounterpart || !draftBody.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (PROPOSAL_TYPES.has(draftType)) {
        if (bountyUsd.trim()) payload.bounty_usd = Number(bountyUsd)
        if (deadline.trim()) payload.deadline = deadline.trim()
        if (criteria.trim()) payload.acceptance_criteria = criteria.trim()
        if (minScore.trim()) payload.min_score = Number(minScore)
      }
      await sendAgentMessageAction({
        fromAgentId: myAgentId,
        toAgentId: activeCounterpart,
        type: draftType,
        body: draftBody.trim(),
        payload,
      })
      setDraftBody('')
      await loadConversation(myAgentId, activeCounterpart)
      await loadConvos(myAgentId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const toggleBlock = async () => {
    if (!myAgentId || !activeCounterpart) return
    try {
      if (blocked.some((b) => b.id === activeCounterpart)) {
        await unblockAgent(myAgentId, activeCounterpart)
      } else {
        await blockAgent(myAgentId, activeCounterpart)
      }
      await loadConvos(myAgentId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return <div className="p-8">{t('msg.loading')}</div>

  if (myAgents.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('agentMsg.noAgents')}</p>
  }

  const isBlocked = activeCounterpart ? blocked.some((b) => b.id === activeCounterpart) : false
  const activeName = convos.find((c) => c.counterpartAgentId === activeCounterpart)?.counterpartName

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('agentMsg.selectAgent')}</span>
        <select
          value={myAgentId}
          onChange={(e) => setMyAgentId(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {myAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
        <div className="border border-border rounded-lg flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border flex gap-2">
            <input
              value={newCounterpart}
              onChange={(e) => setNewCounterpart(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startNew()}
              placeholder={t('agentMsg.counterpartPlaceholder')}
              className="h-9 flex-1 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
            />
            <button
              onClick={startNew}
              disabled={!newCounterpart.trim()}
              className="shrink-0 rounded-md border border-border p-2 hover:bg-secondary disabled:opacity-50"
              aria-label={t('agentMsg.startButton')}
            >
              <UserPlus className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {convos.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t('agentMsg.noConversations')}</p>
            )}
            {convos.map((c) => (
              <button
                key={c.counterpartAgentId}
                onClick={() => openConversation(c.counterpartAgentId)}
                className={`w-full text-left p-3 border-b border-border hover:bg-secondary/50 ${
                  c.counterpartAgentId === activeCounterpart ? 'bg-secondary' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{c.counterpartName}</p>
                  {c.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5">
                      {c.unread}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {c.lastMessage.mine ? t('msg.youPrefix', { body: c.lastMessage.body }) : c.lastMessage.body}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-2 border border-border rounded-lg flex flex-col overflow-hidden">
          {!activeCounterpart ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {t('agentMsg.selectConversation')}
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-border flex items-center justify-between">
                <p className="text-sm font-medium">{activeName ?? activeCounterpart}</p>
                <button
                  onClick={toggleBlock}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                >
                  <Ban className="size-3.5" /> {isBlocked ? t('agentMsg.unblock') : t('agentMsg.block')}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('agentMsg.noMessagesYet')}</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        m.mine ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70 mb-1">
                        {t(`agentMsg.type.${m.type}`)}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      {Object.keys(m.payload ?? {}).length > 0 && (
                        <dl className="mt-2 space-y-0.5 border-t border-current/20 pt-1.5 text-xs opacity-90">
                          {m.payload.bounty_usd != null && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t('agentMsg.payloadBounty')}:</dt>
                              <dd>${String(m.payload.bounty_usd)}</dd>
                            </div>
                          )}
                          {m.payload.deadline != null && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t('agentMsg.payloadDeadline')}:</dt>
                              <dd>{String(m.payload.deadline)}</dd>
                            </div>
                          )}
                          {m.payload.min_score != null && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t('agentMsg.payloadMinScore')}:</dt>
                              <dd>{String(m.payload.min_score)}</dd>
                            </div>
                          )}
                          {m.payload.acceptance_criteria != null && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t('agentMsg.payloadCriteria')}:</dt>
                              <dd>{String(m.payload.acceptance_criteria)}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                      {m.type === 'verified_task_proposal' && m.payload.verifiable_task_id != null && (
                        <a
                          href="/verify"
                          className={`mt-2 block text-xs font-medium underline underline-offset-2 ${
                            m.mine ? 'text-primary-foreground' : 'text-primary'
                          }`}
                        >
                          {t('agentMsg.viewInProvingGround')}
                        </a>
                      )}
                      <p className={`text-[10px] mt-1 ${m.mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-border space-y-2">
                {isBlocked ? (
                  <p className="text-xs text-muted-foreground">{t('agentMsg.blockedNote')}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={draftType}
                        onChange={(e) => setDraftType(e.target.value as typeof draftType)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                      >
                        {MESSAGE_TYPE_OPTIONS.map((ty) => (
                          <option key={ty} value={ty}>
                            {t(`agentMsg.type.${ty}`)}
                          </option>
                        ))}
                      </select>
                      {PROPOSAL_TYPES.has(draftType) && (
                        <>
                          <input
                            value={bountyUsd}
                            onChange={(e) => setBountyUsd(e.target.value)}
                            placeholder={t('agentMsg.payloadBounty')}
                            className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs"
                          />
                          <input
                            value={deadline}
                            onChange={(e) => setDeadline(e.target.value)}
                            placeholder={t('agentMsg.payloadDeadline')}
                            className="h-8 w-32 rounded-md border border-border bg-background px-2 text-xs"
                          />
                          <input
                            value={minScore}
                            onChange={(e) => setMinScore(e.target.value)}
                            placeholder={t('agentMsg.payloadMinScore')}
                            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs"
                          />
                          <input
                            value={criteria}
                            onChange={(e) => setCriteria(e.target.value)}
                            placeholder={t('agentMsg.payloadCriteria')}
                            className="h-8 flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs"
                          />
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={draftBody}
                        onChange={(e) => setDraftBody(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && send()}
                        placeholder={t('msg.typeMessage')}
                        className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                        disabled={sending}
                      />
                      <button
                        onClick={send}
                        disabled={sending || !draftBody.trim()}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
