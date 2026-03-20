interface Player {
  id: string;
  role: string | null;
  alive: boolean;
}

interface Props {
  phase: string;
  myPlayer: Player | null;
  selectedTarget: string | null;
  onAction: (action: string, targetId?: string) => void;
  witchPotions: { antidote: boolean; poison: boolean };
  gameState: any;
}

export default function ActionPanel({ phase, myPlayer, selectedTarget, onAction, witchPotions, gameState }: Props) {
  if (!myPlayer || !myPlayer.alive) {
    return null;
  }

  const renderGuardActions = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">选择一名玩家进行守护（可守护自己）</p>
      <div className="flex gap-3">
        <button
          onClick={() => onAction('guard', selectedTarget || undefined)}
          disabled={!selectedTarget}
          className="flex-1 bg-guard py-3 rounded-lg font-bold disabled:opacity-30"
        >
          守护选中玩家
        </button>
        <button
          onClick={() => onAction('guard')}
          className="px-6 bg-night/60 border border-guard/50 py-3 rounded-lg font-bold hover:bg-night"
        >
          不守护
        </button>
      </div>
    </div>
  );

  const renderWerewolfActions = () => (
  <div className="space-y-3">
      <p className="text-sm text-gray-400">选择一名玩家进行杀害</p>
      <div className="flex gap-3">
        <button
          onClick={() => onAction('kill', selectedTarget || undefined)}
        disabled={!selectedTarget}
          className="flex-1 bg-blood py-3 rounded-lg font-bold disabled:opacity-30"
        >
       杀害选中玩家
        </button>
        <button
          onClick={() => onAction('kill')}
          className="px-6 bg-night/60 border border-blood/50 py-3 rounded-lg font-bold hover:bg-night"
        >
          空刀
        </button>
      </div>
    </div>
  );

  const renderWitchActions = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">选择使用药水</p>
      <div className="grid grid-cols-3 gap-3">
        {witchPotions.antidote && gameState.nightActions?.werewolfTarget && (
          <button
            onClick={() => onAction('witch_save')}
        className="bg-village py-3 rounded-lg font-bold"
          >
            💊 解药
          </button>
        )}
        {witchPotions.poison && (
          <button
          onClick={() => onAction('witch_poison', selectedTarget || undefined)}
            disabled={!selectedTarget}
          className="bg-blood py-3 rounded-lg font-bold disabled:opacity-30"
          >
            ☠️ 毒药
          </button>
        )}
        <button
          onClick={() => onAction('witch_skip')}
     className="bg-night/60 border border-witch/50 py-3 rounded-lg font-bold hover:bg-night"
        >
          跳过
        </button>
      </div>
    </div>
  );

  const renderSeerActions = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">选择一名玩家查验身份</p>
      <div className="flex gap-3">
        <button
          onClick={() => onAction('investigate', selectedTarget || undefined)}
          disabled={!selectedTarget}
          className="flex-1 bg-seer py-3 rounded-lg font-bold disabled:opacity-30"
        >
          查验选中玩家
        </button>
        <button
          onClick={() => onAction('investigate')}
          className="px-6 bg-night/60 border border-seer/50 py-3 rounded-lg font-bold hover:bg-night"
        >
          跳过
        </button>
      </div>
    </div>
  );

  const renderVotingActions = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">投票放逐一名玩家</p>
      <div className="flex gap-3">
        <button
          onClick={() => onAction('vote', selectedTarget || undefined)}
          disabled={!selectedTarget}
       className="flex-1 bg-blood py-3 rounded-lg font-bold disabled:opacity-30"
        >
          投票放逐
        </button>
        <button
          onClick={() => onAction('vote')}
          className="px-6 bg-night/60 border border-gray-500 py-3 rounded-lg font-bold hover:bg-night"
      >
        弃票
        </button>
      </div>
    </div>
  );

  const renderHunterActions = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">你已死亡，可以选择带走一名玩家</p>
      <div className="flex gap-3">
        <button
        onClick={() => onAction('shoot', selectedTarget || undefined)}
          disabled={!selectedTarget}
          className="flex-1 bg-hunter py-3 rounded-lg font-bold disabled:opacity-30"
     >
          🔫 开枪
        </button>
        <button
          onClick={() => onAction('shoot')}
          className="px-6 bg-night/60 border border-hunter/50 py-3 rounded-lg font-bold hover:bg-night"
        >
       放弃
        </button>
    </div>
    </div>
  );

  const shouldShowActions = () => {
    if (phase === 'guard_turn' && myPlayer.role === 'guard') return true;
    if (phase === 'werewolf_turn' && myPlayer.role === 'werewolf') return true;
    if (phase === 'witch_turn' && myPlayer.role === 'witch') return true;
    if (phase === 'seer_turn' && myPlayer.role === 'seer') return true;
    if (phase === 'voting') return true;
    if (phase === 'pk_voting') return true;
    if (phase === 'hunter_shoot' && myPlayer.role === 'hunter') return true;
    return false;
  };

  if (!shouldShowActions()) {
    return null;
  }

  return (
    <div className="bg-dawn/90 backdrop-blur-sm border-t border-wolf/30 px-6 py-4">
      <div className="max-w-7xl mx-auto">
        {phase === 'guard_turn' && myPlayer.role === 'guard' && renderGuardActions()}
        {phase === 'werewolf_turn' && myPlayer.role === 'werewolf' && renderWerewolfActions()}
     {phase === 'witch_turn' && myPlayer.role === 'witch' && renderWitchActions()}
   {phase === 'seer_turn' && myPlayer.role === 'seer' && renderSeerActions()}
        {phase === 'voting' && renderVotingActions()}
        {phase === 'pk_voting' && renderVotingActions()}
        {phase === 'hunter_shoot' && myPlayer.role === 'hunter' && renderHunterActions()}
      </div>
    </div>
  );
}
