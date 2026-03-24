import { useState, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { TimelineFilters, TimelineView } from '../components/timeline';
import { useTimeline } from '../hooks/useTimeline';
import { buildCsv } from '../lib/exporters/csv';
import { buildJson } from '../lib/exporters/json';
import { downloadExport } from '../lib/exporters';
import type { ActivityFilters, StoredActivity } from '../types';

export function TimelinePage() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [groupByConversation, setGroupByConversation] = useState(false);

  const { activities, groups, isLoading } = useTimeline({
    filters,
    groupByConversation,
  });

  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      if (activities.length === 0) return;

      if (format === 'json') {
        downloadExport(
          buildJson(activities, { source: 'claude-utils' }),
          'claude-activities',
          'json'
        );
      } else {
        downloadExport(
          activitiesToCSV(activities),
          'claude-activities',
          'csv'
        );
      }
    },
    [activities]
  );

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Clock size={24} className="text-violet-500" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Activity Timeline
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Real-time tracking of your Claude usage
        </p>
      </div>

      <div className="mb-6">
        <TimelineFilters
          filters={filters}
          onFiltersChange={setFilters}
          groupByConversation={groupByConversation}
          onGroupByChange={setGroupByConversation}
          onExport={handleExport}
        />
      </div>

      <TimelineView
        activities={activities}
        groups={groups}
        groupByConversation={groupByConversation}
        isLoading={isLoading}
      />
    </div>
  );
}

function activitiesToCSV(activities: StoredActivity[]): string {
  const headers = [
    'ID', 'Type', 'Source', 'Conversation ID', 'Conversation Title', 'Model',
    'Timestamp', 'Input Tokens', 'Output Tokens', 'Cache Read Tokens',
    'Message Role', 'Message Preview', 'Artifact Title', 'Artifact Type',
    'Code Language', 'Tool Name',
  ];

  const rows = activities.map((a) => [
    a.id,
    a.type,
    a.source,
    a.conversationId ?? '',
    a.conversationTitle ?? '',
    a.model ?? '',
    a.timestamp.toISOString(),
    a.tokens?.inputTokens ?? '',
    a.tokens?.outputTokens ?? '',
    a.tokens?.cacheReadTokens ?? '',
    a.metadata.messageRole ?? '',
    a.metadata.messagePreview ?? '',
    a.metadata.artifactTitle ?? '',
    a.metadata.artifactType ?? '',
    a.metadata.codeLanguage ?? '',
    a.metadata.toolName ?? '',
  ]);

  return buildCsv(headers, rows);
}
