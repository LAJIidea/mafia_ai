import { useState, useRef, useCallback } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  startRecording: (onChunk?: (chunk: ArrayBuffer) => void) => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  error: string;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async (onChunk?: (chunk: ArrayBuffer) => void) => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // 流式回调：实时发送每个chunk
          if (onChunk) {
            const buf = await e.data.arrayBuffer();
            onChunk(buf);
          }
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      // 每500ms一个chunk，用于流式传输
      mediaRecorder.start(500);
      setIsRecording(true);
    } catch (err) {
      setError('无法访问麦克风');
      console.error('Recording error:', err);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setIsRecording(false);
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        recorder.stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        mediaRecorderRef.current = null;
        resolve(blob.size > 0 ? blob : null);
      };

      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stream.getTracks().forEach(t => t.stop());
      recorder.stop();
    }
    chunksRef.current = [];
    setIsRecording(false);
    mediaRecorderRef.current = null;
  }, []);

  return { isRecording, startRecording, stopRecording, cancelRecording, error };
}
