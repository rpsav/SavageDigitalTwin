import { randomUUID } from 'node:crypto';
import { getDb } from './db';

export type Role = 'user' | 'assistant';

export interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  context_json: string | null;
  created_at: number;
}

export function listConversations(): ConversationRow[] {
  return getDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[];
}

export function createConversation(title: string): string {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, title.slice(0, 80) || 'New chat', now, now);
  return id;
}

export function conversationExists(id: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM conversations WHERE id = ?').get(id);
}

export function getMessages(conversationId: string): MessageRow[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
    .all(conversationId) as MessageRow[];
}

export function addMessage(
  conversationId: string,
  role: Role,
  content: string,
  contextJson?: string
): string {
  const id = randomUUID();
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, context_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, role, content, contextJson ?? null, now);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  return id;
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title.slice(0, 80), id);
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function generateTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed || 'New chat';
}
