'use client';
import { useEffect, useRef } from 'react';
import type { Message } from '@ai-sdk/react';
import MessageBubble from './MessageBubble';

interface Props {
  messages: Message[];
  status: string;
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-gray-100 border-l-4 border-brand-red rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-brand-red animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function MessageList({ messages, status }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {messages.length === 0 && (
        <p className="text-center text-gray-400 text-sm mt-16 select-none">
          Ask me anything — or press the mic to speak.
        </p>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {(status === 'submitted' || status === 'streaming') && messages.at(-1)?.role !== 'assistant' && (
        <TypingIndicator />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
