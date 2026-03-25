interface Player {
  id: string;
  name: string;
  role: string | null;
  alive: boolean;
  type: 'human' | 'ai';
  aiModel?: string;
  device?: string;
}

interface Props {
  players: Player[];
  myPlayerId: string;
  selectedTarget: string | null;
  onSelectTarget: (id: string | null) => void;
  phase: string;
  deaths: string[];
  pkCandidates?: string[];
  seerResults?: Map<string, boolean>; // 预言家查验结果: playerId → isWerewolf
}

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺',
  villager: '👤',
  seer: '🔮',
  witch: '🧪',
  hunter: '🔫',
  guard: '🛡️',
  fool: '🤡',
};

const ROLE_NAME: Record<string, string> = {
  werewolf: '狼人',
  villager: '平民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  fool: '白痴',
};

const ROLE_COLOR: Record<string, string> = {
  werewolf: 'text-blood',
  villager: 'text-gray-300',
  seer: 'text-seer',
  witch: 'text-witch',
  hunter: 'text-hunter',
  guard: 'text-guard',
  fool: 'text-yellow-400',
};

export default function PlayerGrid({ players, myPlayerId, selectedTarget, onSelectTarget, phase, deaths, pkCandidates = [], seerResults }: Props) {
  const myPlayer = players.find(p => p.id === myPlayerId);
  const isWerewolf = myPlayer?.role === 'werewolf';

  const canSelect = (player: Player) => {
    if (!player.alive) return false;
    if (player.id === myPlayerId) {
      if (phase === 'guard_turn') return true;
      return false;
    }
    // PK投票：只能选择PK候选人，且候选人自己不能投票
    if (phase === 'pk_voting') {
      if (pkCandidates.includes(myPlayerId)) return false; // I'm a candidate, can't vote
      return pkCandidates.includes(player.id); // Only candidates are selectable
    }
    const selectablePhases = ['guard_turn', 'werewolf_turn', 'witch_turn', 'seer_turn', 'voting', 'hunter_shoot'];
    return selectablePhases.includes(phase);
  };

  // 视频录制友好的布局：环形或网格
  const gridCols = players.length <= 6
    ? 'grid-cols-3'
    : players.length <= 9
      ? 'grid-cols-3 md:grid-cols-3 lg:grid-cols-3'
      : players.length <= 12
        ? 'grid-cols-3 md:grid-cols-4 lg:grid-cols-4'
        : 'grid-cols-4 md:grid-cols-4 lg:grid-cols-4';

  return (
    <div className="recording-safe-area">
      <div className={`grid ${gridCols} gap-4 justify-items-center`}>
        {players.map((player, index) => {
          const isMe = player.id === myPlayerId;
          const isSelected = selectedTarget === player.id;
          const isDead = !player.alive;
          const isNewDeath = deaths.includes(player.id);
          const selectable = canSelect(player);
          const isWolfTeammate = isWerewolf && !isMe && player.role === 'werewolf' && player.alive;
          const seerResult = !isMe ? seerResults?.get(player.id) : undefined; // undefined=未查验, true=狼人, false=好人

          return (
            <div
              key={player.id}
              onClick={() => selectable && onSelectTarget(isSelected ? null : player.id)}
              className={`player-card w-full ${isDead ? 'dead' : ''} ${isSelected ? 'selected' : ''} ${
                selectable ? 'cursor-pointer hover:scale-105' : ''
              } ${isNewDeath ? 'death-animation' : ''} ${isWolfTeammate ? 'ring-2 ring-red-500/70 bg-red-900/20' : ''}`}
            >
              {/* 座位号 */}
              <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-wolf/80 flex items-center justify-center text-xs font-bold">
                {index + 1}
              </div>

              {/* 我的标记 */}
              {isMe && (
                <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-guard flex items-center justify-center text-xs">
                  ⭐
                </div>
              )}

              {/* 狼人队友标记 */}
              {isWolfTeammate && (
                <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-xs">
                  🐺
                </div>
              )}

              {/* 玩家头像 - 大号清晰 */}
              <div className="text-5xl mb-3 text-center">
                {isDead && phase !== 'game_over' ? '💀'
                  : (isMe || phase === 'game_over') && player.role ? ROLE_EMOJI[player.role] || '❓'
                  : player.type === 'ai' ? '🤖' : '👤'}
              </div>

              {/* 玩家名字 - 清晰可读 */}
              <div className="font-bold text-center text-base truncate">{player.name}</div>

              {/* 角色信息 - 自己始终可见，游戏结束时所有人可见 */}
              {(isMe || phase === 'game_over') && player.role && (
                <div className={`text-sm text-center mt-1 font-bold ${phase === 'game_over' && !isMe ? 'role-reveal' : ''} ${ROLE_COLOR[player.role] || 'text-gray-400'}`}>
                  {ROLE_NAME[player.role] || '未知'}
                </div>
              )}

              {/* 预言家查验结果 */}
              {seerResult !== undefined && (
                <div className={`text-sm text-center mt-1 font-bold ${seerResult ? 'text-red-400' : 'text-green-400'}`}>
                  {seerResult ? '🐺 狼人' : '✅ 好人'}
                </div>
              )}

              {/* AI模型标记 */}
              {player.type === 'ai' && player.aiModel && (
                <div className="text-xs text-center text-gray-500 mt-1 truncate">
                  {player.aiModel.split('/').pop()}
                </div>
              )}

              {/* 状态标记 */}
              {isDead && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-6xl opacity-30">✕</div>
                </div>
              )}

              {/* 类型标识 */}
              <div className="absolute bottom-1 right-1 text-xs opacity-50">
                {player.type === 'ai' ? '🤖' : player.device === 'mobile' ? '📱' : '💻'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
