import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getSocket } from '../utils/socket';
import PlayerGrid from '../components/PlayerGrid';
import ActionPanel from '../components/ActionPanel';
import ChatPanel from '../components/ChatPanel';
import PhaseDisplay from '../components/PhaseDisplay';
import Subtitle from '../components/Subtitle';

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
}

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subtitle, setSubtitle] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const socket = getSocket();

  useEffect(() => {
    // 恢复 playerId
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
    });

    socket.on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
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
  }, [socket, roomId]);

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId);

  const sendAction = useCallback((action: string, targetId?: string) => {
    socket.emit('game_action', { action, targetId });
  }, [socket]);

  const sendChat = useCallback((message: string) => {
    socket.emit('chat_message', { message, type: 'text' });
  }, [socket]);

  const showPhaseSubtitle = (phase: string, deaths?: string[], winner?: string) => {
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

  return (
    <div className="h-screen night-overlay flex flex-col overflow-hidden">
      {/* 顶部状态栏 */}
      <PhaseDisplay
        phase={gameState.phase}
        round={gameState.round}
        myRole={myPlayer?.role || null}
        winner={gameState.winner}
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
          />
        </div>

        {/* 右侧面板 */}
        <div className="w-80 hidden md:flex flex-col border-l border-wolf/20">
          <ChatPanel messages={messages} onSend={sendChat} phase={gameState.phase} />
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
      />

      {/* 字幕 */}
      {subtitle && <Subtitle text={subtitle} />}
    </div>
  );
}
