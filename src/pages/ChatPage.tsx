import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  GitMerge,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RotateCcw,
  SendHorizontal,
  Square,
} from 'lucide-react';
import {
  appendChatMessage,
  createChat,
  deleteLastAssistantMessage,
  getChat,
  getChatMessages,
  listChats,
  markChatContextDisclosed,
  setChatModelOverride,
  type ChatProviderMeta,
} from '../lib/chat/chats';
import { loadProjectChatContext, type ProjectChatContext } from '../lib/chat/context';
import { getUnderstandingProject } from '../lib/db/understanding';
import { getReconcilableConversations, reconcileProject } from '../lib/understanding/reconcile';
import { buildDisclosure, type DisclosureSummary } from '../lib/understanding/runDiscovery';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import {
  getProviderAuthMode,
  getProviderInfo,
  listReadyProviders,
  streamComplete,
  type AuthMode,
  type ChatMessage,
  type LLMProviderId,
} from '../lib/providers';
import { useToastStore } from '../stores/toastStore';
import type { StoredConversation, StoredMessage } from '../types';

function MessageBubble({ sender, text }: { sender: string; text: string }) {
  const isUser = sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-violet-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function ChatListItem({ chat, active }: { chat: StoredConversation; active: boolean }) {
  const meta = chat.providerMeta as ChatProviderMeta | undefined;
  return (
    <Link
      to={`/chat/${chat.id}`}
      className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      <div className="truncate font-medium">{chat.name}</div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span>{chat.updatedAt.toLocaleDateString()}</span>
        {meta?.provider && <span>· {getProviderInfo(meta.provider).label}</span>}
      </div>
    </Link>
  );
}

/**
 * Model picker (U5.3): "Default" (provider/CLI default), the provider's
 * curated list, or a free-text custom id for models newer than the list.
 */
function ModelPicker({
  provider,
  value,
  disabled,
  onChange,
}: {
  provider: LLMProviderId;
  /** null = provider/CLI default. */
  value: string | null;
  disabled?: boolean;
  onChange: (model: string | null) => void;
}) {
  const curated = getProviderInfo(provider).chatModels;
  const isKnown = value === null || curated.some((m) => m.id === value);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const commitDraft = () => {
    setCustomOpen(false);
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
  };

  return (
    <span className="flex items-center gap-1.5">
      <select
        value={customOpen ? '__custom__' : (value ?? '')}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom__') {
            setDraft(value ?? '');
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onChange(v || null);
        }}
        className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-50"
        title="Model for this chat"
      >
        <option value="">Default model</option>
        {curated.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        {!isKnown && value && <option value={value}>{value}</option>}
        <option value="__custom__">Custom…</option>
      </select>
      {customOpen && (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') setCustomOpen(false);
          }}
          onBlur={commitDraft}
          placeholder="model id"
          className="w-40 px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      )}
    </span>
  );
}

/**
 * What the model was told (U5.2): the injected project context is never
 * invisible — collapsed by default, one click away.
 */
function ContextPanel({ context }: { context: ProjectChatContext | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileText size={14} />
        {context ? (
          <>
            Context sent to the model: current understanding of {context.projectName}
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
              ~{context.estimatedTokens.toLocaleString()} tokens
              {context.truncated ? ' · truncated to budget' : ''}
            </span>
          </>
        ) : (
          <>No project understanding to inject yet — this chat runs without context</>
        )}
      </button>
      {open && context && (
        <pre className="px-3 pb-3 whitespace-pre-wrap break-words font-mono text-xs text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto">
          {context.systemPrompt}
        </pre>
      )}
    </div>
  );
}

export function ChatPage() {
  const { id: activeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [chats, setChats] = useState<StoredConversation[]>([]);
  const [activeChat, setActiveChat] = useState<StoredConversation | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [providers, setProviders] = useState<LLMProviderId[] | null>(null);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [context, setContext] = useState<ProjectChatContext | null>(null);
  const [pendingDisclosure, setPendingDisclosure] = useState<{
    action: 'send' | 'reply' | 'regenerate';
    text?: string;
    disclosure: DisclosureSummary;
    authMode: AuthMode;
    context: ProjectChatContext;
  } | null>(null);
  const [newChatModel, setNewChatModel] = useState<string | null>(null);
  const [railScope, setRailScope] = useState<'all' | 'project'>('all');
  const [reconciling, setReconciling] = useState(false);
  const [pendingReconcile, setPendingReconcile] = useState<{
    disclosure: DisclosureSummary;
    authMode: AuthMode;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ?project= applies to a chat being started; an open chat carries its
  // project in providerMeta.
  const newChatProjectId = activeId ? null : searchParams.get('project');
  const chatMetaForProject = activeChat?.providerMeta as ChatProviderMeta | undefined;
  const chatProjectId = chatMetaForProject?.projectId ?? newChatProjectId;

  const refreshChats = useCallback(async () => {
    setChats(
      await listChats(railScope === 'project' && chatProjectId ? chatProjectId : undefined)
    );
  }, [railScope, chatProjectId]);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  // Project chats open scoped to their project's history.
  useEffect(() => {
    setRailScope(chatProjectId ? 'project' : 'all');
  }, [chatProjectId]);

  useEffect(() => {
    void listReadyProviders().then((ready) => {
      setProviders(ready);
      setProvider((prev) => prev ?? ready[0] ?? null);
    });
  }, []);

  useEffect(() => {
    if (!activeId) {
      setActiveChat(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    void Promise.all([getChat(activeId), getChatMessages(activeId)]).then(([chat, msgs]) => {
      if (cancelled) return;
      setActiveChat(chat ?? null);
      setMessages(msgs);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!chatProjectId) {
      setProjectName(null);
      setContext(null);
      return;
    }
    let cancelled = false;
    void getUnderstandingProject(chatProjectId).then((p) => {
      if (!cancelled) setProjectName(p?.name ?? null);
    });
    void loadProjectChatContext(chatProjectId).then((ctx) => {
      if (!cancelled) setContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [chatProjectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  // An open chat continues with the provider that started it.
  const chatMeta = activeChat?.providerMeta as ChatProviderMeta | undefined;
  const effectiveProvider = chatMeta?.provider ?? provider;
  const providerReady =
    providers !== null && effectiveProvider !== null && providers.includes(effectiveProvider);

  const historyFromStored = (stored: StoredMessage[]): ChatMessage[] =>
    stored
      .filter((m) => m.sender === 'user' || m.sender === 'assistant')
      .map((m) => ({ role: m.sender as 'user' | 'assistant', content: m.text }));

  /**
   * Stream one assistant reply for `history` and persist it. Deltas are
   * display-only; the `done` completion is what gets stored. A user Stop
   * (abort) keeps the partial text — it was already shown, losing it would
   * be worse than keeping it.
   */
  const streamReply = async (
    conversationId: string,
    history: ChatMessage[],
    ctx: ProjectChatContext | null,
    modelOverride?: string
  ) => {
    if (!effectiveProvider) return;
    // The injected context precedes the transcript on every send — the
    // understanding is reloaded per send, so accepted reviews show up in
    // the next message without reopening the chat.
    const forModel: ChatMessage[] = ctx
      ? [{ role: 'system', content: ctx.systemPrompt }, ...history]
      : history;
    setStreamingText('');
    const abort = new AbortController();
    abortRef.current = abort;
    let partial = '';
    try {
      const completion = await streamComplete(
        effectiveProvider,
        { messages: forModel, ...(modelOverride ? { model: modelOverride } : {}) },
        {
          onDelta: (t) => {
            partial += t;
            setStreamingText((s) => (s ?? '') + t);
          },
          signal: abort.signal,
        }
      );
      await appendChatMessage(conversationId, {
        sender: 'assistant',
        text: completion.text,
        model: completion.model,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (partial) {
          await appendChatMessage(conversationId, { sender: 'assistant', text: partial });
        }
        addToast('Generation stopped');
      } else {
        throw err;
      }
    } finally {
      abortRef.current = null;
    }
  };

  const performSend = async (
    text: string,
    ctx: ProjectChatContext | null,
    markDisclosed = false
  ) => {
    if (!effectiveProvider) return;
    setSending(true);
    let conversationId = activeId;
    try {
      let history: ChatMessage[];
      let modelOverride = chatMeta?.modelOverride;
      if (!conversationId) {
        const conv = await createChat({
          provider: effectiveProvider,
          ...(chatProjectId ? { projectId: chatProjectId } : {}),
          firstUserMessage: text,
        });
        conversationId = conv.id;
        if (newChatModel) {
          await setChatModelOverride(conv.id, newChatModel);
          modelOverride = newChatModel;
        }
        history = [{ role: 'user', content: text }];
        navigate(`/chat/${conv.id}`, { replace: true });
      } else {
        await appendChatMessage(conversationId, { sender: 'user', text });
        const stored = await getChatMessages(conversationId);
        setMessages(stored);
        history = historyFromStored(stored);
      }
      if (markDisclosed) {
        await markChatContextDisclosed(conversationId);
        setActiveChat((await getChat(conversationId)) ?? null);
      }
      void refreshChats();

      await streamReply(conversationId, history, ctx, modelOverride);
      setMessages(await getChatMessages(conversationId));
      void refreshChats();
    } catch (err) {
      addToast(`Chat failed: ${(err as Error).message}`, 'error');
      if (conversationId) setMessages(await getChatMessages(conversationId));
    } finally {
      setStreamingText(null);
      setSending(false);
    }
  };

  /** Stream a reply from the stored history as-is (continue / regenerate). */
  const performReply = async (
    ctx: ProjectChatContext | null,
    markDisclosed = false,
    regenerate = false
  ) => {
    if (!activeId || !effectiveProvider) return;
    setSending(true);
    try {
      if (regenerate) {
        await deleteLastAssistantMessage(activeId);
        setMessages(await getChatMessages(activeId));
      }
      if (markDisclosed) {
        await markChatContextDisclosed(activeId);
        setActiveChat((await getChat(activeId)) ?? null);
      }
      const stored = await getChatMessages(activeId);
      await streamReply(activeId, historyFromStored(stored), ctx, chatMeta?.modelOverride);
      setMessages(await getChatMessages(activeId));
      void refreshChats();
    } catch (err) {
      addToast(`Chat failed: ${(err as Error).message}`, 'error');
      setMessages(await getChatMessages(activeId));
    } finally {
      setStreamingText(null);
      setSending(false);
    }
  };

  /** Fresh context at action time; the panel mirrors what actually goes out. */
  const loadFreshContext = async (): Promise<ProjectChatContext | null> => {
    if (!chatProjectId) return null;
    const ctx = await loadProjectChatContext(chatProjectId);
    setContext(ctx);
    return ctx;
  };

  /**
   * Context injection is a new disclosure (invariant 6): the first
   * context-carrying call of each chat is gated on the modal, whichever
   * action triggers it. Cancelling sends nothing.
   */
  const gateOnDisclosure = async (
    ctx: ProjectChatContext | null,
    action: 'send' | 'reply' | 'regenerate',
    text?: string
  ): Promise<boolean> => {
    if (!ctx || !effectiveProvider) return false;
    if (chatMetaForProject?.contextDisclosedAt) return false;
    const conversations = (await getReconcilableConversations(chatProjectId!, true)).filter(
      (c) => c.id !== activeId
    );
    setPendingDisclosure({
      action,
      text,
      context: ctx,
      disclosure: buildDisclosure(conversations, effectiveProvider),
      authMode: await getProviderAuthMode(effectiveProvider),
    });
    return true;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !effectiveProvider || !providerReady) return;
    const ctx = await loadFreshContext();
    if (await gateOnDisclosure(ctx, 'send', text)) return;
    setInput('');
    await performSend(text, ctx);
  };

  const handleReply = async (regenerate: boolean) => {
    if (!activeId || sending || !providerReady) return;
    const ctx = await loadFreshContext();
    if (await gateOnDisclosure(ctx, regenerate ? 'regenerate' : 'reply')) return;
    await performReply(ctx, false, regenerate);
  };

  const handleConfirmDisclosure = async () => {
    if (!pendingDisclosure) return;
    const { action, text, context: ctx } = pendingDisclosure;
    setPendingDisclosure(null);
    if (action === 'send') {
      setInput('');
      await performSend(text ?? '', ctx, true);
    } else {
      await performReply(ctx, true, action === 'regenerate');
    }
  };

  /**
   * U6.1 — close the loop: feed this chat back through the reconciliation
   * engine (scoped to this conversation). Proposals land pending in the
   * project's review strip; once accepted they're in the context injected
   * into the next send.
   */
  const handleReconcileClick = async () => {
    if (!activeId || !chatProjectId || !effectiveProvider || sending || reconciling) return;
    const scoped = await getReconcilableConversations(chatProjectId, false, [activeId]);
    if (scoped.length === 0) {
      addToast('Nothing new to reconcile — the understanding already covers this chat');
      return;
    }
    setPendingReconcile({
      disclosure: buildDisclosure(scoped, effectiveProvider),
      authMode: await getProviderAuthMode(effectiveProvider),
    });
  };

  const handleConfirmReconcile = async () => {
    if (!pendingReconcile || !activeId || !chatProjectId || !effectiveProvider) return;
    setPendingReconcile(null);
    setReconciling(true);
    try {
      const outcome = await reconcileProject(chatProjectId, {
        provider: effectiveProvider,
        conversationIds: [activeId],
      });
      addToast(
        `Understanding updated from this chat: ${outcome.objectsIntroduced} new object${
          outcome.objectsIntroduced !== 1 ? 's' : ''
        }, ${outcome.eventsProposed} proposed change${
          outcome.eventsProposed !== 1 ? 's' : ''
        } — review them on the project page`
      );
      if (outcome.warnings.length > 0) {
        console.warn('Reconciliation warnings:', outcome.warnings);
      }
      // Pick up the reconcile stamp so the button greys out until new messages.
      setActiveChat((await getChat(activeId)) ?? null);
    } catch (err) {
      addToast(`Reconciliation failed: ${(err as Error).message}`, 'error');
    } finally {
      setReconciling(false);
    }
  };

  const providerOptions = useMemo(() => providers ?? [], [providers]);
  const isNewChat = !activeId;
  // The reconcile stamp covers the chat's current state — nothing new to feed.
  const chatUpToDate = Boolean(
    activeChat &&
      chatMeta?.reconciledAt &&
      new Date(chatMeta.reconciledAt) >= activeChat.updatedAt
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="w-64 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 pr-4">
        <Link
          to="/chat"
          className="flex items-center justify-center gap-2 px-3 py-2 mb-3 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
        >
          <Plus size={14} /> New chat
        </Link>
        {chatProjectId && (
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs mb-2">
            {(
              [
                ['project', 'This project'],
                ['all', 'All chats'],
              ] as const
            ).map(([scope, label]) => (
              <button
                key={scope}
                onClick={() => setRailScope(scope)}
                className={`flex-1 px-2 py-1.5 transition-colors ${
                  railScope === scope
                    ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                    : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto space-y-1">
          {chats.map((chat) => (
            <ChatListItem key={chat.id} chat={chat} active={chat.id === activeId} />
          ))}
          {chats.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-2">No chats yet</p>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="min-w-0 flex items-center gap-2">
            <MessageCircle size={18} className="text-rose-500 shrink-0" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {activeChat ? activeChat.name : 'New chat'}
            </h1>
            {projectName && chatProjectId && (
              <Link
                to={`/projects/${chatProjectId}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
                title="Open the project's understanding"
              >
                <FolderKanban size={11} /> {projectName}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isNewChat ? (
              <>
                {providerOptions.length > 1 ? (
                  <select
                    value={provider ?? ''}
                    onChange={(e) => setProvider(e.target.value as LLMProviderId)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  >
                    {providerOptions.map((p) => (
                      <option key={p} value={p}>
                        {getProviderInfo(p).label}
                      </option>
                    ))}
                  </select>
                ) : (
                  effectiveProvider && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {getProviderInfo(effectiveProvider).label}
                    </span>
                  )
                )}
                {effectiveProvider && (
                  <ModelPicker
                    key={effectiveProvider}
                    provider={effectiveProvider}
                    value={newChatModel}
                    onChange={setNewChatModel}
                  />
                )}
              </>
            ) : (
              chatMeta?.provider && (
                <>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {getProviderInfo(chatMeta.provider).label}
                    {chatMeta.model ? ` · ${chatMeta.model}` : ''}
                  </span>
                  <ModelPicker
                    provider={chatMeta.provider}
                    value={chatMeta.modelOverride ?? null}
                    disabled={sending}
                    onChange={(model) => {
                      void (async () => {
                        await setChatModelOverride(activeId!, model);
                        setActiveChat((await getChat(activeId!)) ?? null);
                      })();
                    }}
                  />
                  {chatProjectId && providerReady && (
                    <button
                      onClick={() => void handleReconcileClick()}
                      disabled={sending || reconciling || chatUpToDate}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300 dark:hover:border-violet-800 transition-colors disabled:opacity-50"
                      title={
                        chatUpToDate
                          ? 'The understanding already covers this chat'
                          : 'Propose understanding updates from this chat'
                      }
                    >
                      {reconciling ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <GitMerge size={14} />
                      )}
                      {chatUpToDate ? 'Reconciled' : 'Reconcile chat'}
                    </button>
                  )}
                </>
              )
            )}
          </div>
        </div>

        {chatProjectId && <ContextPanel context={context} />}

        <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3">
          {messages.length === 0 && streamingText === null && (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400">
              <MessageCircle size={48} className="mx-auto mb-4 opacity-50" />
              <p>
                {isNewChat
                  ? 'Start a conversation — it will be saved as a Chatdex source'
                  : 'No messages in this chat'}
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} sender={m.sender} text={m.text} />
          ))}
          {streamingText !== null && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                {streamingText}
                <Loader2 size={12} className="inline-block ml-1 animate-spin text-gray-400" />
              </div>
            </div>
          )}
          {!sending && providerReady && messages.length > 0 && (
            <div className="flex justify-start pl-1">
              {messages[messages.length - 1].sender === 'assistant' ? (
                <button
                  onClick={() => void handleReply(true)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                  title="Discard the last response and generate a new one"
                >
                  <RotateCcw size={12} /> Regenerate
                </button>
              ) : (
                messages[messages.length - 1].sender === 'user' && (
                  <button
                    onClick={() => void handleReply(false)}
                    className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                    title="The last message has no response yet — generate one"
                  >
                    <Play size={12} /> Generate response
                  </button>
                )
              )}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
          {providers !== null && providers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <Link to="/settings" className="text-violet-600 dark:text-violet-400 hover:underline">
                Set up an LLM provider in Settings
              </Link>{' '}
              to start chatting.
            </p>
          ) : !providerReady && activeChat ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This chat uses {chatMeta?.provider ? getProviderInfo(chatMeta.provider).label : 'a provider'}{' '}
              that is not currently available —{' '}
              <Link to="/settings" className="text-violet-600 dark:text-violet-400 hover:underline">
                check Settings
              </Link>
              .
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={Math.min(6, Math.max(1, input.split('\n').length))}
                placeholder="Message… (Enter to send, Shift+Enter for a new line)"
                className="flex-1 resize-none px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {sending && streamingText !== null ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  title="Stop generating (keeps the text streamed so far)"
                >
                  <Square size={14} /> Stop
                </button>
              ) : (
                <button
                  onClick={() => void handleSend()}
                  disabled={sending || !input.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <SendHorizontal size={14} />
                  )}
                  Send
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {pendingDisclosure && (
        <DisclosureModal
          disclosure={pendingDisclosure.disclosure}
          authMode={pendingDisclosure.authMode}
          actionLabel="Project chat"
          sendsDescription={`Chatdex's synthesized understanding of "${
            pendingDisclosure.context.projectName
          }" (derived from ${pendingDisclosure.disclosure.totalConversations} conversation${
            pendingDisclosure.disclosure.totalConversations !== 1 ? 's' : ''
          }) along with ${
            pendingDisclosure.action === 'send' ? 'your message' : 'this chat'
          }`}
          confirmLabel="Send with context"
          onConfirm={() => void handleConfirmDisclosure()}
          onCancel={() => setPendingDisclosure(null)}
        />
      )}

      {pendingReconcile && (
        <DisclosureModal
          disclosure={pendingReconcile.disclosure}
          authMode={pendingReconcile.authMode}
          actionLabel="Understanding reconciliation (this chat)"
          onConfirm={() => void handleConfirmReconcile()}
          onCancel={() => setPendingReconcile(null)}
        />
      )}
    </div>
  );
}
