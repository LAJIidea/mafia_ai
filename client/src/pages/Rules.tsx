import { useNavigate } from 'react-router-dom';

export default function Rules() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen night-overlay p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <button
       onClick={() => navigate('/')}
          className="text-wolf hover:text-white transition-colors"
        >
          ← 返回首页
        </button>

        <h1 className="text-3xl font-black text-center mb-8">
          <span className="text-wolf">狼人杀</span> 游戏规则
        </h1>

        {/* 游戏目标 */}
        <section className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
          <h2 className="text-xl font-bold text-wolf mb-4">🎯 游戏目标</h2>
          <div className="space-y-3 text-gray-300">
        <p><strong className="text-blood">狼人阵营：</strong>杀光所有神职 或 杀光所有平民（屠边）</p>
            <p><strong className="text-village">好人阵营：</strong>白天投票放逐所有狼人</p>
          </div>
      </section>

        {/* 角色介绍 */}
        <section className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
          <h2 className="text-xl font-bold text-wolf mb-4">👥 角色介绍</h2>
        <div className="space-y-4">
            <div className="bg-night/40 rounded-lg p-4">
              <h3 className="font-bold text-blood mb-2">🐺 狼人</h3>
            <p className="text-sm text-gray-300">夜间共同选择杀害一名玩家，可以空刀或自刀。</p>
       </div>

            <div className="bg-night/40 rounded-lg p-4">
              <h3 className="font-bold text-village mb-2">👤 平民</h3>
              <p className="text-sm text-gray-300">无特殊技能，白天通过发言和投票帮助好人阵营找出狼人。</p>
         </div>

        <div className="bg-night/40 rounded-lg p-4">
              <h3 className="font-bold text-seer mb-2">🔮 预言家</h3>
              <p className="text-sm text-gray-300">夜间可以查验一名玩家是否为狼人。</p>
            </div>

            <div className="bg-night/40 rounded-lg p-4">
              <h3 className="font-bold text-witch mb-2">🧪 女巫</h3>
              <p className="text-sm text-gray-300">拥有解药（救人）和毒药（毒杀）各一瓶。解药用完后不再得知被杀者。</p>
            </div>

            <div className="bg-night/40 rounded-lg p-4">
              <h3 className="font-bold text-hunter mb-2">🔫 猎人</h3>
              <p className="text-sm text-gray-300">被狼人杀或被投票放逐时可开枪带走一人。被毒杀时不能开枪。</p>
            </div>

            <div className="bg-night/40 rounded-lg p-4">
          <h3 className="font-bold text-guard mb-2">🛡️ 守卫</h3>
              <p className="text-sm text-gray-300">夜间守护一名玩家免受狼人伤害。可自守，不能连续两晚守同一人。同守同救失效。</p>
            </div>
       </div>
        </section>

        {/* 游戏流程 */}
        <section className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
          <h2 className="text-xl font-bold text-wolf mb-4">🔄 游戏流程</h2>

          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-lg mb-2">🌙 夜间阶段</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
             <li>守卫守护</li>
        <li>狼人杀人</li>
                <li>女巫使用药水</li>
                <li>预言家查验</li>
      </ol>
            </div>

         <div>
              <h3 className="font-bold text-lg mb-2">☀️ 白天阶段</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
              <li>宣布死讯</li>
                <li>遗言（被杀者最后发言）</li>
            <li>依序发言讨论</li>
                <li>投票放逐</li>
                <li>处决或平安</li>
              </ol>
            </div>
          </div>
        </section>

        {/* 投票规则 */}
      <section className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
          <h2 className="text-xl font-bold text-wolf mb-4">🗳️ 投票规则</h2>
          <ul className="list-disc list-inside space-y-2 text-sm text-gray-300">
            <li>存活玩家一人一票</li>
            <li>票数最多者被放逐</li>
            <li>平票时进入PK（平票玩家再发言，其他玩家再投票）</li>
       <li>再次平票则当日平安</li>
          </ul>
        </section>

        {/* 推荐配置 */}
        <section className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20">
       <h2 className="text-xl font-bold text-wolf mb-4">⚙️ 推荐配置</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div className="bg-night/40 rounded-lg p-4">
              <div className="font-bold mb-2">6人局</div>
      <div className="text-gray-300">2狼 + 2民 + 2神（预言家、女巫）</div>
        </div>
            <div className="bg-night/40 rounded-lg p-4">
              <div className="font-bold mb-2">9人局</div>
          <div className="text-gray-300">3狼 + 3民 + 3神（预言家、女巫、猎人）</div>
          </div>
            <div className="bg-night/40 rounded-lg p-4">
              <div className="font-bold mb-2">12人局</div>
           <div className="text-gray-300">4狼 + 4民 + 4神（预言家、女巫、猎人、守卫）</div>
            </div>
          <div className="bg-night/40 rounded-lg p-4">
              <div className="font-bold mb-2">16人局</div>
       <div className="text-gray-300">5狼 + 6民 + 5神（预言家、女巫、猎人、守卫、白痴）</div>
         </div>
          </div>
        </section>
      </div>
    </div>
  );
}
