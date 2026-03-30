import { useState, useCallback } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { getSocket } from '../utils/socket';

interface Props {
  onSendVoice: (text: string) => void;
  canSpeak: boolean;
}

export default function VoiceInput({ onSendVoice, canSpeak }: Props) {
  const {
    isListening,
    transcript,
    interimText,
    error: speechError,
    startListening,
    stopListening,
    resetTranscript,
    isSupported: speechSupported,
  } = useSpeechRecognition();

  const {
    isRecording,
    startRecording,
    stopRecording,
    cancelRecording,
    error: recordError,
  } = useAudioRecorder();

  const [sent, setSent] = useState(false);
  const socket = getSocket();

  const handleToggle = useCallback(async () => {
    if (isRecording) {
      // 停止录音
      if (speechSupported) stopListening();

      // 通知服务器语音流结束
      socket.emit('voice_stream_end');

      const audioBlob = await stopRecording();
      if (audioBlob && audioBlob.size > 1000) {
        // 发送完整音频用于服务端STT转文字（给AI用）
        const arrayBuffer = await audioBlob.arrayBuffer();
        socket.emit('voice_audio', { audio: arrayBuffer });
      }

      // 发送Web Speech API的即时文字到聊天面板
      if (transcript.trim()) {
        onSendVoice(transcript.trim());
      }

      setSent(true);
      setTimeout(() => {
        resetTranscript();
        setSent(false);
      }, 1500);
    } else {
      // 开始录音
      resetTranscript();
      setSent(false);

      // 通知服务器开始语音流
      socket.emit('voice_stream_start');

      // 启动录音，流式发送每个chunk给服务器实时广播
      await startRecording((chunk: ArrayBuffer) => {
        socket.emit('voice_chunk', { audio: chunk });
      });

      // 同时启动Web Speech API做实时文字识别
      if (speechSupported) startListening();
    }
  }, [isRecording, transcript, stopListening, startListening, resetTranscript,
      onSendVoice, startRecording, stopRecording, speechSupported, socket]);

  const handleCancel = useCallback(() => {
    socket.emit('voice_stream_end');
    cancelRecording();
    if (speechSupported) stopListening();
    resetTranscript();
  }, [cancelRecording, stopListening, resetTranscript, speechSupported, socket]);

  const error = recordError || speechError;
  const displayText = transcript + (interimText ? interimText : '');

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={handleToggle}
          disabled={!canSpeak}
          className={`flex-1 py-3 rounded-lg font-bold transition-all ${
            isRecording
              ? 'bg-blood animate-pulse text-white'
              : canSpeak
                ? 'bg-wolf/80 hover:bg-wolf text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isRecording ? '🎤 录音中... 点击结束并发送' : '🎤 语音发言'}
        </button>

        {isRecording && (
          <button
            onClick={handleCancel}
            className="px-4 py-3 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            取消
          </button>
        )}
      </div>

      {isListening && displayText && (
        <div className="bg-night/60 rounded-lg px-3 py-2 text-sm text-gray-300">
          <span className="text-xs text-wolf">实时识别: </span>
          {transcript}
          {interimText && <span className="text-gray-500">{interimText}</span>}
        </div>
      )}

      {sent && (
        <div className="text-xs text-village text-center">✓ 语音已发送</div>
      )}

      {error && (
        <div className="text-xs text-blood text-center">{error}</div>
      )}
    </div>
  );
}
