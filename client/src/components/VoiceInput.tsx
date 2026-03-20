import { useState, useCallback } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface Props {
  onSendVoice: (text: string) => void;
  canSpeak: boolean;
}

export default function VoiceInput({ onSendVoice, canSpeak }: Props) {
  const {
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
    resetTranscript,
    isSupported,
  } = useSpeechRecognition();

  const [sent, setSent] = useState(false);

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      if (transcript.trim()) {
        onSendVoice(transcript.trim());
        setSent(true);
        setTimeout(() => {
          resetTranscript();
          setSent(false);
        }, 1000);
      }
    } else {
      resetTranscript();
      setSent(false);
      startListening();
    }
  }, [isListening, transcript, stopListening, startListening, resetTranscript, onSendVoice]);

  if (!isSupported) {
    return (
      <div className="text-xs text-gray-500 text-center py-2">
        浏览器不支持语音识别
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleToggle}
        disabled={!canSpeak}
        className={`w-full py-3 rounded-lg font-bold transition-all ${
          isListening
            ? 'bg-blood animate-pulse text-white'
            : canSpeak
              ? 'bg-wolf/80 hover:bg-wolf text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`}
      >
        {isListening ? '🎤 录音中... 点击结束并发送' : '🎤 按住发言'}
      </button>

      {transcript && (
        <div className="bg-night/60 rounded-lg px-3 py-2 text-sm text-gray-300">
          <span className="text-xs text-wolf">识别中: </span>
          {transcript}
        </div>
      )}

      {sent && (
        <div className="text-xs text-village text-center">✓ 语音发送成功</div>
      )}

      {error && (
        <div className="text-xs text-blood text-center">{error}</div>
      )}
    </div>
  );
}
