import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { downloadExport } from '../../lib/exporters';

/**
 * Renders the living understanding document (U4.2) as formatted markdown
 * source with copy + download. Source view is deliberate: the document is a
 * projection meant to travel (export, agent context), so what you see is
 * exactly what you get.
 */
export function LivingDocumentView({
  markdown,
  filenamePrefix,
}: {
  markdown: string;
  filenamePrefix: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buttonClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <button onClick={() => void handleCopy()} className={buttonClass}>
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => downloadExport(markdown, filenamePrefix, 'markdown')}
          className={buttonClass}
        >
          <Download size={12} />
          Download .md
        </button>
      </div>
      <pre className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono text-gray-800 dark:text-gray-200 overflow-x-auto">
        {markdown}
      </pre>
    </div>
  );
}
