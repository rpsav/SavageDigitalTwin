import { SYSTEM_PROMPT } from '@/lib/system-prompt';
import {
  createConversation,
  conversationExists,
  addMessage,
  generateTitle,
} from '@/lib/conversations';
import { retrieveMemories, extractMemories } from '@/lib/memory';
import { TOOL_DEFINITIONS, runTool, type Provenance } from '@/lib/tools';

const OLLAMA_URL = 'http://localhost:11434/v1/chat/completions';
const MODEL = 'llama3.2';
const MAX_TOOL_ROUNDS = 3;

interface IncomingMessage {
  role: string;
  content: string;
}

interface OllamaMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

// Heuristic: does this message plausibly need calendar/email tools? llama3.2 over-calls
// tools whenever they are attached, so we only attach them for relevant *questions/requests*.
// Requires a topic keyword AND a query/request signal, so plain statements
// ("I prefer morning meetings") don't trigger a calendar lookup.
const TOPIC_KEYWORDS =
  /\b(calendar|schedule|scheduled|meeting|meetings|appointment|appointments|availability|available|free time|busy|event|events|diary|agenda|tomorrow|today|tonight|this week|next week|email|emails|e-mail|mail|inbox|unread)\b/i;

const QUERY_SIGNALS =
  /\?|\b(what|when|where|who|which|how many|do i|am i|is there|are there|have i|show|check|find|list|tell me|any|get|look up|pull up|remind)\b/i;

function needsTools(text: string): boolean {
  return TOPIC_KEYWORDS.test(text) && QUERY_SIGNALS.test(text);
}

function buildSystemPrompt(memories: string[]): string {
  const now = new Date();
  const dateLine = `Today's date is ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-GB', { weekday: 'long' })}).`;
  const memoryBlock = memories.length
    ? `\n\nRelevant things you remember about Richard:\n${memories.map((m) => `- ${m}`).join('\n')}`
    : '';
  return `${SYSTEM_PROMPT}\n\n${dateLine}${memoryBlock}`;
}

function ollamaBody(messages: OllamaMessage[], withTools: boolean, stream: boolean) {
  return JSON.stringify({
    model: MODEL,
    messages,
    stream,
    ...(withTools ? { tools: TOOL_DEFINITIONS } : {}),
  });
}

// Non-streaming tool-resolution loop. Mutates `messages` with assistant tool calls +
// tool results, and accumulates provenance. Reliable because Ollama parses tool_calls
// cleanly in non-streaming mode.
async function resolveTools(messages: OllamaMessage[], provenance: Provenance): Promise<void> {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ollamaBody(messages, true, false),
    });
    if (!res.ok) return;
    const msg = (await res.json())?.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        /* keep empty args */
      }
      const result = await runTool(String(tc.function?.name ?? ''), args, provenance);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
}

// Streams a final (tool-free) answer, forwarding text tokens to `onToken`.
async function streamAnswer(
  messages: OllamaMessage[],
  onToken: (t: string) => void
): Promise<void> {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ollamaBody(messages, false, true),
  });
  if (!res.ok || !res.body) {
    onToken('\n[Error contacting local model]');
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;
      try {
        const token = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (token) onToken(token);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
  reader.releaseLock();
}

export async function POST(req: Request) {
  const body = await req.json();
  const incoming: IncomingMessage[] = body.messages ?? [];
  let conversationId: string | undefined = body.conversationId;

  const lastUser = [...incoming].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUser?.content ?? '';

  if (!conversationId || !conversationExists(conversationId)) {
    conversationId = createConversation(generateTitle(lastUserText));
  }
  if (lastUserText) addMessage(conversationId, 'user', lastUserText);

  const memories = await retrieveMemories(lastUserText).catch(() => []);
  const ollamaMessages: OllamaMessage[] = [
    { role: 'system', content: buildSystemPrompt(memories) },
    ...incoming.map((m) => ({ role: m.role, content: m.content })),
  ];

  const provenance: Provenance = { calendarEvents: 0, emails: 0 };
  const encoder = new TextEncoder();
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = '';
      try {
        if (needsTools(lastUserText)) {
          await resolveTools(ollamaMessages, provenance);
        }
        await streamAnswer(ollamaMessages, (t) => {
          assistantText += t;
          controller.enqueue(encoder.encode(t));
        });
      } finally {
        const contextJson =
          provenance.calendarEvents || provenance.emails ? JSON.stringify(provenance) : undefined;
        const assistantMsgId = addMessage(convId, 'assistant', assistantText, contextJson);
        controller.close();
        void extractMemories(lastUserText, assistantText, assistantMsgId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Conversation-Id': convId,
    },
  });
}
