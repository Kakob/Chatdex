import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FolderKanban, Loader2, MessageCircle, Plus, SendHorizontal } from 'lucide-react';
import {
  appendChatMessage,
  createChat,
  getChat,
  getChatMessages,
  listChats,
  type ChatProviderMeta,
} from '../lib/chat/chats';
import { getUnderstandingProject } from '../lib/db/understanding';
import {
  getProviderInfo,
  listReadyProviders,
  streamComplete,
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // ?project= only applies to a chat being started, not an open one.
  const projectId = activeId ? null : searchParams.get('project');

  const refreshChats = useCallback(async () => {
    setChats(await listChats());
  }, []);

  useEffect(() => {
    void refreshChats();
    void listReadyProviders().then((ready) => {
      setProviders(ready);
      setProvider((prev) => prev ?? ready[0] ?? null);
    });
  }, [refreshChats]);

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
    if (!projectId) {
      setProjectName(null);
      return;
    }
    void getUnderstandingProject(projectId).then((p) => setProjectName(p?.name ?? null));
  }, [projectId]);

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !effectiveProvider || !providerReady) return;
    setSending(true);
    setInput('');
    let conversationId = activeId;
    try {
      let history: ChatMessage[];
      if (!conversationId) {
        const conv = await createChat({
          provider: effectiveProvider,
          ...(projectId ? { projectId } : {}),
          firstUserMessage: text,
        });
        conversationId = conv.id;
        history = [{ role: 'user', content: text }];
        navigate(`/chat/${conv.id}`, { replace: true });
      } else {
        await appendChatMessage(conversationId, { sender: 'user', text });
        const stored = await getChatMessages(conversationId);
        setMessages(stored);
        history = historyFromStored(stored);
      }
      void refreshChats();

      setStreamingText('');
      const completion = await streamComplete(
        effectiveProvider,
        { messages: history },
        { onDelta: (t) => setStreamingText((s) => (s ?? '') + t) }
      );
      await appendChatMessage(conversationId, {
        sender: 'assistant',
        text: completion.text,
        model: completion.model,
      });
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

  const providerOptions = useMemo(() => providers ?? [], [providers]);
  const isNewChat = !activeId;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="w-64 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 pr-4">
        <Link
          to="/chat"
          className="flex items-center justify-center gap-2 px-3 py-2 mb-3 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
        >
          <Plus size={14} /> New chat
        </Link>
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
            {projectName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300">
                <FolderKanban size={11} /> {projectName}
              </span>
            )}
          </div>

          {isNewChat ? (
            providerOptions.length > 1 ? (
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
            )
          ) : (
            chatMeta?.provider && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {getProviderInfo(chatMeta.provider).label}
                {chatMeta.model ? ` · ${chatMeta.model}` : ''}
              </span>
            )
          )}
        </div>

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
