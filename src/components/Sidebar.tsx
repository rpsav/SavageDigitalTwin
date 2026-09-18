'use client';
import { useState } from 'react';

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface Props {
  conversations: ConversationSummary[];
  activeId?: string;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Older';
}

export default function Sidebar({
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const groups: Record<string, ConversationSummary[]> = {};
  for (const c of conversations) {
    const g = groupLabel(c.updated_at);
    (groups[g] ??= []).push(c);
  }
  const order = ['Today', 'Yesterday', 'Older'];

  const commitRename = (id: string) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  };

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center gap-2 px-2 py-1 mb-3">
          <div className="w-2 h-2 rounded-full bg-brand-red" />
          <span className="text-sm font-semibold">Savage Digital Twin</span>
        </div>
        <button
          onClick={onNewChat}
          className="w-full bg-brand-black text-white text-sm rounded-xl py-2 hover:bg-gray-800 active:scale-[.98] transition-all"
        >
          + New chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-6">No conversations yet</p>
        )}
        {order.map((label) =>
          groups[label]?.length ? (
            <div key={label} className="mb-4">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 px-2 mb-1">
                {label}
              </p>
              {groups[label].map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center rounded-lg px-2 py-1.5 text-sm cursor-pointer ${
                    c.id === activeId
                      ? 'bg-gray-100 border-l-2 border-brand-red'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => editingId !== c.id && onSelect(c.id)}
                >
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(c.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-1 text-sm focus:outline-none focus:ring-1 focus:ring-brand-red"
                    />
                  ) : (
                    <span className="flex-1 truncate">{c.title}</span>
                  )}
                  <span className="hidden group-hover:flex items-center gap-1 ml-1">
                    <button
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(c.id);
                        setDraft(c.title);
                      }}
                      className="text-gray-400 hover:text-brand-black text-xs px-1"
                    >
                      ✎
                    </button>
                    <button
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      className="text-gray-400 hover:text-brand-red text-xs px-1"
                    >
                      🗑
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null
        )}
      </nav>
    </aside>
  );
}
