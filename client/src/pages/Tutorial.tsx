import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface TutorialStep {
  title: string;
  content: string;
  action?: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '欢迎来到狼人杀',
    content: '狼人杀是一个经典的策略推理桌游。游戏分为两个阵营：狼人阵营和好人阵营。白天讨论投票，夜晚技能行动。让我们一步步了解游戏规则！',
  },
  {
    title: '两大阵营',
    content: '🐺 狼人阵营：夜间杀人，白天伪装。目标是杀光所有神职或所有平民（屠边）。\n\n🏘️ 好人阵营：包括平民和神职。目标是白天投票放逐所有狼人。',
  },
  {
    title: '神职角色 - 预言家',
    content: '🔮 预言家：每晚可以查验一名玩家，得知对方是否为狼人。是好人阵营的核心信息来源。\n\n技巧：白天发言时可以选择公开验人结果，引导好人阵营投票。',
  },
  {
    title: '神职角色 - 女巫',
    content: '🧪 女巫：拥有两瓶药水，全局各一次。\n\n💊 解药：可以救活当晚被狼人杀害的玩家。\n☠️ 毒药：可以毒杀任一玩家。\n\n注意：解药用完后，女巫将不再得知当晚谁被杀。',
  },
  {
    title: '神职角色 - 猎人和守卫',
    content: '🔫 猎人：被狼人杀害或被投票放逐时，可以开枪带走一名玩家。但被女巫毒杀时不能开枪。\n\n🛡️ 守卫：每晚守护一名玩家使其免受狼人伤害。可以自守，但不能连续两晚守同一人。',
  },
  {
    title: '特殊角色 - 白痴',
    content: '🤡 白痴：当被投票放逐时，可以翻牌亮明身份免于死亡。但翻牌后将永久失去投票权。\n\n白痴是好人阵营的一员，翻牌是一次性的保命技能。',
  },
  {
    title: '游戏流程 - 夜晚',
    content: '🌙 夜晚阶段按顺序进行：\n\n1️⃣ 守卫选择守护目标\n2️⃣ 狼人讨论并选择杀害目标\n3️⃣ 女巫决定是否用药\n4️⃣ 预言家查验一名玩家\n\n每个阶段有时间限制，超时自动跳过。',
  },
  {
    title: '游戏流程 - 白天',
    content: '☀️ 白天阶段：\n\n1️⃣ 宣布昨晚死亡情况\n2️⃣ 死者留遗言\n3️⃣ 存活玩家按顺序发言讨论\n4️⃣ 投票放逐一名嫌疑人\n\n如果投票出现平票，将进入PK环节：平票玩家再次发言，其他人再投票。再次平票则当日平安。',
  },
  {
    title: '真人与AI对战',
    content: '🤖 本游戏支持真人与AI混合对战！\n\n• 真人玩家通过手机或电脑端参与\n• AI玩家由6种大模型驱动（GPT、Claude、Gemini等）\n• AI会自动进行操作和发言\n• 每个AI有独特的语音音色\n\n你可以在设置页面配置AI的API Token。',
  },
  {
    title: '准备就绪！',
    content: '恭喜你已经了解了狼人杀的基本规则！\n\n现在你可以：\n• 创建房间，邀请朋友和AI一起玩\n• 在规则页面随时回顾详细规则\n\n祝你游戏愉快！',
    action: 'finish',
  },
];

export default function Tutorial() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());

  const step = TUTORIAL_STEPS[currentStep];
  const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;

  const handleNext = () => {
    setCompleted(prev => new Set([...prev, currentStep]));
    if (isLastStep) {
      navigate('/');
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSkipAttempt = () => {
    if (!completed.has(currentStep)) {
      // Mark current step as read first
      setCompleted(prev => new Set([...prev, currentStep]));
    }
  };

  return (
    <div className="min-h-screen night-overlay flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        {/* Progress bar */}
        <div className="flex gap-1">
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                i === currentStep ? 'bg-wolf' : i < currentStep ? 'bg-wolf/50' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="bg-dawn/50 rounded-2xl p-8 border border-wolf/20 min-h-[300px] flex flex-col">
          <div className="text-xs text-gray-500 mb-2">
            教程 {currentStep + 1} / {TUTORIAL_STEPS.length}
          </div>
          <h2 className="text-2xl font-bold text-wolf mb-6">{step.title}</h2>
          <div className="flex-1 text-gray-300 whitespace-pre-line leading-relaxed">
            {step.content}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-4">
          {currentStep > 0 && (
            <button
              onClick={handleBack}
              className="px-6 py-3 bg-night/60 border border-wolf/30 rounded-lg font-bold hover:bg-night"
            >
              上一步
            </button>
          )}
          <button
            onClick={() => { handleSkipAttempt(); handleNext(); }}
            className="flex-1 bg-gradient-to-r from-wolf to-seer py-3 rounded-lg font-bold text-lg transition-all hover:opacity-90"
          >
            {isLastStep ? '开始游戏' : '下一步'}
          </button>
        </div>

        {/* Skip to home */}
        {!isLastStep && (
          <button
            onClick={() => navigate('/')}
            className="w-full text-center text-sm text-gray-500 hover:text-wolf transition-colors"
          >
            跳过教程
          </button>
        )}
      </div>
    </div>
  );
}
