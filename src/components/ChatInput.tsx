'use client';
import { type KeyboardEvent, type ChangeEvent } from 'react';
import MicButton from './MicButton';
import TTSToggle from './TTSToggle';

interface Props {
  input: string;
  onInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
  ttsEnabled: boolean;
  onTTSToggle: () => void;
  micListening: boolean;
  micSupported: boolean;
  onMicToggle: () => void;
}

export default function ChatInput({
  input,
  onInputChange,
  onSubmit,
  disabled,
  ttsEnabled,
  onTTSToggle,
  micListening,
  micSupported,
  onMicToggle,
}: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && input.trim()) onSubmit();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3 flex items-end gap-2">
      <MicButton
        isListening={micListening}
        supported={micSupported}
        onToggle={onMicToggle}
        disabled={disabled}
      />

      <textarea
        value={input}
        onChange={onInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Message your digital twin… (Enter to send)"
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-red focus:border-transparent disabled:opacity-50 min-h-[40px] max-h-[160px] overflow-y-auto"
        style={{ lineHeight: '1.5' }}
      />

      <TTSToggle enabled={ttsEnabled} onToggle={onTTSToggle} />

      <button
        type="button"
        onClick={() => { if (!disabled && input.trim()) onSubmit(); }}
        disabled={disabled || !input.trim()}
        className="bg-brand-black text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        Send
      </button>
    </div>
  );
}
