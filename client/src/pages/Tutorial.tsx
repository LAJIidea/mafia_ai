import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

type SimAction = 'select_target' | 'use_skill' | 'vote' | 'confirm' | null;

interface TutorialStep {
  title: string;
  content: string;
  simAction: SimAction;
  simPrompt?: string;
  simChoices?: string[];
  simCorrectChoice?: number;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '欢迎来到狼人杀',
    content: '狼人杀是一个经典的策略推理桌游。游戏分为两个阵营：狼人阵营和好人阵营。\n\n接下来我们将通过一局模拟游戏，带你体验完整的游戏流程。',
    simAction: 'confirm',
    simPrompt: '点击"我准备好了"开始模拟游戏',
    simChoices: ['我准备好了'],
    simCorrectChoice: 0,
  },
  {
    title: '模拟：身份分配',
    content: '游戏开始！你被分配到的身份是：🔮 预言家\n\n预言家属于好人阵营的神职角色，每晚可以查验一名玩家是否为狼人。\n\n现在天黑了，轮到你行动。',
    simAction: 'select_target',
    simPrompt: '请选择一名玩家进行查验：',
    simChoices: ['玩家A', '玩家B（狼人）', '玩家C'],
    simCorrectChoice: 1,
  },
  {
    title: '模拟：查验结果',
    content: '你查验了玩家B，结果显示：🐺 狼人！\n\n这是重要的信息。白天讨论时，你可以选择公开或隐藏这个结果。\n\n同时，狼人在夜间杀害了玩家D。女巫选择不使用药水。',
    simAction: 'confirm',
    simPrompt: '天亮了，点击继续',
    simChoices: ['天亮了'],
    simCorrectChoice: 0,
  },
  {
    title: '模拟：白天讨论',
    content: '☀️ 天亮了！玩家D昨晚被杀害。\n\n现在是讨论阶段，每位存活玩家按顺序发言。\n\n作为预言家，你需要决定发言策略。',
    simAction: 'select_target',
    simPrompt: '选择你的发言策略：',
    simChoices: ['公开身份并报出查验结果', '隐藏身份，暗示怀疑玩家B', '沉默不说话'],
    simCorrectChoice: 0,
  },
  {
    title: '模拟：投票放逐',
    content: '讨论结束，你公开了预言家身份并报出玩家B是狼人。\n\n多数玩家选择相信你。现在进入投票阶段。\n\n请投出你的一票：',
    simAction: 'vote',
    simPrompt: '请投票放逐一名玩家：',
    simChoices: ['玩家A', '玩家B（狼人）', '玩家C', '弃票'],
    simCorrectChoice: 1,
  },
  {
    title: '模拟：投票结果',
    content: '投票结果：玩家B获得最多票数，被放逐出局！\n\n玩家B的真实身份是 🐺 狼人。好人阵营的判断是正确的。\n\n如果投票出现平票，会进入PK环节：\n- 平票玩家再次发言\n- 其他玩家再投票\n- 再次平票则当日平安',
    simAction: 'confirm',
    simPrompt: '点击继续进入下一轮',
    simChoices: ['继续'],
    simCorrectChoice: 0,
  },
  {
    title: '模拟：第二晚',
    content: '🌙 天黑了，第二轮开始。\n\n作为预言家，你可以再次查验一名玩家。\n\n守卫选择守护了你（守卫不能连续两晚守同一人）。\n狼人试图杀害你，但守卫的守护生效了！',
    simAction: 'select_target',
    simPrompt: '选择查验目标：',
    simChoices: ['玩家A', '玩家C', '玩家E'],
    simCorrectChoice: 0,
  },
  {
    title: '模拟：游戏继续',
    content: '☀️ 天亮了！昨晚是平安夜，没有人死亡。\n\n你查验了玩家A，结果是好人。\n\n经过讨论和投票，另一名狼人被放逐。\n\n🏘️ 好人阵营获胜！所有狼人已被放逐！',
    simAction: 'confirm',
    simPrompt: '恭喜通关！',
    simChoices: ['查看总结'],
    simCorrectChoice: 0,
  },
  {
    title: '教程完成',
    content: '恭喜你完成了模拟教程！你已经了解了：\n\n✅ 身份分配与阵营\n✅ 夜间角色行动顺序\n✅ 白天讨论与发言策略\n✅ 投票放逐机制\n✅ 平票PK规则\n✅ 守卫守护机制\n\n现在你可以创建房间，与AI和朋友一起玩真正的狼人杀了！',
    simAction: 'confirm',
    simPrompt: '点击开始游戏',
    simChoices: ['开始游戏'],
    simCorrectChoice: 0,
  },
];

export default function Tutorial() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [stepCompleted, setStepCompleted] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState<string | null>(null);
  const [showBlockMessage, setShowBlockMessage] = useState(false);

  const step = TUTORIAL_STEPS[currentStep];
  const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;

  const handleChoice = useCallback((index: number) => {
    setSelectedChoice(index);
    if (step.simCorrectChoice !== undefined && index === step.simCorrectChoice) {
      setShowFeedback('correct');
      setStepCompleted(true);
    } else if (step.simAction === 'confirm') {
      setStepCompleted(true);
      setShowFeedback(null);
    } else {
      setShowFeedback('wrong');
      setTimeout(() => {
        setShowFeedback(null);
        setSelectedChoice(null);
      }, 1500);
    }
  }, [step]);

  const handleNext = useCallback(() => {
    if (!stepCompleted) {
      setShowBlockMessage(true);
      setTimeout(() => setShowBlockMessage(false), 2000);
      return;
    }
    if (isLastStep) {
      navigate('/');
      return;
    }
    setCurrentStep(prev => prev + 1);
    setStepCompleted(false);
    setSelectedChoice(null);
    setShowFeedback(null);
  }, [stepCompleted, isLastStep, navigate]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
      setStepCompleted(false);
      setSelectedChoice(null);
      setShowFeedback(null);
    }
  }, [currentStep]);

  const handleSkipAttempt = useCallback(() => {
    setShowBlockMessage(true);
    setTimeout(() => setShowBlockMessage(false), 2000);
  }, []);

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
        <div className="bg-dawn/50 rounded-2xl p-8 border border-wolf/20 min-h-[320px] flex flex-col">
          <div className="text-xs text-gray-500 mb-2">
            教程 {currentStep + 1} / {TUTORIAL_STEPS.length}
          </div>
          <h2 className="text-2xl font-bold text-wolf mb-6">{step.title}</h2>
          <div className="flex-1 text-gray-300 whitespace-pre-line leading-relaxed">
            {step.content}
          </div>

          {/* Simulation interaction */}
          {step.simAction && step.simChoices && (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-seer font-bold">{step.simPrompt}</p>
              <div className="grid grid-cols-1 gap-2">
                {step.simChoices.map((choice, i) => (
                  <button
                    key={i}
                    onClick={() => handleChoice(i)}
                    disabled={stepCompleted}
                    className={`text-left px-4 py-3 rounded-lg border transition-all ${
                      selectedChoice === i && showFeedback === 'correct'
                        ? 'border-village bg-village/20 text-village'
                        : selectedChoice === i && showFeedback === 'wrong'
                          ? 'border-blood bg-blood/20 text-blood animate-pulse'
                          : stepCompleted
                            ? 'border-gray-700 text-gray-500 cursor-not-allowed'
                            : 'border-wolf/30 hover:border-wolf text-gray-300 hover:text-white cursor-pointer'
                    }`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {showFeedback === 'wrong' && (
                <p className="text-sm text-blood">请再想想，选择更合适的选项。</p>
              )}
              {showFeedback === 'correct' && (
                <p className="text-sm text-village">正确！点击下一步继续。</p>
              )}
            </div>
          )}
        </div>

        {/* Block message */}
        {showBlockMessage && (
          <div className="bg-blood/20 border border-blood/50 rounded-lg px-4 py-3 text-blood text-sm text-center">
            请先完成当前步骤的操作才能继续
          </div>
        )}

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
            onClick={handleNext}
            className={`flex-1 py-3 rounded-lg font-bold text-lg transition-all ${
              stepCompleted
                ? 'bg-gradient-to-r from-wolf to-seer hover:opacity-90'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {isLastStep ? '开始游戏' : '下一步'}
          </button>
        </div>

        {/* No skip - show message instead */}
        {!isLastStep && (
          <button
            onClick={handleSkipAttempt}
            className="w-full text-center text-sm text-gray-600 hover:text-gray-400 transition-colors"
          >
            跳过教程
          </button>
        )}
      </div>
    </div>
  );
}
