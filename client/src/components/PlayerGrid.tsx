interface Player {
  id: string;
  name: string;
  role: string | null;
  alive: boolean;
  type: 'human' | 'ai';
}

interface Props {
  players: Player[];
  myPlayerId: string;
  selectedTarget: string | null;
  onSelectTarget: (id: string | null) => void;
  phase: string;
  deaths: string[];
}

export default function PlayerGrid({ players, myPlayerId, selectedTarget, onSelectTarget, phase, deaths }: Props) {
  const getRoleEmoji = (role: string | null) => {
    const emojis: Record<string, string> = {
      werewolf: '🐺',
      villager: '👤',
      seer: '🔮',
      witch: '🧪',
      hunter: '🔫',
      guard: '🛡️',
    };
    return role ? emojis[role] || '❓' : '❓';
  };

  const getRoleName = (role: string | null) => {
    const names: Record<string, string> = {
    werewolf: '狼人',
      villager: '平民',
   seer: '预言家',
      witch: '女巫',
      hunter: '猎人',
      guard: '守卫',
    };
    return role ? names[role] || '未知' : '未知';
  };

  const canSelect = (player: Player) => {
    if (!player.alive) return false;
    if (player.id === myPlayerId) return false;

    // 根据阶段判断是否可选
    const selectablePhases = ['guard_turn', 'werewolf_turn', 'witch_turn', 'seer_turn', 'voting', 'hunter_shoot'];
    return selectablePhases.includes(phase);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {players.map(player => {
        const isMe = player.id === myPlayerId;
      const isSelected = selectedTarget === player.id;
      const isDead = !player.alive;
        const isNewDeath = deaths.includes(player.id);
     const selectable = canSelect(player);

     return (
          <div
            key={player.id}
         onClick={() => selectable && onSelectTarget(isSelected ? null : player.id)}
          className={`player-card ${isDead ? 'dead' : ''} ${isSelected ? 'selected' : ''} ${
           selectable ? 'cursor-pointer' : ''
            } ${isNewDeath ? 'animate-pulse' : ''}`}
          >
        {/* 玩家头像 */}
            <div className="text-5xl mb-2 text-center">
              {isMe && player.role ? getRoleEmoji(player.role) : player.type === 'ai' ? '🤖' : '👤'}
            </div>

            {/* 玩家名字 */}
        <div className="font-bold text-center truncate">{player.name}</div>

            {/* 角色信息（仅自己可见） */}
            {isMe && player.role && (
              <div className="text-xs text-center text-wolf mt-1">{getRoleName(player.role)}</div>
            )}

          {/* 状态标记 */}
          {isDead && (
              <div className="absolute top-2 right-2 text-2xl">💀</div>
            )}
            {isMe && (
              <div className="absolute top-2 left-2 text-xl">⭐</div>
            )}
       </div>
      );
      })}
    </div>
  );
}
