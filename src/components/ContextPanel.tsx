'use client';
import MemoryPanel from './MemoryPanel';

export interface Provenance {
  calendarEvents: number;
  emails: number;
}

interface Props {
  provenance: Provenance | null;
  memoryRefreshKey: number;
}

export default function ContextPanel({ provenance, memoryRefreshKey }: Props) {
  return (
    <aside className="w-72 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
      <div className="p-4 space-y-6">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Context referenced
          </h3>
          {provenance && (provenance.calendarEvents || provenance.emails) ? (
            <div className="space-y-1.5 text-sm">
              {provenance.calendarEvents > 0 && (
                <div className="flex items-center gap-2">
                  <span>📅</span>
                  <span className="text-gray-700">
                    {provenance.calendarEvents} calendar event
                    {provenance.calendarEvents === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {provenance.emails > 0 && (
                <div className="flex items-center gap-2">
                  <span>✉️</span>
                  <span className="text-gray-700">
                    {provenance.emails} email{provenance.emails === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              Nothing referenced yet. Ask about your schedule or inbox.
            </p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <MemoryPanel refreshKey={memoryRefreshKey} />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            ⚙ Integrations
          </h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-gray-700">Apple Calendar</span>
              <span className="text-brand-red text-xs">● local</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-700">Apple Mail</span>
              <span className="text-brand-red text-xs">● local</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-gray-400">Outlook (Accenture)</span>
              <span className="text-gray-400 text-xs">○ off</span>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  );
}
