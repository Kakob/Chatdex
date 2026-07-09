import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Copy, Globe, Terminal, X, Tag, Search, Radar, Loader2 } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { TagBadge } from '../common/TagBadge';
import { TagInput } from '../common/TagInput';
import { EvidencePanel } from '../detection/EvidencePanel';
import { SEVERITY_BADGE, SEVERITY_LABEL, SEVERITY_ORDER } from '../detection/severity';
import { scrollToFinding, mapMessagesToStepLabels } from '../../lib/detection/findingAnchors';
import { useTagStore } from '../../stores/tagStore';
import { useAnchorStore } from '../../stores/anchorStore';
import { useToastStore } from '../../stores/toastStore';
import { useFindingsStore } from '../../stores/findingsStore';
import { normalizeSession } from '../../lib/detection/normalize';
import { mapFindingsToMessages } from '../../lib/detection/findingAnchors';
import { conversationToMarkdown } from '../../lib/exporters/markdown';
import { buildJson } from '../../lib/exporters/json';
import { downloadExport, type ExportFormat } from '../../lib/exporters';
import type { StoredConversation, StoredMessage } from '../../types';
import type { ApiTag } from '../../lib/api';

interface ConversationViewProps {
  conversation: StoredConversation;
  messages: StoredMessage[];
  onBack: () => void;
  highlightQuery?: string;
}

export function ConversationView({
  conversation,
  messages,
  onBack,
  highlightQuery,
}: ConversationViewProps) {
  const [searchParams] = useSearchParams();
  const scrollTo = searchParams.get('scrollTo');
  const [conversationTags, setConversationTags] = useState<ApiTag[]>([]);
  const [showTagInput, setShowTagInput] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const { tagEntity, untagEntity, getEntityTags } = useTagStore();
  const { loadConversationAnchors } = useAnchorStore();
  const addToast = useToastStore((s) => s.addToast);

  const loadFindings = useFindingsStore((s) => s.loadFindings);
  const analyzeConversation = useFindingsStore((s) => s.analyze);
  const selectFinding = useFindingsStore((s) => s.selectFinding);
  const findings = useFindingsStore(
    (s) => s.findingsByConversation[conversation.id]
  );
  const runCount = useFindingsStore(
    (s) => s.runCountByConversation[conversation.id]
  );
  const analyzingStage = useFindingsStore(
    (s) => s.analyzingStage[conversation.id]
  );
  const selectedFindingId = useFindingsStore((s) => s.selectedFindingId);

  const session = useMemo(
    () => normalizeSession(conversation.id, messages),
    [conversation.id, messages]
  );
  const findingsByMessage = useMemo(
    () => mapFindingsToMessages(session, findings ?? []),
    [session, findings]
  );
  // Step numbers only mean something for agent traces.
  const stepLabels = useMemo(
    () =>
      conversation.source === 'claude-code'
        ? mapMessagesToStepLabels(session)
        : new Map<string, string>(),
    [conversation.source, session]
  );
  const sortedFindings = useMemo(
    () => [...(findings ?? [])].sort((a, b) => a.stepRange.start - b.stepRange.start),
    [findings]
  );
  const selectedFinding =
    sortedFindings.find((f) => f.id === selectedFindingId) ?? null;
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sortedFindings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    return counts;
  }, [sortedFindings]);

  // Clicking a severity chip opens the first finding of that severity and
  // cycles through the rest on repeat clicks.
  const cycleSeverity = (severity: string) => {
    const ofSeverity = sortedFindings.filter((f) => f.severity === severity);
    if (ofSeverity.length === 0) return;
    const currentIdx = ofSeverity.findIndex((f) => f.id === selectedFindingId);
    const next = ofSeverity[(currentIdx + 1) % ofSeverity.length];
    selectFinding(next.id);
    scrollToFinding(session, next);
  };

  useEffect(() => {
    void loadFindings(conversation.id);
    // Close any panel left open from a previously viewed conversation.
    selectFinding(null);
  }, [conversation.id, loadFindings, selectFinding]);

  const handleAnalyze = async () => {
    try {
      await analyzeConversation(conversation.id);
      addToast('Analysis complete');
    } catch (err) {
      addToast(`Analysis failed: ${(err as Error).message}`, 'error');
    }
  };

  // Cmd+F to open in-conversation search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setLocalSearch('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  const activeHighlight = localSearch.trim() || highlightQuery;

  useEffect(() => {
    getEntityTags('conversation', conversation.id).then(setConversationTags);
    loadConversationAnchors(conversation.id);
  }, [conversation.id, getEntityTags, loadConversationAnchors]);

  // Scroll to message if scrollTo param is present
  useEffect(() => {
    if (!scrollTo || messages.length === 0) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`message-${scrollTo}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-violet-400', 'rounded-lg');
        setTimeout(() => el.classList.remove('ring-2', 'ring-violet-400', 'rounded-lg'), 3000);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollTo, messages]);

  const handleTagAdd = async (tag: ApiTag) => {
    await tagEntity(tag.id, conversation.id, 'conversation');
    setConversationTags((prev) => [...prev, tag]);
  };

  const handleTagRemove = async (tagId: string) => {
    await untagEntity(tagId, conversation.id, 'conversation');
    setConversationTags((prev) => prev.filter((t) => t.id !== tagId));
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleCopy = async () => {
    const text = messages
      .filter((m) => m.sender === 'user' || m.sender === 'assistant')
      .map((m) => `${m.sender === 'user' ? 'User' : 'Claude'}: ${m.text}`)
      .join('\n\n');

    await navigator.clipboard.writeText(text);
    addToast('Copied to clipboard');
  };

  const handleExport = (format: ExportFormat) => {
    const slug = conversation.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    if (format === 'markdown') {
      downloadExport(conversationToMarkdown(conversation, messages), slug, 'markdown');
    } else {
      downloadExport(
        buildJson({ conversation, messages }, { source: 'claude-utils' }),
        slug,
        'json'
      );
    }
  };

  const handleClearHighlight = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('highlight');
    window.history.replaceState({}, '', url.toString());
    window.location.replace(url.toString());
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-700 mb-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {conversation.source === 'claude.ai' ? (
              <Globe size={16} className="text-violet-500" />
            ) : (
              <Terminal size={16} className="text-emerald-500" />
            )}
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {conversation.name}
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatDate(conversation.createdAt)} · {conversation.messageCount} messages
          </p>

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {conversationTags.map((tag) => (
              <TagBadge
                key={tag.id}
                name={tag.name}
                color={tag.color}
                onRemove={() => handleTagRemove(tag.id)}
              />
            ))}
            {showTagInput ? (
              <div className="w-56">
                <TagInput
                  selectedTags={conversationTags}
                  onTagAdd={handleTagAdd}
                  onTagRemove={handleTagRemove}
                  entityType="conversation"
                  placeholder="Add tag..."
                />
              </div>
            ) : (
              <button
                onClick={() => setShowTagInput(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-full transition-colors"
              >
                <Tag size={10} />
                Add tag
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {SEVERITY_ORDER.filter((sev) => severityCounts[sev]).map((sev) => (
            <button
              key={sev}
              onClick={() => cycleSeverity(sev)}
              title={`${severityCounts[sev]} ${SEVERITY_LABEL[sev].toLowerCase()}-severity finding(s) — click to browse`}
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-shadow hover:ring-1 hover:ring-violet-300 ${SEVERITY_BADGE[sev]}`}
            >
              {severityCounts[sev]} {SEVERITY_LABEL[sev]}
            </button>
          ))}
          <button
            onClick={handleAnalyze}
            disabled={!!analyzingStage}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-60"
            title="Run agent-failure detection over this session"
          >
            {analyzingStage ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {analyzingStage}…
              </>
            ) : (
              <>
                <Radar size={14} />
                {runCount ? 'Re-analyze' : 'Analyze'}
              </>
            )}
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            title="Search in conversation (Cmd+F)"
          >
            <Search size={18} className={showSearch ? '' : 'text-gray-600 dark:text-gray-400'} />
          </button>
          <button
            onClick={handleCopy}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Copy conversation"
          >
            <Copy size={18} className="text-gray-600 dark:text-gray-400" />
          </button>
          <div className="relative group">
            <button
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Export conversation"
            >
              <Download size={18} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <button
                onClick={() => handleExport('markdown')}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-t-lg"
              >
                Export Markdown
              </button>
              <button
                onClick={() => handleExport('json')}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-b-lg"
              >
                Export JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* In-conversation search */}
      {showSearch && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search in this conversation..."
              autoFocus
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          </div>
          <button
            onClick={() => { setShowSearch(false); setLocalSearch(''); }}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Highlight indicator */}
      {highlightQuery && !localSearch && (
        <div className="flex items-center justify-between px-3 py-2 mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <span className="text-sm text-yellow-800 dark:text-yellow-200">
            Highlighting matches for: <strong>"{highlightQuery}"</strong>
          </span>
          <button
            onClick={handleClearHighlight}
            className="p-1 rounded hover:bg-yellow-100 dark:hover:bg-yellow-800/30 text-yellow-700 dark:text-yellow-300"
            title="Clear highlight"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Messages + evidence panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                messages={messages}
                messageIndex={index}
                highlightQuery={activeHighlight}
                conversationId={conversation.id}
                findings={findingsByMessage.get(message.id)}
                stepLabel={stepLabels.get(message.id)}
              />
            ))}
          </div>
        </div>
        {selectedFinding && (
          <EvidencePanel
            conversationId={conversation.id}
            finding={selectedFinding}
            session={session}
            findings={sortedFindings}
          />
        )}
      </div>
    </div>
  );
}
