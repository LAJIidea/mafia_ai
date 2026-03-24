import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSocket } from '../utils/socket';
import { getQRCode, getAIModels } from '../utils/api';

interface Player {
  id: string;
  name: string;
  type: 'human' | 'ai';
  device: 'desktop' | 'mobile';
  aiModel?: string;
  connected: boolean;
}

interface GameState {
  players: Player[];
  config: { totalPlayers: number; roleConfig: Record<string, number> };
  phase: string;
}

export default function Lobby() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [joined, setJoined] = useState(false);
  const [qrData, setQrData] = useState<{ url: string; qrCode: string } | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [error, setError] = useState('');

  const socket = getSocket();

  useEffect(() => {
    socket.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    socket.on('joined', (data: { playerId: string }) => {
      setJoined(true);
      setError('');
      if (data?.playerId && roomId) {
        sessionStorage.setItem(`playerId_${roomId}`, data.playerId);
      }
    });

    socket.on('error', (data: { message: string }) => {
      setError(data.message);
    });

    socket.on('phase_change', (data: { phase: string }) => {
      if (data.phase !== 'waiting') {
        navigate(`/game/${roomId}`);
      }
    });

    getQRCode().then(setQrData).catch(() => {});
    getAIModels().then(setModels).catch(() => {});

    return () => {
      socket.off('game_state');
      socket.off('joined');
      socket.off('error');
      socket.off('phase_change');
    };
  }, [socket, roomId, navigate]);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handleJoin = () => {
    if (!playerName.trim() || !roomId) return;
    socket.emit('join_room', {
      roomId,
      playerName: playerName.trim(),
      device: isMobile ? 'mobile' : 'desktop',
    });
  };

  const handleAddAI = (modelId: string, _modelName: string) => {
    if (!roomId) return;
    socket.emit('add_ai', {
      roomId,
      playerName: `玩家${(gameState?.players?.length || 0) + 1}`,
      aiModel: modelId,
    });
  };

  const handleStart = () => {
    socket.emit('start_game');
  };

  const totalPlayers = gameState?.config.totalPlayers || 0;
  const currentPlayers = gameState?.players.length || 0;
  const canStart = currentPlayers === totalPlayers;

  return (
    <div className="min-h-screen night-overlay p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              房间 <span className="text-wolf">{roomId}</span>
            </h1>
            <p className="text-gray-400">
              {currentPlayers}/{totalPlayers} 名玩家
            </p>
          </div>
          {qrData && (
            <div className="text-center">
              <img src={qrData.qrCode} alt="二维码" className="w-24 h-24 rounded-lg" />
              <p className="text-xs text-gray-500 mt-1">扫码加入</p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-blood/20 border border-blood/50 rounded-lg px-4 py-3 text-blood">
            {error}
          </div>
        )}

        {/* 加入 */}
        {!joined && (
          <div className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
            <h2 className="text-lg font-bold mb-4">加入游戏</h2>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="输入你的名字"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                className="flex-1 bg-night/80 border border-wolf/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-wolf"
              />
              <button
                onClick={handleJoin}
                disabled={!playerName.trim()}
                className="bg-wolf px-6 py-3 rounded-lg font-bold hover:opacity-90 disabled:opacity-50"
              >
                加入
              </button>
            </div>
          </div>
        )}

        {/* 玩家列表 */}
        <div className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
          <h2 className="text-lg font-bold mb-4">玩家列表</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {gameState?.players.map(player => (
              <div key={player.id} className="player-card text-center">
                <div className="text-3xl mb-2">
                  {player.type === 'ai' ? '🤖' : player.device === 'mobile' ? '📱' : '💻'}
                </div>
                <div className="font-bold text-sm truncate">{player.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {player.type === 'ai' ? player.aiModel?.split('/')[1] || 'AI' : '真人'}
                </div>
              </div>
            ))}

            {/* 空位 */}
            {Array.from({ length: totalPlayers - currentPlayers }).map((_, i) => (
              <div key={`empty-${i}`} className="player-card text-center opacity-30">
                <div className="text-3xl mb-2">❓</div>
                <div className="text-sm text-gray-500">等待加入</div>
              </div>
            ))}
          </div>
        </div>

        {/* 添加AI玩家 */}
        {joined && currentPlayers < totalPlayers && (
          <div className="bg-dawn/50 rounded-2xl p-6 border border-seer/20">
            <h2 className="text-lg font-bold mb-4 text-seer">添加AI玩家</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {models.map(model => (
                <button
                  key={model.id}
                  onClick={() => handleAddAI(model.id, model.name)}
                  className="bg-night/60 border border-seer/30 rounded-lg p-3 text-left hover:border-seer/60 transition-all"
                >
                  <div className="font-bold text-sm">{model.name}</div>
                  <div className="text-xs text-gray-500">{model.provider}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 角色配置 */}
        {gameState && (
          <div className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
            <h2 className="text-lg font-bold mb-4">角色配置</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              {Object.entries(gameState.config.roleConfig).map(([role, count]) => (
                count > 0 && (
                  <div key={role} className="flex items-center gap-2">
                    <span className="text-gray-400">{getRoleName(role)}</span>
                    <span className="text-wolf font-bold">{count as number}</span>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* 开始游戏 */}
        {joined && (
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="w-full bg-gradient-to-r from-blood to-wolf py-4 rounded-xl font-bold text-xl transition-all hover:opacity-90 disabled:opacity-30"
          >
            {canStart ? '开始游戏' : `等待玩家加入 (${currentPlayers}/${totalPlayers})`}
          </button>
        )}
      </div>
    </div>
  );
}

function getRoleName(role: string): string {
  const names: Record<string, string> = {
    werewolf: '🐺 狼人',
    villager: '👤 平民',
    seer: '🔮 预言家',
    witch: '🧪 女巫',
    hunter: '🔫 猎人',
    guard: '🛡️ 守卫',
    fool: '🤡 白痴',
  };
  return names[role] || role;
}
