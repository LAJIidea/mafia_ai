import { useState, useCallback, useRef } from 'react';

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;        // 最终确认的文字（只增不减）
  interimText: string;       // 当前正在识别的中间文字（会被替换）
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  isSupported: boolean;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognitionCtor;

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setError('浏览器不支持语音识别');
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event) => {
        let finalPart = '';
        let interimPart = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalPart += result[0].transcript;
          } else {
            interimPart += result[0].transcript;
          }
        }

        // 只有最终确认的文字才累加到transcript
        if (finalPart) {
          setTranscript(prev => prev + finalPart);
        }
        // 中间结果只临时显示，每次替换（不累加）
        setInterimText(interimPart);
      };

      recognition.onerror = (event) => {
        setError(`语音识别错误: ${event.error}`);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setError('语音识别启动失败');
    }
  }, [SpeechRecognitionCtor]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimText('');
  }, []);

  return {
    isListening,
    transcript,
    interimText,
    error,
    startListening,
    stopListening,
    resetTranscript,
    isSupported,
  };
}
