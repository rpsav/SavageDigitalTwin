'use client';
import type { Message } from '@ai-sdk/react';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const text = message.content;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-brand-black text-white rounded-2xl rounded-br-sm'
            : 'bg-gray-100 text-gray-900 border-l-4 border-brand-red rounded-2xl rounded-bl-sm'
        }`}
      >
        {text}
      </div>
    </div>
  );
}
