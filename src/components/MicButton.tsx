'use client';

interface Props {
  isListening: boolean;
  supported: boolean;
  onToggle: () => void;
  disabled: boolean;
}

export default function MicButton({ isListening, supported, onToggle, disabled }: Props) {
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={isListening ? 'Stop listening' : 'Start voice input'}
      className={`p-2 rounded-full transition-colors disabled:opacity-40 ${
        isListening
          ? 'text-brand-red animate-pulse'
          : 'text-gray-500 hover:text-brand-black'
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-5 h-5"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
      </svg>
    </button>
  );
}
