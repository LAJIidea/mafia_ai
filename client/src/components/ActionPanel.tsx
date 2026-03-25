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
  pkCandidates?: string[];
  myPlayerId?: string;
}

export default function ActionPanel({ phase, myPlayer, selectedTarget, onAction, witchPotions, gameState, pkCandidates = [], myPlayerId = '' }: Props) {
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

  const renderWerewolfActions = () => {
    const wolfTeammates = gameState?.players?.filter(
      (p: any) => p.role === 'werewolf' && p.id !== myPlayer?.id && p.alive
    ) || [];
    const werewolfVotes: Array<{ voterId: string; targetId: string | null }> = gameState?.nightActions?.werewolfVotes || [];
    const myVote = werewolfVotes.find((v: any) => v.voterId === myPlayer?.id);
    const allWolves = gameState?.players?.filter((p: any) => p.role === 'werewolf' && p.alive) || [];
    const getName = (id: string | null) => id ? gameState?.players?.find((p: any) => p.id === id)?.name || '?' : '空刀';

    return (
    <div className="space-y-3">
      {/* 狼队友 */}
      {wolfTeammates.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-red-400 mb-1">
          <span>🐺 你的狼队友：</span>
          {wolfTeammates.map((w: any) => (
            <span key={w.id} className="bg-red-900/40 px-2 py-0.5 rounded text-red-300 font-bold">{w.name}</span>
          ))}
        </div>
      )}

      {/* 狼人投票意向面板 */}
      {werewolfVotes.length > 0 && (
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-3 mb-2">
          <div className="text-xs text-red-400 mb-2">🗳️ 狼队投票意向 ({werewolfVotes.length}/{allWolves.length})</div>
          <div className="flex flex-wrap gap-2">
            {werewolfVotes.map((v: any, i: number) => {
              const voterName = gameState?.players?.find((p: any) => p.id === v.voterId)?.name || '?';
              return (
                <div key={i} className="bg-red-900/40 px-3 py-1 rounded text-sm">
                  <span className="text-red-300">{voterName}</span>
                  <span className="text-gray-500 mx-1">→</span>
                  <span className="text-white font-bold">{getName(v.targetId)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      {myVote ? (
        <div className="text-center text-sm text-gray-400 py-2">
          ✅ 你已选择：<span className="text-red-300 font-bold">{getName(myVote.targetId)}</span>，等待其他狼人...
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
    );
  };

  const renderWitchActions = () => {
    const killedId = gameState.nightActions?.werewolfTarget;
    const killedPlayer = killedId ? gameState.players?.find((p: any) => p.id === killedId) : null;
    const round = gameState.round || 1;
    const isSelfKilled = killedId === myPlayerId;
    // 非首晚不能自救
    const canSave = witchPotions.antidote && killedPlayer && !(isSelfKilled && round > 1);

    return (
    <div className="space-y-3">
      {killedPlayer ? (
        <div className="bg-blood/20 border border-blood/40 rounded-lg px-4 py-3 mb-2">
          <span className="text-blood font-bold">💀 今晚被杀：{killedPlayer.name}</span>
          {isSelfKilled && round > 1 && (
            <span className="text-gray-400 text-sm ml-2">（非首晚不能自救）</span>
          )}
        </div>
      ) : (
        <div className="bg-night/40 border border-gray-600 rounded-lg px-4 py-3 mb-2">
          <span className="text-gray-400">今晚是平安夜，没有人被杀</span>
        </div>
      )}
      <p className="text-sm text-gray-400">选择使用药水（同一晚只能用一种）</p>
      <div className="grid grid-cols-3 gap-3">
        {canSave && (
          <button
            onClick={() => onAction('witch_save')}
            className="bg-village py-3 rounded-lg font-bold"
          >
            💊 救 {killedPlayer!.name}
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
  };

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
    if (phase === 'pk_voting') return !pkCandidates.includes(myPlayerId); // candidates can't vote
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
