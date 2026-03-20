import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket } from '../utils/socket';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import PlayerGrid from '../components/PlayerGrid';
import ActionPanel from '../components/ActionPanel';
import ChatPanel from '../components/ChatPanel';
import PhaseDisplay from '../components/PhaseDisplay';
import Subtitle from '../components/Subtitle';
import VoiceInput from '../components/VoiceInput';

interface Player {
  id: string;
  name: string;
  type: 'human' | 'ai';
  role: string | null;
  alive: boolean;
  device: string;
  aiModel?: string;
}

interface ChatMessage {
  playerId: string;
  playerName: string;
  message: string;
  type: 'voice' | 'text';
  timestamp: number;
  aiModel?: string;
}

interface GameState {
  phase: string;
  round: number;
  players: Player[];
  config: { totalPlayers: number; roleConfig: Record<string, number> };
  deaths: string[];
  winner: string | null;
  nightActions: Record<string, unknown>;
  witchPotions: { antidote: boolean; poison: boolean };
  lastGuardTarget: string | null;
  currentSpeaker: string | null;
  phaseDeadline: number | null;
  pkCandidates: string[];
}

// 阶段对应的TTS主持人语音key
const PHASE_NARRATOR_KEY: Record<string, string> = {
  night_start: 'night_start',
  guard_turn: 'guard_turn',
  werewolf_turn: 'werewolf_turn',
  witch_turn: 'witch_turn',
  seer_turn: 'seer_turn',
  dawn: 'dawn',
  last_words: 'last_words',
  discussion: 'discussion',
  voting: 'voting',
  hunter_shoot: 'hunter_shoot',
};

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subtitle, setSubtitle] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastPhaseRef = useRef<string>('');

  const socket = getSocket();
  const { playAudio } = useAudioPlayer();

  // 播放主持人语音
  const playNarratorVoice = useCallback(async (lineKey: string) => {
    if (!voiceEnabled) return;
    try {
      const response = await fetch(`/api/tts/narrator/${lineKey}`);
      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        await playAudio(audioBuffer);
      }
    } catch {
      // 语音播放失败时静默处理，字幕仍会显示
    }
  }, [voiceEnabled, playAudio]);

  // 播放AI发言语音
  const playAISpeech = useCallback(async (text: string, aiModel: string) => {
    if (!voiceEnabled) return;
    try {
      const response = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, aiModel }),
      });
      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        await playAudio(audioBuffer);
      }
    } catch {
      // 静默处理
    }
  }, [voiceEnabled, playAudio]);

  useEffect(() => {
    const stored = sessionStorage.getItem(`playerId_${roomId}`);
    if (stored) setMyPlayerId(stored);

    socket.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    socket.on('joined', (data: { playerId: string }) => {
      setMyPlayerId(data.playerId);
      sessionStorage.setItem(`playerId_${roomId}`, data.playerId);
    });

    socket.on('phase_change', (data: { phase: string; round: number; deaths?: string[]; winner?: string }) => {
      setSelectedTarget(null);
      showPhaseSubtitle(data.phase, data.deaths, data.winner);

      // 播放主持人语音
      if (data.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = data.phase;
        const narratorKey = data.phase === 'game_over'
          ? (data.winner === 'werewolf' ? 'game_over_werewolf' : 'game_over_villager')
          : PHASE_NARRATOR_KEY[data.phase];
        if (narratorKey) {
          playNarratorVoice(narratorKey);
        }
      }
    });

    socket.on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      // AI发言播放TTS - 直接使用消息中的aiModel字段，避免闭包陈旧
      if (msg.aiModel) {
        playAISpeech(msg.message, msg.aiModel);
      }
    });

    socket.on('action_result', (result: { success: boolean; message?: string; data?: Record<string, unknown> }) => {
      if (result.message) {
        setSubtitle(result.message);
        setTimeout(() => setSubtitle(''), 3000);
      }
    });

    return () => {
      socket.off('game_state');
      socket.off('joined');
      socket.off('phase_change');
      socket.off('chat_message');
      socket.off('action_result');
    };
  }, [socket, roomId, playNarratorVoice, playAISpeech]);

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);

  const sendAction = useCallback((action: string, targetId?: string) => {
    socket.emit('game_action', { action, targetId });
  }, [socket]);

  const sendChat = useCallback((message: string) => {
    socket.emit('chat_message', { message, type: 'text' });
  }, [socket]);

  const sendVoiceChat = useCallback((text: string) => {
    socket.emit('chat_message', { message: text, type: 'voice' });
  }, [socket]);

  const showPhaseSubtitle = (phase: string, _deaths?: string[], winner?: string) => {
    const phaseTexts: Record<string, string> = {
      night_start: '🌙 天黑请闭眼',
      guard_turn: '🛡️ 守卫请睁眼',
      werewolf_turn: '🐺 狼人请睁眼，请选择你们要杀害的目标',
      witch_turn: '🧪 女巫请睁眼',
      seer_turn: '🔮 预言家请睁眼',
      dawn: '☀️ 天亮了',
      last_words: '💀 请留下遗言',
      discussion: '💬 请开始自由讨论',
      voting: '🗳️ 请投票',
      vote_result: '📊 投票结果',
      hunter_shoot: '🔫 猎人请选择开枪目标',
      game_over: winner === 'werewolf' ? '🐺 狼人阵营获胜！' : '🏘️ 好人阵营获胜！',
    };

    setSubtitle(phaseTexts[phase] || '');
    if (phase !== 'game_over') {
      setTimeout(() => setSubtitle(''), 4000);
    }
  };

  if (!gameState) {
    return (
      <div className="min-h-screen night-overlay flex items-center justify-center">
        <div className="text-xl text-gray-400">加载中...</div>
      </div>
    );
  }

  const canSpeak = (() => {
    if (!myPlayer) return false;
    const phase = gameState.phase;
    // 遗言阶段：只有死者可发言，且必须是当前发言者
    if (phase === 'last_words') {
      if (myPlayer.alive || !gameState.deaths.includes(myPlayerId)) return false;
      return !gameState.currentSpeaker || gameState.currentSpeaker === myPlayerId;
    }
    // PK发言：只有PK候选人可发言，且必须是当前发言者
    if (phase === 'pk_speech') {
      if (!myPlayer.alive) return false;
      if (!(gameState.pkCandidates || []).includes(myPlayerId)) return false;
      return !gameState.currentSpeaker || gameState.currentSpeaker === myPlayerId;
    }
    // 讨论：活人可发言，按发言顺序
    if (phase === 'discussion') {
      if (!myPlayer.alive) return false;
      return !gameState.currentSpeaker || gameState.currentSpeaker === myPlayerId;
    }
    return false;
  })();

  return (
    <div className="h-screen night-overlay flex flex-col overflow-hidden">
      {/* 顶部状态栏 */}
      <PhaseDisplay
        phase={gameState.phase}
        round={gameState.round}
        myRole={myPlayer?.role || null}
        winner={gameState.winner}
        phaseDeadline={gameState.phaseDeadline}
        currentSpeaker={gameState.currentSpeaker}
      />

      {/* 主区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 玩家区域 */}
        <div className="flex-1 p-4 overflow-y-auto">
          <PlayerGrid
            players={gameState.players}
            myPlayerId={myPlayerId}
            selectedTarget={selectedTarget}
            onSelectTarget={setSelectedTarget}
            phase={gameState.phase}
            deaths={gameState.deaths}
            pkCandidates={gameState.pkCandidates || []}
          />
        </div>

        {/* 右侧面板 */}
        <div className="w-80 hidden md:flex flex-col border-l border-wolf/20">
          <ChatPanel messages={messages} onSend={sendChat} canSpeak={canSpeak} />
        </div>
      </div>

      {/* 语音输入 */}
      <div className="px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <div className="flex-1">
            <VoiceInput onSendVoice={sendVoiceChat} canSpeak={canSpeak} />
          </div>
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              voiceEnabled ? 'bg-wolf/60 text-white' : 'bg-gray-700 text-gray-400'
            }`}
          >
            {voiceEnabled ? '🔊 语音开' : '🔇 语音关'}
          </button>
        </div>
      </div>

      {/* 操作面板 */}
      <ActionPanel
        phase={gameState.phase}
        myPlayer={myPlayer || null}
        selectedTarget={selectedTarget}
        onAction={sendAction}
        witchPotions={gameState.witchPotions}
        gameState={gameState}
        pkCandidates={gameState.pkCandidates || []}
        myPlayerId={myPlayerId}
      />

      {/* 字幕 */}
      {subtitle && <Subtitle text={subtitle} />}
    </div>
  );
}
