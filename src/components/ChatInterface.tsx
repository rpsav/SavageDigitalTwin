'use client';
import { useChat, type Message } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import Sidebar, { type ConversationSummary } from './Sidebar';
import ContextPanel, { type Provenance } from './ContextPanel';

interface DbMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  context_json: string | null;
}

export default function ChatInterface() {
  const activeIdRef = useRef<string | undefined>(undefined);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);

  const refreshConversations = useCallback(async () => {
    const res = await fetch('/api/conversations');
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Custom fetch: inject conversationId into the request, capture it from the response
  const chatFetch = useCallback<typeof fetch>(async (input, init) => {
    let body = init?.body;
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        parsed.conversationId = activeIdRef.current;
        body = JSON.stringify(parsed);
      } catch {
        /* leave body untouched */
      }
    }
    const res = await fetch(input, { ...init, body });
    const newId = res.headers.get('X-Conversation-Id');
    if (newId && newId !== activeIdRef.current) {
      activeIdRef.current = newId;
      setActiveConversationId(newId);
    }
    return res;
  }, []);

  const { messages, input, handleInputChange, handleSubmit, append, status, setMessages } =
    useChat({
      api: '/api/chat',
      streamProtocol: 'text',
      fetch: chatFetch,
      onFinish: async () => {
        await refreshConversations();
        setMemoryRefreshKey((k) => k + 1);
        if (activeIdRef.current) {
          const res = await fetch(`/api/conversations/${activeIdRef.current}`);
          if (res.ok) {
            const rows: DbMessage[] = await res.json();
            const lastAssistant = [...rows].reverse().find((m) => m.role === 'assistant');
            setProvenance(
              lastAssistant?.context_json ? JSON.parse(lastAssistant.context_json) : null
            );
          }
        }
      },
    });

  const [ttsEnabled, setTtsEnabled] = useState(false);
  const prevStatusRef = useRef(status);
  const { speak, cancel } = useTextToSpeech();

  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready' && ttsEnabled) {
      const last = messages.at(-1);
      if (last?.role === 'assistant' && last.content) speak(last.content);
    }
    prevStatusRef.current = status;
  }, [status, messages, ttsEnabled, speak]);

  const handleMicResult = (transcript: string) => {
    append({ role: 'user', content: transcript });
  };
  const { isListening, startListening, stopListening, supported } =
    useSpeechRecognition(handleMicResult);

  const handleMicToggle = () => (isListening ? stopListening() : startListening());
  const handleTTSToggle = () =>
    setTtsEnabled((prev) => {
      if (prev) cancel();
      return !prev;
    });

  const handleNewChat = () => {
    activeIdRef.current = undefined;
    setActiveConversationId(undefined);
    setMessages([]);
    setProvenance(null);
  };

  const handleSelectConversation = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const rows: DbMessage[] = await res.json();
    activeIdRef.current = id;
    setActiveConversationId(id);
    setMessages(
      rows.map<Message>((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        parts: [{ type: 'text', text: m.content }],
      }))
    );
    const lastAssistant = [...rows].reverse().find((m) => m.role === 'assistant');
    setProvenance(lastAssistant?.context_json ? JSON.parse(lastAssistant.context_json) : null);
  };

  const handleDeleteConversation = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (id === activeIdRef.current) handleNewChat();
    refreshConversations();
  };

  const handleRenameConversation = async (id: string, title: string) => {
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    refreshConversations();
  };

  const isDisabled = status === 'submitted' || status === 'streaming';

  return (
    <div className="flex h-full">
      <Sidebar
        conversations={conversations}
        activeId={activeConversationId}
        onNewChat={handleNewChat}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <header className="bg-brand-black text-white px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="w-2 h-2 rounded-full bg-brand-red" />
          <h1 className="text-lg font-semibold tracking-tight">Savage Digital Twin</h1>
        </header>

        <MessageList messages={messages} status={status} />

        <ChatInput
          input={input}
          onInputChange={handleInputChange}
          onSubmit={() => handleSubmit()}
          disabled={isDisabled}
          ttsEnabled={ttsEnabled}
          onTTSToggle={handleTTSToggle}
          micListening={isListening}
          micSupported={supported}
          onMicToggle={handleMicToggle}
        />
      </div>

      <ContextPanel provenance={provenance} memoryRefreshKey={memoryRefreshKey} />
    </div>
  );
}
