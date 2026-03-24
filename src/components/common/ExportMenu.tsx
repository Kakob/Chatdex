import { Download } from 'lucide-react';
import type { ExportFormat } from '../../lib/exporters';

interface ExportMenuProps {
  onExport: (format: ExportFormat) => void;
  formats?: ExportFormat[];
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
};

export function ExportMenu({
  onExport,
  formats = ['markdown', 'json', 'csv'],
}: ExportMenuProps) {
  return (
    <div className="relative group">
      <button
        className="p-2 rounded-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
        title="Export"
      >
        <Download size={18} />
      </button>
      <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
        {formats.map((format, i) => (
          <button
            key={format}
            onClick={() => onExport(format)}
            className={`w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 ${
              i === 0 ? 'rounded-t-lg' : ''
            } ${i === formats.length - 1 ? 'rounded-b-lg' : ''}`}
          >
            Export {FORMAT_LABELS[format]}
          </button>
        ))}
      </div>
    </div>
  );
}
