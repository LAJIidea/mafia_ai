import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../utils/api';

const PLAYER_COUNTS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

export default function Home() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [playerCount, setPlayerCount] = useState(12);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!roomName.trim()) return;
    setCreating(true);
    try {
      const result = await createRoom(roomName, playerCount);
      if (result.roomId) {
        navigate(`/lobby/${result.roomId}`);
      }
    } catch (err) {
      console.error('创建房间失败:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = () => {
    if (!joinRoomId.trim()) return;
    navigate(`/lobby/${joinRoomId.toUpperCase()}`);
  };

  return (
    <div className="min-h-screen night-overlay flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-8">
        {/* 标题 */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-black tracking-wider">
            <span className="text-wolf">狼人</span>
            <span className="text-blood">杀</span>
          </h1>
          <p className="text-gray-400 text-lg">真人 × AI 对战</p>
        </div>

        {/* 创建房间 */}
        <div className="bg-dawn/50 rounded-2xl p-6 space-y-4 backdrop-blur-sm border border-wolf/20">
          <h2 className="text-xl font-bold text-wolf">创建房间</h2>

          <input
            type="text"
            placeholder="输入房间名称"
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            className="w-full bg-night/80 border border-wolf/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-wolf"
          />

          <div>
            <label className="text-sm text-gray-400 mb-2 block">玩家人数</label>
            <div className="flex flex-wrap gap-2">
              {PLAYER_COUNTS.map(n => (
                <button
                  key={n}
                  onClick={() => setPlayerCount(n)}
                  className={`w-10 h-10 rounded-lg font-bold transition-all ${
                    playerCount === n
                      ? 'bg-wolf text-white'
                      : 'bg-night/60 text-gray-400 hover:text-white hover:bg-night'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!roomName.trim() || creating}
            className="w-full bg-gradient-to-r from-wolf to-blood py-3 rounded-lg font-bold text-lg transition-all hover:opacity-90 disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建房间'}
          </button>
        </div>

        {/* 加入房间 */}
        <div className="bg-dawn/50 rounded-2xl p-6 space-y-4 backdrop-blur-sm border border-seer/20">
          <h2 className="text-xl font-bold text-seer">加入房间</h2>

          <div className="flex gap-3">
            <input
              type="text"
              placeholder="输入房间号"
              value={joinRoomId}
              onChange={e => setJoinRoomId(e.target.value)}
              className="flex-1 bg-night/80 border border-seer/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-seer uppercase"
            />
            <button
              onClick={handleJoin}
              disabled={!joinRoomId.trim()}
              className="bg-seer px-6 py-3 rounded-lg font-bold transition-all hover:opacity-90 disabled:opacity-50"
            >
              加入
            </button>
          </div>
        </div>

        {/* 底部链接 */}
        <div className="flex justify-center gap-6 text-sm text-gray-500">
          <button onClick={() => navigate('/rules')} className="hover:text-wolf transition-colors">
            游戏规则
          </button>
          <button onClick={() => navigate('/settings')} className="hover:text-wolf transition-colors">
            AI设置
          </button>
        </div>
      </div>
    </div>
  );
}
