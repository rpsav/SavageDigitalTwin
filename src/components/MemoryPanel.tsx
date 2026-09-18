'use client';
import { useCallback, useEffect, useState } from 'react';

interface Memory {
  id: string;
  text: string;
  created_at: number;
}

export default function MemoryPanel({ refreshKey }: { refreshKey: number }) {
  const [memories, setMemories] = useState<Memory[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/memory');
    if (res.ok) setMemories(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const remove = async (id: string) => {
    await fetch(`/api/memory/${id}`, { method: 'DELETE' });
    load();
  };

  const clearAll = async () => {
    await fetch('/api/memory', { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          🧠 Memory
        </h3>
        {memories.length > 0 && (
          <button onClick={clearAll} className="text-[11px] text-gray-400 hover:text-brand-red">
            Clear all
          </button>
        )}
      </div>
      {memories.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing remembered yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {memories.map((m) => (
            <li key={m.id} className="group flex items-start gap-1 text-xs text-gray-700">
              <span className="flex-1">• {m.text}</span>
              <button
                onClick={() => remove(m.id)}
                title="Forget"
                className="hidden group-hover:block text-gray-400 hover:text-brand-red"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
