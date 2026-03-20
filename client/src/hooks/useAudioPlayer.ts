import { useCallback, useRef } from 'react';

interface UseAudioPlayerReturn {
  playAudio: (audioData: ArrayBuffer | string) => Promise<void>;
  stopAudio: () => void;
  isPlaying: boolean;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

  const playAudio = useCallback(async (audioData: ArrayBuffer | string) => {
    stopAudioInternal();

    try {
      let url: string;

      if (typeof audioData === 'string') {
        // Base64 或 URL
        if (audioData.startsWith('data:') || audioData.startsWith('http')) {
          url = audioData;
        } else {
          url = `data:audio/mp3;base64,${audioData}`;
        }
      } else {
        // ArrayBuffer
        const blob = new Blob([audioData], { type: 'audio/mp3' });
        url = URL.createObjectURL(blob);
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      isPlayingRef.current = true;

      audio.onended = () => {
        isPlayingRef.current = false;
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        isPlayingRef.current = false;
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch (err) {
      console.error('音频播放失败:', err);
      isPlayingRef.current = false;
    }
  }, []);

  const stopAudioInternal = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    isPlayingRef.current = false;
  };

  const stopAudio = useCallback(() => {
    stopAudioInternal();
  }, []);

  return {
    playAudio,
    stopAudio,
    isPlaying: isPlayingRef.current,
  };
}
