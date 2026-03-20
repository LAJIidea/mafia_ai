import { useState, useEffect } from 'react';

interface Props {
  phase: string;
  round: number;
  myRole: string | null;
  winner: string | null;
  phaseDeadline: number | null;
  currentSpeaker: string | null;
}

const PHASE_TEXT: Record<string, string> = {
  waiting: '等待中',
  night_start: '🌙 夜晚',
  guard_turn: '🛡️ 守卫回合',
  werewolf_turn: '🐺 狼人回合',
  witch_turn: '🧪 女巫回合',
  seer_turn: '🔮 预言家回合',
  dawn: '☀️ 天亮了',
  last_words: '💀 遗言',
  discussion: '💬 自由讨论',
  voting: '🗳️ 投票',
  vote_result: '📊 投票结果',
  pk_speech: '⚔️ PK发言',
  pk_voting: '⚔️ PK投票',
  hunter_shoot: '🔫 猎人开枪',
  game_over: '🏁 游戏结束',
};

const ROLE_DISPLAY: Record<string, string> = {
  werewolf: '🐺 狼人',
  villager: '👤 平民',
  seer: '🔮 预言家',
  witch: '🧪 女巫',
  hunter: '🔫 猎人',
  guard: '🛡️ 守卫',
  fool: '🤡 白痴',
};

const PHASE_BG: Record<string, string> = {
  night_start: 'from-indigo-900/80 to-purple-900/80',
  guard_turn: 'from-indigo-900/80 to-purple-900/80',
  werewolf_turn: 'from-red-900/80 to-purple-900/80',
  witch_turn: 'from-teal-900/80 to-purple-900/80',
  seer_turn: 'from-blue-900/80 to-purple-900/80',
  dawn: 'from-orange-900/80 to-yellow-900/80',
  discussion: 'from-green-900/80 to-teal-900/80',
  voting: 'from-red-900/80 to-orange-900/80',
  pk_speech: 'from-red-900/80 to-purple-900/80',
  pk_voting: 'from-red-900/80 to-purple-900/80',
  game_over: 'from-purple-900/80 to-pink-900/80',
};

export default function PhaseDisplay({ phase, round, myRole, winner, phaseDeadline }: Props) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const bgGradient = PHASE_BG[phase] || 'from-dawn/80 to-night/80';

  useEffect(() => {
    if (!phaseDeadline) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((phaseDeadline - Date.now()) / 1000));
      setCountdown(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [phaseDeadline]);

  return (
    <div className={`bg-gradient-to-r ${bgGradient} backdrop-blur-sm border-b border-wolf/30 px-6 py-4`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between recording-safe-area">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs text-gray-400 uppercase tracking-widest">Round</div>
            <div className="text-3xl font-black text-wolf">{round}</div>
          </div>

          <div className="phase-indicator">
            {PHASE_TEXT[phase] || phase}
          </div>

          {countdown !== null && countdown > 0 && (
            <div className={`text-2xl font-black tabular-nums ${countdown <= 5 ? 'text-blood animate-pulse' : 'text-gray-300'}`}>
              {countdown}s
            </div>
          )}
        </div>

        {winner && (
          <div className="text-center">
            <div className={`text-3xl font-black ${winner === 'werewolf' ? 'text-blood blood-glow' : 'text-village'}`}>
              {winner === 'werewolf' ? '🐺 狼人胜利' : '🏘️ 好人胜利'}
            </div>
          </div>
        )}

        {myRole && !winner && (
          <div className="text-right">
            <div className="text-xs text-gray-400">你的身份</div>
            <div className="text-xl font-bold mt-1">{ROLE_DISPLAY[myRole] || '未知'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
