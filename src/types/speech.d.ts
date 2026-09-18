// Polyfill webkit prefix and ensure SpeechRecognition is available globally
interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}
