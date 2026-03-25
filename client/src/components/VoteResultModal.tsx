import { useEffect, useState } from 'react';

interface VoteInfo {
  voterId: string;
  targetId: string | null;
}

interface Props {
  votes: VoteInfo[];
  players: Array<{ id: string; name: string }>;
  result?: string;
  exiledName?: string;
  onClose: () => void;
}

export default function VoteResultModal({ votes, players, result, exiledName, onClose }: Props) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onClose]);

  const getName = (id: string | null) => {
    if (!id) return '弃票';
    return players.find(p => p.id === id)?.name || '?';
  };

  // 统计每个目标的票数
  const voteCounts = new Map<string, { count: number; voters: string[] }>();
  for (const v of votes) {
    const key = v.targetId || '__abstain__';
    const existing = voteCounts.get(key) || { count: 0, voters: [] };
    existing.count++;
    existing.voters.push(getName(v.voterId));
    voteCounts.set(key, existing);
  }

  // 按票数排序
  const sorted = [...voteCounts.entries()].sort((a, b) => b[1].count - a[1].count);

  const resultText = (() => {
    if (result === 'no_exile' || result === 'pk_no_exile' || result === 'pk_tie_safe') return '平安夜，无人被放逐';
    if (result === 'fool_revealed') return `${exiledName} 翻牌 - 白痴免死！`;
    if (result === 'tie') return '平票！进入PK环节';
    if (result === 'exiled' && exiledName) return `${exiledName} 被放逐`;
    return '投票结束';
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-dawn/95 border border-wolf/40 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl animate-fade-in">
        {/* 标题 */}
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">📊</div>
          <h2 className="text-xl font-bold text-wolf">投票结果</h2>
        </div>

        {/* 投票详情 */}
        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {sorted.map(([key, info]) => (
            <div key={key} className="flex items-center justify-between bg-night/60 rounded-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-wolf">{info.count}</span>
                <span className="text-white font-bold">
                  {key === '__abstain__' ? '弃票' : getName(key)}
                </span>
              </div>
              <div className="text-xs text-gray-400 text-right max-w-[50%] truncate">
                {info.voters.join('、')}
              </div>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="text-center text-gray-400 py-4">全员弃票</div>
          )}
        </div>

        {/* 结果 */}
        <div className="text-center py-3 bg-blood/20 rounded-lg border border-blood/30 mb-3">
          <span className="text-lg font-bold text-blood">{resultText}</span>
        </div>

        {/* 倒计时 */}
        <div className="text-center text-sm text-gray-500">
          {countdown}秒后自动关闭
        </div>
      </div>
    </div>
  );
}
