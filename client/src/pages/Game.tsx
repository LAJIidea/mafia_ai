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
import VoteResultModal from '../components/VoteResultModal';

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

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺', villager: '👤', seer: '🔮', witch: '🧪',
  hunter: '🔫', guard: '🛡️', fool: '🤡',
};
const ROLE_NAME: Record<string, string> = {
  werewolf: '狼人', villager: '平民', seer: '预言家', witch: '女巫',
  hunter: '猎人', guard: '守卫', fool: '白痴',
};

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
  const [hasActed, setHasActed] = useState(false); // 当前阶段是否已操作
  const [seerResults, setSeerResults] = useState<Map<string, boolean>>(new Map()); // 预言家查验结果: playerId → isWerewolf
  const [voteResult, setVoteResult] = useState<{
    votes: Array<{ voterId: string; targetId: string | null }>;
    result?: string;
    exiledId?: string;
  } | null>(null);
  const lastPhaseRef = useRef<string>('');

  const socket = getSocket();
  const { playAudio } = useAudioPlayer();

  // 播放主持人语音（仍可客户端调API作为备用，但优先使用audio_broadcast）
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

  useEffect(() => {
    const stored = sessionStorage.getItem(`playerId_${roomId}`);
    if (stored) setMyPlayerId(stored);

    socket.on('game_state', (state: GameState) => {
      setGameState(state);
      // 首次收到游戏中状态时，通知服务器客户端已加载完成
      if (state.phase && state.phase !== 'waiting') {
        socket.emit('game_ready');
      }
    });

    socket.on('joined', (data: { playerId: string }) => {
      setMyPlayerId(data.playerId);
      sessionStorage.setItem(`playerId_${roomId}`, data.playerId);
    });

    socket.on('phase_change', (data: { phase: string; round: number; deaths?: string[]; winner?: string; voteResult?: any }) => {
      const phaseChanged = data.phase !== lastPhaseRef.current;

      if (phaseChanged) {
        lastPhaseRef.current = data.phase;
        setSelectedTarget(null);
        setHasActed(false);
        showPhaseSubtitle(data.phase, data.deaths, data.winner);

        // 播放主持人语音
        const narratorKey = data.phase === 'game_over'
          ? (data.winner === 'werewolf' ? 'game_over_werewolf' : 'game_over_villager')
          : PHASE_NARRATOR_KEY[data.phase];
        if (narratorKey) {
          playNarratorVoice(narratorKey);
        }
      }

      // 显示投票结果弹窗（仅当服务端发来新的投票结果时）
      if (data.voteResult?.votes) {
        const votes = data.voteResult.votes as Array<{ voterId: string; targetId: string | null }>;
        if (votes.length > 0) {
          setVoteResult({
            votes,
            result: data.voteResult.result as string | undefined,
            exiledId: data.voteResult.exiledId as string | undefined,
          });
        }
      }
    });

    socket.on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      // AI发言语音现在由服务端通过audio_broadcast推送，无需客户端调TTS API
    });

    // 接收服务端推送的音频（AI发言语音）
    socket.on('audio_broadcast', (data: { playerId: string; playerName: string; audio: ArrayBuffer; type: string }) => {
      if (!voiceEnabled) return;
      if (data.audio) {
        playAudio(data.audio, 'audio/mp3').catch(() => {});
      }
    });

    // 接收真人完整语音录音并播放
    socket.on('human_voice_broadcast', (data: { playerId: string; playerName: string; audio: ArrayBuffer }) => {
      if (!voiceEnabled) return;
      if (data.audio) {
        playAudio(data.audio, 'audio/webm').catch(() => {});
      }
    });

    socket.on('action_result', (result: { success: boolean; message?: string; data?: Record<string, unknown> }) => {
      if (result.message) {
        setSubtitle(result.message);
        setTimeout(() => setSubtitle(''), 3000);
      }
      // 保存预言家查验结果
      if (result.success && result.data?.targetId && typeof result.data?.isWerewolf === 'boolean') {
        setSeerResults(prev => {
          const next = new Map(prev);
          next.set(result.data!.targetId as string, result.data!.isWerewolf as boolean);
          return next;
        });
      }
    });

    return () => {
      socket.off('game_state');
      socket.off('joined');
      socket.off('phase_change');
      socket.off('chat_message');
      socket.off('action_result');
      socket.off('audio_broadcast');
      socket.off('human_voice_broadcast');
    };
  }, [socket, roomId, playNarratorVoice, voiceEnabled, playAudio]);

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);

  const sendAction = useCallback((action: string, targetId?: string) => {
    if (hasActed) return;
    setHasActed(true);
    socket.emit('game_action', { action, targetId });
  }, [socket, hasActed]);

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

  const handleEndSpeech = useCallback(() => {
    socket.emit('advance_speaker');
  }, [socket]);

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

  // 当前是否是我的发言轮次
  const isMyTurn = gameState.currentSpeaker === myPlayerId;
  const isSpeakPhase = ['discussion', 'last_words', 'pk_speech'].includes(gameState.phase);

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

      {/* 身份提示条 */}
      {myPlayer?.role && !gameState.winner && (
        <div className="bg-gradient-to-r from-wolf/30 to-purple-900/30 border-b border-wolf/20 px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{ROLE_EMOJI[myPlayer.role] || '❓'}</span>
              <div>
                <div className="text-xs text-gray-400">你的身份</div>
                <div className="text-lg font-bold text-wolf">{ROLE_NAME[myPlayer.role] || '未知'}</div>
              </div>
            </div>
            {/* 当前发言者提示 + 结束发言按钮 */}
            {isSpeakPhase && (
              <div className="flex items-center gap-3">
                {isMyTurn ? (
                  <>
                    <span className="text-sm text-village animate-pulse">轮到你发言</span>
                    <button
                      onClick={handleEndSpeech}
                      className="bg-wolf px-4 py-2 rounded-lg text-sm font-bold hover:bg-wolf/80 transition-all"
                    >
                      结束发言 →
                    </button>
                  </>
                ) : gameState.currentSpeaker ? (
                  <span className="text-sm text-gray-400">
                    {gameState.players.find(p => p.id === gameState.currentSpeaker)?.name || ''}正在发言...
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

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
            seerResults={seerResults}
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
        hasActed={hasActed}
      />

      {/* 投票结果弹窗 */}
      {voteResult && gameState && (
        <VoteResultModal
          votes={voteResult.votes}
          players={gameState.players}
          result={voteResult.result}
          exiledName={voteResult.exiledId ? gameState.players.find(p => p.id === voteResult.exiledId)?.name : undefined}
          onClose={() => setVoteResult(null)}
        />
      )}

      {/* 字幕 */}
      {subtitle && <Subtitle text={subtitle} />}
    </div>
  );
}
