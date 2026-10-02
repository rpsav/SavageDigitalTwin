import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { embed, toBlob } from './embeddings';
import { createLogger, preview, since } from './log';

const log = createLogger('memory');

export interface MemoryRow {
  id: string;
  text: string;
  source_msg_id: string | null;
  created_at: number;
}

const OLLAMA_CHAT_URL = 'http://localhost:11434/v1/chat/completions';

export interface MemoryContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function storeMemory(text: string, sourceMsgId?: string): Promise<void> {
  const clean = text.trim();
  if (!clean) {
    log.debug('storeMemory skipped: empty text');
    return;
  }
  const id = randomUUID();
  log.debug(`storing memory ${id}: "${preview(clean)}"`);
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
  log.info(`stored memory ${id} (source message ${sourceMsgId ?? 'none'}): "${preview(clean)}"`);
}

export async function retrieveMemories(query: string, k = 5): Promise<string[]> {
  const started = Date.now();
  log.debug(`retrieving up to ${k} memories for query: "${preview(query)}"`);
  let vector: number[];
  try {
    vector = await embed(query);
  } catch (error) {
    log.error('retrieval failed while creating the query embedding:', error);
    return [];
  }
  try {
    const rows = getDb()
      .prepare(
        `SELECT m.text AS text
         FROM vec_memories v
         JOIN memories m ON m.id = v.memory_id
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance`
      )
      .all(toBlob(vector), k) as { text: string }[];
    log.info(`retrieved ${rows.length} memories in ${since(started)}`);
    rows.forEach((r, i) => log.debug(`  hit ${i + 1}: "${preview(r.text)}"`));
    return rows.map((r) => r.text);
  } catch (error) {
    log.error('retrieval failed while searching stored memories:', error);
    return [];
  }
}

export function listMemories(): MemoryRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM memories ORDER BY created_at DESC')
    .all() as MemoryRow[];
  log.debug(`listed ${rows.length} memories`);
  return rows;
}

export function deleteMemory(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    db.prepare('DELETE FROM vec_memories WHERE memory_id = ?').run(id);
  });
  tx();
  log.info(`deleted memory ${id}`);
}

export function clearMemories(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM vec_memories').run();
  });
  tx();
  log.info('cleared all memories');
}

const EXTRACT_PROMPT = `You extract durable facts about the user (the person chatting) for long-term memory.

You receive a short conversation transcript. Output ONLY a JSON array of complete sentences about the user, each starting with "The user". Extract only facts newly stated or confirmed by the user in the final USER message, including their name, preferences, habits, relationships, role details, important dates, and facts they explicitly ask you to remember. Use preceding messages only to resolve references such as "remember that". An assistant statement is not a fact unless the user supplied or clearly confirmed it. Do not store guesses, failed lookups, questions, promises, or small talk.

Example:
Transcript:
USER: I work in the London office and I hate early starts.
Output: ["The user works in the London office.", "The user dislikes early starts."]

Example:
Transcript:
ASSISTANT: You said your birthday is 12 May.
USER: Please remember that.
Output: ["The user's birthday is 12 May."]

Example:
Transcript:
USER: Please remember my name is Sam.
Output: ["The user's name is Sam."]

Example:
Transcript:
USER: Please extract my birthday from the calendar.
ASSISTANT: I could not determine your birthday.
Output: []`;

export async function extractMemories(
  messages: MemoryContextMessage[],
  sourceMsgId?: string
): Promise<void> {
  const started = Date.now();
  try {
    const transcript = messages
      .filter((message) => message.content.trim())
      .slice(-12)
      .map((message) => `${message.role.toUpperCase()}: ${message.content.trim()}`)
      .join('\n');
    if (!transcript) {
      log.debug('extraction skipped: empty transcript');
      return;
    }
    log.debug(`extraction started (${messages.length} messages, transcript ${transcript.length} chars):\n${transcript}`);

    const res = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: `Transcript:\n${transcript}` },
        ],
      }),
    });
    if (!res.ok) {
      log.error(`extraction failed: Ollama returned ${res.status} ${res.statusText}`);
      return;
    }
    const content: string = (await res.json())?.choices?.[0]?.message?.content ?? '[]';
    log.debug(`extraction raw model output: ${content}`);
    // llama3.2 sometimes emits one array per fact, so parse each array separately.
    const facts: unknown[] = [];
    for (const [chunk] of content.matchAll(/\[[^\[\]]*\]/g)) {
      try {
        const parsed: unknown = JSON.parse(chunk);
        if (Array.isArray(parsed)) facts.push(...parsed);
      } catch {
        log.warn(`extraction skipped malformed JSON chunk: ${preview(chunk)}`);
      }
    }
    if (facts.length === 0) log.info(`extraction found no facts in ${since(started)}`);
    let stored = 0;
    for (const fact of facts) {
      if (typeof fact === 'string') {
        const clean = fact.replace(/^[^A-Za-z0-9]+/, '').trim();
        if (clean) {
          await storeMemory(clean, sourceMsgId);
          stored++;
        }
      } else {
        log.warn(`extraction ignored non-string fact: ${JSON.stringify(fact)}`);
      }
    }
    if (facts.length > 0) log.info(`extraction stored ${stored}/${facts.length} facts in ${since(started)}`);
  } catch (error) {
    // Memory remains best-effort, but failures must be visible to the operator.
    log.error('extraction failed:', error);
  }
}
