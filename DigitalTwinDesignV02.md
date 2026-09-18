# Savage Digital Twin — Phase 2 Design (V02)

> Design for evolving the local chatbot into a full digital twin with calendar/email
> integrations, conversation persistence, and long-term memory.

## 1. Vision & guiding principle

Turn the chatbot into a genuine **digital twin**: it knows your schedule, your inbox, and
remembers everything you've discussed. The single most important design constraint is:

> **Corporate (Accenture) data never leaves your Mac.** Everything — the LLM, the database,
> the embeddings, the OAuth tokens — stays local. This is why we chose Ollama, and it's the
> anchor for every decision below.

---

## 2. Target architecture

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER  (Next.js React frontend)                            │
│  ┌────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Conversation│  │   Chat thread    │  │  Context / Memory │  │
│  │  sidebar    │  │  (STT + TTS)     │  │     panel         │  │
│  └────────────┘  └──────────────────┘  └──────────────────┘  │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP (localhost only)
┌───────────────────────────▼──────────────────────────────────┐
│  NEXT.JS API ROUTES  (server-side, local machine)             │
│                                                                │
│   /api/chat            ← orchestrator (RAG + tool loop)        │
│   /api/conversations   ← list / load / delete history         │
│   /api/memory          ← view / edit long-term memory         │
│   /api/integrations/*  ← calendar & email connectors          │
│   /api/auth/outlook    ← OAuth callback (Microsoft)           │
└───┬─────────────┬──────────────┬──────────────┬───────────────┘
    │             │              │              │
    ▼             ▼              ▼              ▼
┌────────┐  ┌───────────┐  ┌────────────┐  ┌────────────────┐
│ Ollama │  │  SQLite   │  │  Apple     │  │  Microsoft     │
│ llama  │  │  + vector │  │  connectors│  │  Graph / M365  │
│ 3.2 +  │  │  store    │  │ (osascript │  │  (Outlook)     │
│ embed  │  │           │  │  EventKit) │  │  — see §6      │
└────────┘  └───────────┘  └────────────┘  └────────────────┘
   LLM        persistence     local, no       corporate,
   +RAG       + memory        cloud auth      needs auth
```

Everything below the browser runs on your machine. No external network calls except the
Microsoft one (§6), which is the one area needing care.

---

## 3. Component breakdown

| Component | Responsibility | Approach |
|---|---|---|
| **Orchestrator** (`/api/chat`) | Decide what context/tools a message needs, assemble the prompt, stream the answer, persist it | Tool-calling loop with llama3.2 |
| **Persistence** | Store conversations & messages | SQLite (`better-sqlite3`) |
| **Memory / RAG** | Long-term recall across conversations | Embeddings (Ollama `nomic-embed-text`) → vector store |
| **Calendar connectors** | Read Apple + Outlook events | Apple: local scripting; Outlook: Graph API |
| **Email connectors** | Read Apple + Outlook mail | Same split as calendar |
| **Auth** | Hold Microsoft OAuth tokens | macOS Keychain (encrypted) |

---

## 4. Chat orchestration flow (the core loop)

This is what happens on every message once integrations + memory exist:

```
                    ┌─────────────────────────┐
   User message ───▶│ 1. Save msg to SQLite   │
                    └───────────┬─────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │ 2. Retrieve context:    │
                    │   • recent turns (SQL)  │
                    │   • relevant memories   │
                    │     (vector search)     │
                    └───────────┬─────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │ 3. Ask llama3.2 w/ tools│
                    │   defined:              │
                    │   get_calendar_events() │
                    │   search_emails()       │
                    └───────────┬─────────────┘
                                ▼
                     needs a tool?  ──── no ──┐
                                │ yes         │
                                ▼             │
                    ┌─────────────────────┐   │
                    │ 4. Run connector,   │   │
                    │    return data to   │   │
                    │    model (loop)     │   │
                    └───────────┬─────────┘   │
                                ▼             ▼
                    ┌─────────────────────────┐
                    │ 5. Stream final answer  │
                    │    to browser (TTS)     │
                    └───────────┬─────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │ 6. Save answer +        │
                    │    extract & embed new  │
                    │    long-term memories   │
                    └─────────────────────────┘
```

llama3.2 supports native tool calling through Ollama, so step 3–4 is a clean
function-calling loop rather than brittle keyword matching.

---

## 5. Memory system design

Two layers, because they solve different problems:

```
┌───────────────────────────────────────────────────────────┐
│  LAYER 1 — CONVERSATION HISTORY  (verbatim, structured)    │
│  SQLite tables:                                            │
│    conversations(id, title, created_at, updated_at)        │
│    messages(id, conversation_id, role, content, ts)        │
│  → powers the sidebar + "resume a past chat"              │
└───────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────┐
│  LAYER 2 — SEMANTIC MEMORY  (distilled, searchable)       │
│    memories(id, text, source_msg_id, embedding, ts)       │
│  → "facts about you" + salient snippets, embedded         │
│  → retrieved by similarity on every new question         │
└───────────────────────────────────────────────────────────┘
```

**How Layer 2 gets populated:** after each exchange, a lightweight background call asks
llama3.2 "what durable facts/preferences should be remembered from this?" Those get embedded
(`nomic-embed-text`) and stored. On the next question, we embed the query and pull the top-k
most similar memories into the prompt. This is retrieval-augmented generation (RAG) scoped to
*you*.

**Vector store options** (all local):
- `sqlite-vec` — a SQLite extension; keeps everything in the one DB file. **Recommended** for simplicity.
- LanceDB — file-based, fast, richer features.
- Chroma — needs a running service; heavier.

---

## 6. Integration approaches — and the Accenture problem

This is the crux. There are two very different worlds:

### Apple Calendar & Apple Mail (low risk)
Because the app runs on your Mac, we read the native apps locally — no cloud, no OAuth:
- **Calendar** → `EventKit` (a tiny Swift helper) or the `icalBuddy` CLI, invoked from Node.
- **Mail** → AppleScript via `osascript` from Node.
- macOS will prompt once for Calendar/Mail permission. Data never leaves the machine.

### Outlook Calendar & Mail — Accenture tenant (high risk)
This is where security concerns are real. Two viable paths:

| | **Path A: Microsoft Graph API** | **Path B: Outlook for Mac (local scripting)** ⭐ |
|---|---|---|
| How | Register an Azure AD app, OAuth sign-in, call Graph (`Mail.Read`, `Calendars.Read`) | Script the already-signed-in Outlook desktop app locally, like Apple Mail |
| Auth | Needs an app registration in **Accenture's Entra tenant** | None — uses your existing desktop session |
| Blocker risk | **High** — Accenture almost certainly restricts third-party app registrations, requires admin consent, and enforces Conditional Access | Low — no new cloud grant |
| Data path | Corporate data pulled from cloud → your machine | Stays entirely local |
| Recommendation | Only if IT approves | **Preferred** — sidesteps tenant approval and keeps data local |

**Before we build either path**, two non-negotiable checks:
1. **Accenture Acceptable Use / Data Handling policy** — confirm you're permitted to
   programmatically read corporate mail into a local tool. Even with a local LLM, DLP and
   data-governance rules may apply.
2. **No cloud LLM for corporate content, ever** — already satisfied by Ollama, and the
   strongest argument for the local-first design.

**Recommendation: Path B** for Outlook. It treats Outlook exactly like Apple Mail (local
scripting), avoids the Entra approval wall, and keeps Accenture data on your machine.

---

## 7. Requirements & dependencies

### Functional requirements
- FR1 — Persist every conversation; list, resume, rename, delete from a sidebar.
- FR2 — Long-term semantic memory retrieved automatically on each message.
- FR3 — Read upcoming Apple Calendar events on request.
- FR4 — Read/search Apple Mail on request.
- FR5 — Read Outlook calendar & mail (Accenture) — pending policy check.
- FR6 — A memory panel to view/edit/delete what the twin remembers.
- FR7 — Show provenance ("referenced 3 calendar events / 2 emails") for trust.

### Non-functional / security requirements
- NFR1 — All corporate data processing stays local (LLM + DB + embeddings).
- NFR2 — Any OAuth tokens stored in macOS Keychain, never in `.env` / plaintext.
- NFR3 — SQLite DB encrypted at rest (SQLCipher) since it holds email/calendar content.
- NFR4 — Integrations are read-only (no send/modify) in this phase.
- NFR5 — Explicit per-integration consent toggles; nothing connects silently.

### New dependencies
| Need | Package / tool | Notes |
|---|---|---|
| DB | `better-sqlite3` | Fast synchronous SQLite |
| Encryption at rest | SQLCipher / `@journeyapps/sqlcipher` | For NFR3 |
| Vector search | `sqlite-vec` | Keeps memory in the same DB |
| Embeddings | Ollama `nomic-embed-text` | `ollama pull nomic-embed-text` |
| Apple Calendar | `icalBuddy` or small Swift/EventKit helper | Local |
| Apple/Outlook Mail | `osascript` (built-in) | Local |
| Outlook (if Path A) | `@azure/msal-node`, `@microsoft/microsoft-graph-client` | Only if IT-approved |
| Keychain | `keytar` | Token storage |

Several of these (`osascript`, `icalBuddy`) are local CLI calls, not npm packages —
consistent with keeping the dependency footprint small.

---

## 8. Proposed UI changes + wireframes

### Current
Single full-screen chat column.

### Proposed — three-pane layout

```
┌────────────┬───────────────────────────────────┬───────────────┐
│  ● Savage  │        Savage Digital Twin         │   CONTEXT     │
│  Digital   ├───────────────────────────────────┤               │
│  Twin      │                                   │  📅 Calendar  │
│            │   ┌─────────────────────────┐     │   3 events    │
│ [+ New chat]│   │ You: what's on tomorrow?│     │   referenced  │
│            │   └─────────────────────────┘     │               │
│ ─────────  │   ┌─────────────────────────┐     │  ✉️  Mail     │
│ TODAY      │   │ Twin: You have 3 meetings│     │   2 emails    │
│ ▸ Tomorrow │   │  ▍streaming...          │     │   referenced  │
│   schedule │   └─────────────────────────┘     │               │
│ ▸ Q3 plan  │                                   │  🧠 Memory    │
│            │                                   │   "Prefers    │
│ YESTERDAY  │                                   │    morning    │
│ ▸ Email    │                                   │    meetings"  │
│   triage   │                                   │               │
│ ▸ Weekly   │                                   │  ⚙ Integrations│
│   review   │                                   │   Apple  ● on │
│            │                                   │   Outlook ○off│
│ ──────────  ├───────────────────────────────────┤               │
│ ⚙ Settings │ [🎤] [ type a message… ] [🔊] [Send]│               │
└────────────┴───────────────────────────────────┴───────────────┘
   sidebar            chat (existing)               context panel
   (new)                                            (new)
```

Keeps the red/white/black theme: sidebar + panel white, black header accents, red for
active/live indicators (streaming dot, "on" toggles).

### Settings / integrations screen (new)

```
┌──────────────────────────────────────────────────┐
│  Integrations                                      │
│                                                    │
│  Apple Calendar        [ Connect ]   ○ Not linked  │
│  Apple Mail            [ Connect ]   ○ Not linked  │
│  ─────────────────────────────────────────────    │
│  ⚠ Accenture (corporate) — read-only               │
│  Outlook Calendar      [ Connect ]   ○ Not linked  │
│  Outlook Mail          [ Connect ]   ○ Not linked  │
│                                                    │
│  ☑ Keep all corporate data on this device only     │
│  ☑ Store database encrypted                        │
└──────────────────────────────────────────────────┘
```

### Memory panel (new)

```
┌──────────────────────────────────────────────────┐
│  What your twin remembers            [ Clear all ] │
│                                                    │
│  • Works at Accenture                        [🗑]  │
│  • Prefers morning meetings                  [🗑]  │
│  • Reports to … / project "…"                [🗑]  │
│  • Dislikes back-to-back calls               [🗑]  │
│                                                    │
│  Editable — you control the twin's memory.         │
└──────────────────────────────────────────────────┘
```

Direct control over memory is both a trust feature and a privacy safeguard (NFR).

---

## 9. Suggested phased roadmap

Build the foundation first, tackle the risky corporate integration last:

```
Phase 2a  Persistence + history     → SQLite, sidebar, resume chats
          (no external data; safe)

Phase 2b  Memory / RAG              → embeddings, vector store,
                                      memory panel

Phase 2c  Apple integrations        → Calendar + Mail via local
                                      scripting + tool-calling loop

Phase 2d  Outlook integrations      → ONLY after Accenture policy
          (gated on policy check)     check; prefer local scripting
```

Each phase is independently useful and shippable.

---

## 10. Open decisions

1. **Outlook approach** — Path B (local Outlook-for-Mac scripting, recommended) or Path A
   (Graph API, needs Accenture IT)? Or defer Outlook entirely for now?
2. **Accenture policy** — confirm whether policy permits reading corporate mail/calendar into
   a local tool. Gates Phase 2d.
3. **Vector store** — confirm `sqlite-vec` (simplest, one DB file).
4. **Build scope** — suggested start: Phase 2a + 2b (persistence + memory, all local and
   safe), then Apple, then revisit Outlook.
