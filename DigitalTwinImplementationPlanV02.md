# Digital Twin — Implementation Plan (Phases 2a / 2b / 2c)

Companion to [DigitalTwinDesignV02.md](DigitalTwinDesignV02.md). Covers persistence +
history (2a), memory/RAG with `sqlite-vec` (2b), and Apple calendar/mail integrations via
tool-calling (2c). Vector store decision: **`sqlite-vec`** (confirmed).

Everything runs locally. No corporate data leaves the machine.

---

## Sequencing & rationale

```
2a  Persistence + history   →  foundation everything else writes to
2b  Memory / RAG            →  builds on the same SQLite DB
2c  Apple integrations      →  adds the tool-calling loop to /api/chat
```

Each phase is independently shippable and testable.

---

## Prerequisites (one-time, before coding)

```bash
# Embedding model for phase 2b
ollama pull nomic-embed-text          # 768-dim embeddings

# Apple Calendar reader for phase 2c
brew install ical-buddy               # CLI used by the calendar connector
```

`next.config.ts` — mark native/SQLite packages as server-external so Next.js doesn't try to
bundle them for the browser:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],
};

export default nextConfig;
```

`.gitignore` — add the local data directory:

```
/data
```

---

# Phase 2a — Persistence + conversation history

**Goal:** every message is stored in SQLite; a sidebar lists past conversations; clicking one
resumes it.

### Dependencies
- `better-sqlite3` (synchronous SQLite driver)

### Data model — `src/lib/db.ts` (new)
Singleton DB (survives Next.js hot reload via a `globalThis` cache). DB file at `./data/twin.db`.

```ts
// Tables created on first import:
conversations(
  id          TEXT PRIMARY KEY,      // uuid
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,      // epoch ms
  updated_at  INTEGER NOT NULL
)
messages(
  id              TEXT PRIMARY KEY,  // uuid
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,     // 'user' | 'assistant'
  content         TEXT NOT NULL,
  context_json    TEXT,              // provenance, filled in phase 2c
  created_at      INTEGER NOT NULL
)
```

Key pattern for the singleton (avoids "database is locked" / re-open on hot reload):

```ts
const g = globalThis as unknown as { __twinDb?: Database.Database };
export const db = g.__twinDb ?? (g.__twinDb = openDb());
```

### Data-access helpers — `src/lib/conversations.ts` (new)
- `listConversations()` → `{id, title, updated_at}[]` ordered by `updated_at desc`
- `createConversation(title)` → id
- `getMessages(conversationId)` → messages ordered by `created_at`
- `addMessage(conversationId, role, content)` → id (also bumps `conversations.updated_at`)
- `renameConversation(id, title)`
- `deleteConversation(id)`
- `generateTitle(firstUserMessage)` → truncate to ~40 chars for now (LLM-based titling optional later)

### API routes (new)
| Route | Method | Purpose |
|---|---|---|
| `src/app/api/conversations/route.ts` | GET | list conversations |
| | POST | create a conversation |
| `src/app/api/conversations/[id]/route.ts` | GET | messages for a conversation |
| | PATCH | rename |
| | DELETE | delete |

### Modify `src/app/api/chat/route.ts`
- Accept `{ messages, conversationId }` in the body.
- If no `conversationId`, create a conversation (title from first user message).
- Persist the **user** message before calling Ollama.
- While streaming to the client, **accumulate** the assistant text; on stream close, persist
  the **assistant** message. Pattern — accumulate inside the existing `ReadableStream`:

```ts
let assistantText = '';
// ...inside the token loop:
if (token) { assistantText += token; controller.enqueue(encoder.encode(token)); }
// ...in finally, before controller.close():
addMessage(conversationId, 'assistant', assistantText);
```

- Return the (possibly new) `conversationId` to the client via a response header
  (`X-Conversation-Id`) so a fresh chat can adopt the server-created id.

### Frontend
- **`src/components/Sidebar.tsx`** (new): "＋ New chat" button, grouped conversation list
  (Today / Yesterday / Older), click to load, hover for rename + delete. White bg, black text,
  red active-item accent.
- **`src/app/page.tsx`**: switch to two-pane flex layout — `Sidebar` + `ChatInterface`.
- **`src/components/ChatInterface.tsx`**:
  - Hold `activeConversationId` in state.
  - Pass `id` + `initialMessages` to `useChat` (it supports both) when loading a past chat.
  - Use `useChat`'s `body: { conversationId }` option so the id reaches the route.
  - Read `X-Conversation-Id` from the response (via a custom `fetch` passed to `useChat`) to
    capture server-created ids and refresh the sidebar.
  - "New chat" clears messages and `activeConversationId`.

### Verification (2a)
1. Send a message → row appears in `conversations` + two rows in `messages` (`sqlite3 data/twin.db`).
2. Reload the page → conversation shows in sidebar; clicking it restores the thread.
3. Rename and delete work; delete cascades to messages.
4. `npm run build` clean.

---

# Phase 2b — Memory / RAG with `sqlite-vec`

**Goal:** the twin remembers durable facts across conversations and pulls the relevant ones
into context automatically; a memory panel lets you view/delete them.

### Dependencies
- `sqlite-vec` (loadable SQLite extension; npm ships the binaries)
- Ollama `nomic-embed-text` (from prerequisites)

### Schema additions — extend `src/lib/db.ts`
Load the extension right after opening the DB: `import * as sqliteVec from 'sqlite-vec'; sqliteVec.load(db);`

```ts
memories(
  id           TEXT PRIMARY KEY,     // uuid
  text         TEXT NOT NULL,
  source_msg_id TEXT,                // optional link back to a message
  created_at   INTEGER NOT NULL
)
-- vec0 virtual table, linked by id:
CREATE VIRTUAL TABLE vec_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[768]
)
```

Embeddings are written as a little-endian float32 blob:
`Buffer.from(new Float32Array(embedding).buffer)`.

### `src/lib/embeddings.ts` (new)
```ts
export async function embed(text: string): Promise<number[]> {
  const r = await fetch('http://localhost:11434/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', input: text }),
  });
  return (await r.json()).data[0].embedding; // 768 floats
}
```

### `src/lib/memory.ts` (new)
- `storeMemory(text, sourceMsgId?)` → embed, insert into both tables.
- `retrieveMemories(query, k = 5)` → embed query, `WHERE embedding MATCH ? ORDER BY distance
  LIMIT k`, join back to `memories` for text.
- `extractMemories(userMsg, assistantMsg)` → **non-blocking** llama3.2 call asking for a JSON
  array of durable facts/preferences worth remembering; parse defensively, store each.
  (Prompt returns `[]` when nothing is worth keeping.)
- `listMemories()`, `deleteMemory(id)`, `clearMemories()`.

### Wire into `src/app/api/chat/route.ts`
- **Before** the LLM call: `const mems = await retrieveMemories(latestUserText);` inject a
  block into the system prompt: `"Relevant things you remember about Richard:\n- …"`.
- **After** the assistant message is persisted: fire `extractMemories(...)` without awaiting
  (log errors) so it never blocks the response.

### Memory API + UI
| Route | Method | Purpose |
|---|---|---|
| `src/app/api/memory/route.ts` | GET | list memories |
| | DELETE | clear all |
| `src/app/api/memory/[id]/route.ts` | DELETE | delete one |

- **`src/components/MemoryPanel.tsx`** (new): list of memories, per-item 🗑, "Clear all".
  Surfaced from a right-hand panel or a Settings tab (see 2c UI note).

### Verification (2b)
1. Tell the twin a durable fact ("I prefer morning meetings"). Confirm a row lands in
   `memories` + `vec_memories`.
2. In a **new** conversation, ask something related; confirm the fact is retrieved (log the
   retrieved memories server-side) and reflected in the answer.
3. Memory panel lists it; delete removes it from both tables.
4. `npm run build` clean.

---

# Phase 2c — Apple Calendar & Mail (local, via tool-calling)

**Goal:** the twin can read your Apple Calendar and Mail on demand, deciding for itself when
to via tool-calling, and shows provenance ("referenced N events / M emails").

### Dependencies
- `ical-buddy` (from prerequisites) — calendar
- `osascript` (built into macOS) — mail
- No new npm packages.

### Connectors — `src/lib/connectors/` (new)
- **`appleCalendar.ts`** — `getCalendarEvents(startISO, endISO)`: spawn `icalBuddy` (e.g.
  `icalBuddy -nc -b "" eventsFrom:… to:…`), parse into `{title, start, end, location}[]`.
- **`appleMail.ts`** — `searchEmails(query, limit)`: run an AppleScript via `osascript`
  against Mail.app, return `{from, subject, date, snippet}[]`.
- Both wrapped in try/catch; return a structured `{error}` the model can relay (e.g. macOS
  permission not yet granted). macOS prompts for Calendar/Automation access on first run.

> Note: if/when Outlook (2d) is added, it plugs in here as sibling connectors behind the same
> tool interface — no orchestrator change needed.

### Tool-calling loop — rework `src/app/api/chat/route.ts`
Introduce a two-stage flow (tools resolved non-streaming, final answer streamed):

```
1. POST /v1/chat/completions (stream:false) with tools:
     get_calendar_events(start, end)
     search_emails(query, limit)
2. If message.tool_calls present:
     run each connector → append {role:'tool', tool_call_id, content} messages
     record provenance (counts + which tools)  → loop back to step 1
   else: proceed
3. Final POST /v1/chat/completions (stream:true) → stream tokens to client
     (existing accumulate-and-persist logic from 2a still applies)
```

Define tool schemas in `src/lib/tools.ts` (new): JSON-schema function definitions + a
`runTool(name, args)` dispatcher that calls the connectors. Cap the tool loop (e.g. max 3
iterations) to avoid runaway calls.

### Provenance transport (for the Context panel)
Provenance is known **before** the final stream starts. Send it as a response header the
client reads via the custom `fetch` already added in 2a:

```
X-Twin-Context: {"calendarEvents":3,"emails":2}
```

Persist the same JSON into `messages.context_json` for the assistant row so it survives reload.

### UI — move to three-pane layout
- **`src/components/ContextPanel.tsx`** (new): shows the latest provenance ("📅 3 events",
  "✉️ 2 emails referenced") and hosts the **MemoryPanel** (2b) and an **Integrations** section
  with per-source on/off status.
- **`src/app/page.tsx`**: `Sidebar | ChatInterface | ContextPanel` (per wireframe in the
  design doc). Panel collapsible on narrow widths.
- **`src/components/ChatInterface.tsx`**: capture `X-Twin-Context` from the response and hold
  it in state to feed the ContextPanel.

### Verification (2c)
1. Ask "what's on my calendar tomorrow?" → server logs a `get_calendar_events` tool call;
   real events appear in the answer; Context panel shows the event count.
2. Ask "any emails from <person> this week?" → `search_emails` runs; results summarized.
3. Deny macOS permission once → twin reports it can't access, doesn't crash.
4. Reload a past conversation → provenance restored from `context_json`.
5. `npm run build` clean.

---

## Cross-cutting concerns

- **DB singleton**: one `better-sqlite3` connection cached on `globalThis`; enable
  `PRAGMA journal_mode = WAL` for concurrent reads.
- **Server-only imports**: `db.ts`, connectors, and `osascript`/`icalBuddy` calls must only be
  imported from API routes (never client components) — enforced by `serverExternalPackages`.
- **Error handling at boundaries**: Ollama down, extension load failure, connector permission
  denied — each returns a clean message rather than a 500 where possible.
- **Read-only**: connectors never modify calendar/mail in this phase (NFR4).
- **Encryption at rest (NFR3)**: deferred to a later hardening pass; note that `data/twin.db`
  will contain calendar/email content once 2c lands, so keep `/data` gitignored and local.

## Dependency summary

| Phase | npm | system / models |
|---|---|---|
| 2a | `better-sqlite3` | — |
| 2b | `sqlite-vec` | `ollama pull nomic-embed-text` |
| 2c | — | `brew install ical-buddy`, `osascript` (built-in) |

## New / changed files at a glance

```
New:
  src/lib/db.ts
  src/lib/conversations.ts
  src/lib/embeddings.ts
  src/lib/memory.ts
  src/lib/tools.ts
  src/lib/connectors/appleCalendar.ts
  src/lib/connectors/appleMail.ts
  src/app/api/conversations/route.ts
  src/app/api/conversations/[id]/route.ts
  src/app/api/memory/route.ts
  src/app/api/memory/[id]/route.ts
  src/components/Sidebar.tsx
  src/components/MemoryPanel.tsx
  src/components/ContextPanel.tsx

Changed:
  next.config.ts            (serverExternalPackages)
  .gitignore                (/data)
  src/app/api/chat/route.ts (persistence → memory → tool loop, incrementally)
  src/app/page.tsx          (two-pane → three-pane)
  src/components/ChatInterface.tsx (conversation state, custom fetch, context state)
```
