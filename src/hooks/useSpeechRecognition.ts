'use client';
import { useRef, useState, useCallback, useEffect } from 'react';

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => RecognitionInstance;
  webkitSpeechRecognition?: new () => RecognitionInstance;
};

export function useSpeechRecognition(onResult: (transcript: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    const w = window as WindowWithSpeech;
    setSupported(typeof window !== 'undefined' && !!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  const startListening = useCallback(() => {
    if (!supported) return;
    const w = window as WindowWithSpeech;
    const API = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!API) return;

    const rec = new API();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = Array.from({ length: (event.results as ArrayLike<unknown>).length })
        .map((_, i) => (event.results as ArrayLike<ArrayLike<{ transcript: string }>>)[i][0].transcript)
        .join('');
      onResultRef.current(transcript);
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);

    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [supported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening, supported };
}
