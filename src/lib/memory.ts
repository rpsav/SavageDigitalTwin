import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { embed, toBlob } from './embeddings';

export interface MemoryRow {
  id: string;
  text: string;
  source_msg_id: string | null;
  created_at: number;
}

const OLLAMA_CHAT_URL = 'http://localhost:11434/v1/chat/completions';

export async function storeMemory(text: string, sourceMsgId?: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const id = randomUUID();
  const vector = await embed(clean);

  const db = getDb();
  const insertMemory = db.prepare(
    'INSERT INTO memories (id, text, source_msg_id, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertVec = db.prepare(
    'INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)'
  );
  const tx = db.transaction(() => {
    insertMemory.run(id, clean, sourceMsgId ?? null, Date.now());
    insertVec.run(id, toBlob(vector));
  });
  tx();
}

export async function retrieveMemories(query: string, k = 5): Promise<string[]> {
  let vector: number[];
  try {
    vector = await embed(query);
  } catch {
    return [];
  }
  const rows = getDb()
    .prepare(
      `SELECT m.text AS text
       FROM vec_memories v
       JOIN memories m ON m.id = v.memory_id
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`
    )
    .all(toBlob(vector), k) as { text: string }[];
  return rows.map((r) => r.text);
}

export function listMemories(): MemoryRow[] {
  return getDb()
    .prepare('SELECT * FROM memories ORDER BY created_at DESC')
    .all() as MemoryRow[];
}

export function deleteMemory(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    db.prepare('DELETE FROM vec_memories WHERE memory_id = ?').run(id);
  });
  tx();
}

export function clearMemories(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM vec_memories').run();
  });
  tx();
}

const EXTRACT_PROMPT = `You extract durable facts about the user Richard for long-term memory. Output ONLY a JSON array of complete sentences about Richard. Extract stated preferences, habits, relationships, and role details. Ignore questions and small talk.

Example:
Input: I work in the London office and I hate early starts.
Output: ["Richard works in the London office.", "Richard dislikes early starts."]

Example:
Input: What time is it?
Output: []`;

export async function extractMemories(
  userMsg: string,
  _assistantMsg: string,
  sourceMsgId?: string
): Promise<void> {
  try {
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: userMsg },
        ],
      }),
    });
    if (!res.ok) return;
    const content: string = (await res.json())?.choices?.[0]?.message?.content ?? '[]';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return;
    const facts: unknown = JSON.parse(match[0]);
    if (!Array.isArray(facts)) return;
    for (const fact of facts) {
      if (typeof fact === 'string') {
        const clean = fact.replace(/^[^A-Za-z0-9]+/, '').trim();
        if (clean) await storeMemory(clean, sourceMsgId);
      }
    }
  } catch {
    // memory extraction is best-effort; never block the chat
  }
}
