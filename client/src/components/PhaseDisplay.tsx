interface Props {
  phase: string;
  round: number;
  myRole: string | null;
  winner: string | null;
}

export default function PhaseDisplay({ phase, round, myRole, winner }: Props) {
  const getPhaseText = () => {
    const texts: Record<string, string> = {
      waiting: '等待中',
      night_start: '夜晚',
      guard_turn: '守卫回合',
      werewolf_turn: '狼人回合',
      witch_turn: '女巫回合',
      seer_turn: '预言家回合',
      dawn: '黎明',
      last_words: '遗言',
      discussion: '讨论',
      voting: '投票',
      vote_result: '投票结果',
      hunter_shoot: '猎人开枪',
      game_over: '游戏结束',
    };
    return texts[phase] || phase;
  };

  const getRoleText = () => {
    const names: Record<string, string> = {
   werewolf: '🐺 狼人',
      villager: '👤 平民',
   seer: '🔮 预言家',
      witch: '🧪 女巫',
      hunter: '🔫 猎人',
      guard: '🛡️ 守卫',
    };
    return myRole ? names[myRole] || '未知' : '观众';
  };

  return (
    <div className="bg-dawn/80 backdrop-blur-sm border-b border-wolf/30 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
       <div>
            <div className="text-sm text-gray-400">第 {round} 轮</div>
            <div className="text-xl font-bold phase-indicator inline-block px-4 py-1 mt-1">
          {getPhaseText()}
            </div>
     </div>
          {myRole && (
          <div className="text-sm">
              <div className="text-gray-400">你的身份</div>
           <div className="font-bold text-lg">{getRoleText()}</div>
            </div>
          )}
        </div>

        {winner && (
          <div className="text-2xl font-black">
            {winner === 'werewolf' ? '🐺 狼人胜利' : '🏘️ 好人胜利'}
          </div>
        )}
      </div>
  );
}
