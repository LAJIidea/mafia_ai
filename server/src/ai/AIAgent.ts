import { Player, GamePhase, RoleName, GameState, ActionRequest, ROLE_DISPLAY_NAME } from '../engine/types.js';
import { writeFileSync as _writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

export interface AIConfig {
  apiToken: string;
  baseUrl: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
}

export const SUPPORTED_MODELS: AIModel[] = [
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'OpenAI' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Anthropic' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', provider: 'Alibaba' },
  { id: 'moonshotai/kimi-k2', name: 'Kimi K2', provider: 'Moonshot' },
];

// ========== 结构化游戏知识 ==========

interface DeadRecord {
  id: string;
  name: string;
  diedRound: number;
  deathCause: 'night_death' | 'vote_exile' | 'hunter_shot';
}

interface VoteRound {
  round: number;
  phase: 'voting' | 'pk_voting';
  votes: Array<{ voter: string; target: string | null }>;
  result: string;
}

interface SpeechRecord {
  round: number;
  phase: string;
  speaker: string;
  content: string;
}

interface ThoughtEntry {
  timestamp: number;
  round: number;
  phase: string;
  playerName: string;
  situation: string;
  rawResponse: string;
  parsedAction: any;
  actionSuccess?: boolean;
  llmLatencyMs: number;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// ========== AIAgent ==========

export class AIAgent {
  private config: AIConfig;
  private model: string;
  private playerName: string = '';
  private playerRole: string = ''; // eslint-disable-line
  private playerId: string = ''; // eslint-disable-line

  // 多轮对话历史
  private conversationHistory: ChatMessage[] = [];

  // 结构化游戏知识
  private deadPlayers: DeadRecord[] = [];
  private voteHistory: VoteRound[] = [];
  private speechesByRound: Map<number, SpeechRecord[]> = new Map();
  private seerResults: Map<string, boolean> = new Map();

  // 旧的flat记忆保留用于兼容
  private memory: string[] = [];

  // 思考日志
  private thoughtLog: ThoughtEntry[] = [];
  private logDir: string;
  private roomId: string = '';

  constructor(config: AIConfig, model: string) {
    this.config = config;
    this.model = model;
    this.logDir = join(process.cwd(), 'logs');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /** 初始化角色（游戏开始时调用） */
  initRole(playerId: string, playerName: string, role: string, roomId: string): void {
    this.playerId = playerId;
    this.playerName = playerName;
    this.playerRole = role;
    this.roomId = roomId;

    // 设定system消息——根据角色定制策略
    const roleName = ROLE_DISPLAY_NAME[role as RoleName] || role;
    let roleStrategy = '';

    switch (role) {
      case RoleName.WEREWOLF:
        roleStrategy = `
【狼人策略】
- 伪装：说话自然，像好人一样分析局势，绝不承认狼人身份
- 协作：知道队友是谁，白天发言不要互踩，可以适当帮队友说话转移火力
- 刀人：优先杀对狼人威胁最大的人（预言家>发言有逻辑的好人>女巫）
- 高级技巧（谨慎使用，不要每局都用）：
  · 悍跳预言家：只在真预言家已跳且对你不利时才考虑
  · 反咬：被怀疑时用逻辑反驳，不要慌张
  · 倒钩：必要时可以投自己队友制造好人假象
  · 站边：主动站在一个好人身边获取信任
- 对跳策略：如果预言家跳出来查到你是狼人，你可以直接对跳声称自己才是预言家，编造查验结果反咬
- 注意：不要过度表演，自然的发言比花哨的技巧更重要`;
        break;
      case RoleName.SEER:
        roleStrategy = `
【预言家策略】
- 查验优先级：第一晚随机查或查发言最多的人，后续查最可疑的
- 6人局查到狼人：第二天可以直接跳预言家公布查验，因为局小信息珍贵
- 9人局/12人局查到狼人：不要急着跳，可以先暗示"我觉得某某很可疑"引导投票，等第二次查验后再跳更有说服力
- 查到好人：可以暗示"我觉得某某应该不是狼"来拉拢盟友
- 如果有人悍跳预言家：必须对跳，亮出你的所有查验结果
- 被投票压力大时：果断跳身份自保，公布查验信息
- 高级技巧：
  · 留警徽流：跳身份时说"如果我今晚被杀，明天请查验XXX"，给好人留线索
  · 报查验时说清楚逻辑："我第一晚查了A是好人，第二晚查了B是狼人，因为B的发言有XXX矛盾"
  · 你的自证能力弱，所以要用多次查验结果和逻辑链来让好人信服`;
        break;
      case RoleName.WITCH:
        roleStrategy = `
【女巫策略】
- 解药：首晚建议开解药（被刀中神的概率高），首晚可以自救
- 毒药：只朝确认的狼人开毒，宁愿闷药也不能随意毒人误杀好人
  · 不要毒跳了猎人或白痴身份的人（他们有自证能力）
  · 确认狼人身份后果断开毒，犹豫会丧失优势
- 前期隐藏身份，但如果解药已用且毒药还在，可以跳身份带队
  · 跳身份时说清楚："我是女巫，昨晚救了XXX"，这能排除两个狼坑
  · 手握毒药能威慑狼人，让他们不敢轻举妄动
- 如果你自救了且被怀疑，反问"如果我是狼人为什么要自救浪费解药"
- 遗言：一定要说出全部用药信息，这是好人最关键的线索`;
        break;
      case RoleName.VILLAGER:
        roleStrategy = `
【平民策略】
- 第一天信息少，多听少怼，观察每个人的发言风格
- 从第二天开始，结合投票记录重点分析：谁在保谁，谁的票去向可疑
- 如果有人跳预言家并给出了查验结果，认真分析他的逻辑是否自洽，如果合理就站他那边
- 不要轻易怀疑跳身份的人，好人互相攻击只会让狼人得利
- 被怀疑时冷静自证，说明自己的投票理由和推理过程
- 高级技巧：
  · 挡刀：如果预言家已跳且很可能被狼人刀，你可以声称"我也是预言家"来替他挡刀
  · 挡刀后如果你被杀，好人就知道你是替预言家挡刀的平民，预言家还活着
  · 但不要乱挡刀，只在预言家确实处于危险时才用
- 关键：集中火力投最可疑的那个人，不要分散投票`;
        break;
      case RoleName.GUARD:
        roleStrategy = `
【守卫策略】
- 优先守护预言家（如果知道谁是预言家）
- 不能连续两晚守同一人，要合理分配
- 首晚建议空守（不守任何人），因为女巫首晚一般会开解药，同守同救会"奶穿"导致被救的人反而死亡
- 从第二晚开始守护最关键的存活神职
- 不要轻易暴露守卫身份，暴露后狼人会绕开你守的人
- 如果守护成功（平安夜），可以在关键时刻公布来自证`;
        break;
      case RoleName.HUNTER:
        roleStrategy = `
【猎人策略】
- 前期隐藏身份，不要暴露自己是猎人，你的枪有很强的威慑力
- 可以假装平民发言，保护自己不被狼人优先刀
- 被投票要出局时：可以亮猎人牌威慑，说"我是猎人，投我出去我要带走一个"
- 被狼人夜杀时：可以开枪，选择最可疑的人带走
- 注意：被女巫毒死时不能开枪！
- 开枪选择：优先带走被预言家查出的狼人，或者发言最可疑的人`;
        break;
      default:
        roleStrategy = '';
    }

    this.conversationHistory = [{
      role: 'system',
      content: `你是一个经验丰富的狼人杀高手，名字叫${playerName}。
你的身份是：${roleName}。
${roleStrategy}

【通用游戏风格】
- 发言简洁有力，30-80字，像真人玩家，每天说不同的内容
- 关注最新一天的信息和投票结果，不停留在第一天
- 根据场上存活人数和局势调整策略
- 讨论时要有自己的观点，但不要一上来就攻击别人
- 怀疑别人时要给出具体理由，不要泛泛而谈
- 第一天信息少，发言可以保守一些，不要过早下结论
- 认真分析每个人的投票行为，投票方向比发言更能暴露身份

【回复格式】
- 回复决策时使用JSON格式：{"action": "xxx", "targetId": "xxx"}
- 回复发言时直接输出文字，不加JSON
- 每次决策前先简要说明你的推理过程（1-2句话），再给出JSON`,
    }];
  }

  // ========== 游戏知识同步 ==========

  /** 同步最新游戏状态到知识库 */
  updateKnowledge(gameState: GameState): void {
    // 检测新的死亡
    for (const p of gameState.players) {
      if (!p.alive && !this.deadPlayers.find(d => d.id === p.id)) {
        const isNight = [GamePhase.DAWN, GamePhase.LAST_WORDS].includes(gameState.phase as GamePhase);
        this.deadPlayers.push({
          id: p.id,
          name: p.name,
          diedRound: gameState.round,
          deathCause: isNight ? 'night_death' : 'vote_exile',
        });
      }
    }
  }

  /** 记录投票结果 */
  recordVoteResult(round: number, phase: string, votes: Array<{ voter: string; target: string | null }>, result: string): void {
    this.voteHistory.push({
      round,
      phase: phase as 'voting' | 'pk_voting',
      votes,
      result,
    });
  }

  /** 记录发言 */
  recordSpeech(round: number, phase: string, speaker: string, content: string): void {
    if (!this.speechesByRound.has(round)) {
      this.speechesByRound.set(round, []);
    }
    this.speechesByRound.get(round)!.push({ round, phase, speaker, content });
  }

  /** 记录预言家查验结果（仅预言家自己调用） */
  recordSeerResult(targetId: string, isWerewolf: boolean): void {
    this.seerResults.set(targetId, isWerewolf);
  }

  // 兼容旧接口
  addMemory(event: string): void {
    this.memory.push(event);
    if (this.memory.length > 80) {
      this.memory = this.memory.slice(-80);
    }
  }

  // ========== 核心决策 ==========

  async decide(player: Player, gameState: GameState): Promise<ActionRequest> {
    this.updateKnowledge(gameState);
    const userMsg = this.buildContextMessage(player, gameState, 'decision');
    const startTime = Date.now();

    try {
      // 添加到对话历史
      this.conversationHistory.push({ role: 'user', content: userMsg });
      this.manageContextWindow();

      const response = await this.callAPI(this.conversationHistory);

      // 记录assistant回复
      this.conversationHistory.push({ role: 'assistant', content: response });

      const action = this.parseResponse(response, player, gameState);

      // 记录思考日志
      this.logThought({
        timestamp: Date.now(),
        round: gameState.round,
        phase: gameState.phase,
        playerName: player.name,
        situation: userMsg,
        rawResponse: response,
        parsedAction: action,
        llmLatencyMs: Date.now() - startTime,
      });

      return action;
    } catch (error) {
      console.error(`AI决策失败 (${this.model}):`, error);
      // 移除失败的user消息
      if (this.conversationHistory[this.conversationHistory.length - 1]?.role === 'user') {
        this.conversationHistory.pop();
      }
      return this.fallbackAction(player, gameState);
    }
  }

  async generateSpeech(player: Player, gameState: GameState): Promise<string> {
    this.updateKnowledge(gameState);
    const userMsg = this.buildContextMessage(player, gameState, 'speech');
    const startTime = Date.now();

    try {
      this.conversationHistory.push({ role: 'user', content: userMsg });
      this.manageContextWindow();

      const response = await this.callAPI(this.conversationHistory);

      // 清理可能的引号包裹
      const cleaned = response.replace(/^["'""]+|["'""]+$/g, '').trim();

      this.conversationHistory.push({ role: 'assistant', content: cleaned });

      this.logThought({
        timestamp: Date.now(),
        round: gameState.round,
        phase: gameState.phase,
        playerName: player.name,
        situation: userMsg,
        rawResponse: cleaned,
        parsedAction: { type: 'speech' },
        llmLatencyMs: Date.now() - startTime,
      });

      return cleaned;
    } catch (error) {
      console.error(`AI发言生成失败 (${this.model}):`, error);
      if (this.conversationHistory[this.conversationHistory.length - 1]?.role === 'user') {
        this.conversationHistory.pop();
      }
      return '我没有什么特别想说的。';
    }
  }

  // ========== 上下文构建 ==========

  private buildContextMessage(player: Player, gameState: GameState, mode: 'decision' | 'speech'): string {
    const round = gameState.round;
    const phase = this.getPhaseDescription(gameState.phase);
    const alivePlayers = gameState.players.filter(p => p.alive);
    const totalPlayers = gameState.players.length;
    const roleName = ROLE_DISPLAY_NAME[player.role as RoleName] || '未知';

    // 每条消息开头强调身份（防止长上下文中遗忘）
    let msg = `[提醒：你是「${player.name}」，身份是${roleName}。当别人提到「${player.name}」时就是在说你。]\n\n`;
    msg += `===== 第${round}天 · ${phase} =====\n\n`;

    // 【场上状况】
    msg += `【场上状况】\n`;
    msg += `- 存活：${alivePlayers.length}/${totalPlayers}人 (${alivePlayers.map(p => p.name).join('、')})\n`;

    if (this.deadPlayers.length > 0) {
      msg += `- 已死亡：\n`;
      for (const d of this.deadPlayers) {
        const causeText = d.deathCause === 'night_death' ? '夜间死亡'
          : d.deathCause === 'vote_exile' ? '被投票放逐'
          : '被猎人带走';
        msg += `  · 第${d.diedRound}天: ${d.name} (${causeText})\n`;
      }
    } else {
      msg += `- 尚无人死亡\n`;
    }

    // 【投票历史】含每人投票详情
    if (this.voteHistory.length > 0) {
      msg += `\n【投票历史】\n`;
      for (const vr of this.voteHistory) {
        msg += `- 第${vr.round}天${vr.phase === 'pk_voting' ? 'PK' : ''}投票: ${vr.result}\n`;
        // 显示每人投了谁（关键信息，用于分析站队）
        for (const v of vr.votes) {
          msg += `  · ${v.voter} → ${v.target || '弃票'}\n`;
        }
      }
    }

    // 【预言家查验结果】（仅预言家可见）
    if (player.role === RoleName.SEER && this.seerResults.size > 0) {
      msg += `\n【你的查验结果】\n`;
      for (const [targetId, isWolf] of this.seerResults) {
        const targetName = gameState.players.find(p => p.id === targetId)?.name || '?';
        msg += `- ${targetName}: ${isWolf ? '🐺 狼人' : '✅ 好人'}\n`;
      }
    }

    // 【狼人队友信息】（仅狼人可见）
    if (player.role === RoleName.WEREWOLF) {
      const wolfTeammates = gameState.players.filter(
        p => p.role === RoleName.WEREWOLF && p.id !== player.id
      );
      const aliveWolves = wolfTeammates.filter(p => p.alive);
      const deadWolves = wolfTeammates.filter(p => !p.alive);

      msg += `\n【🐺 狼人内部信息】\n`;
      if (aliveWolves.length > 0) {
        msg += `- 存活狼队友：${aliveWolves.map(p => p.name).join('、')}\n`;
      }
      if (deadWolves.length > 0) {
        msg += `- 已死狼队友：${deadWolves.map(p => p.name).join('、')}\n`;
      }
      msg += `- 协作要点：白天发言时注意和队友互相配合，不要互相指认，可以适当帮队友说话或转移火力\n`;

      // 狼人回合显示队友投票意向
      if (gameState.phase === GamePhase.WEREWOLF_TURN) {
        const werewolfVotes = gameState.nightActions?.werewolfVotes || [];
        if (werewolfVotes.length > 0) {
          msg += `- 队友刀人意向：\n`;
          for (const v of werewolfVotes) {
            const voterName = gameState.players.find(p => p.id === v.voterId)?.name || '?';
            const targetName = v.targetId ? gameState.players.find(p => p.id === v.targetId)?.name : '空刀';
            msg += `  · ${voterName} → ${targetName}\n`;
          }
          msg += `- 建议：参考队友意向，尽量统一目标避免平票\n`;
        }
      }
    }

    // 【发言记录】按天分隔
    const allRounds = [...this.speechesByRound.keys()].sort((a, b) => a - b);
    if (allRounds.length > 0) {
      msg += `\n`;
      // 只保留最近3天的完整发言，更早的压缩
      for (const r of allRounds) {
        const speeches = this.speechesByRound.get(r) || [];
        if (speeches.length === 0) continue;

        if (r < round - 2) {
          // 旧发言压缩为摘要
          msg += `【第${r}天发言摘要】共${speeches.length}人发言\n`;
        } else {
          msg += `【第${r}天发言记录】\n`;
          // 先展示遗言，再展示讨论发言
          const lastWords = speeches.filter(s => s.phase === GamePhase.LAST_WORDS);
          const discussions = speeches.filter(s => s.phase !== GamePhase.LAST_WORDS);

          if (lastWords.length > 0) {
            msg += `  [遗言]\n`;
            for (const s of lastWords) {
              const prefix = s.speaker === this.playerName ? '我' : s.speaker;
              let content = s.content.substring(0, 120);
              if (s.speaker !== this.playerName && this.playerName && content.includes(this.playerName)) {
                content = content.replace(new RegExp(this.playerName, 'g'), `${this.playerName}(你)`);
              }
              msg += `  - ${prefix}(遗言): "${content}"\n`;
            }
          }
          if (discussions.length > 0) {
            if (lastWords.length > 0) msg += `  [讨论]\n`;
            for (const s of discussions) {
              const prefix = s.speaker === this.playerName ? '我' : s.speaker;
              let content = s.content.substring(0, 120);
              if (s.speaker !== this.playerName && this.playerName && content.includes(this.playerName)) {
                content = content.replace(new RegExp(this.playerName, 'g'), `${this.playerName}(你)`);
              }
              msg += `- ${prefix}: "${content}"\n`;
            }
          }
        }
      }
    }

    // 【本轮信息 + 任务】
    msg += `\n`;
    if (mode === 'speech') {
      msg += this.buildSpeechInstruction(player, gameState);
    } else {
      msg += this.buildDecisionInstruction(player, gameState);
    }

    return msg;
  }

  private buildDecisionInstruction(player: Player, gameState: GameState): string {
    const alivePlayers = gameState.players.filter(p => p.alive);

    switch (gameState.phase) {
      case GamePhase.GUARD_TURN:
        return `【你的任务 - 守卫守护】
选择一名玩家守护（可以守自己，不可连续两晚守同一人）。
${gameState.lastGuardTarget ? `上一晚守了ID: ${gameState.lastGuardTarget}，本晚不能重复。` : ''}
可选目标：
${alivePlayers.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请先说明理由，然后回复JSON：{"action": "guard", "targetId": "玩家ID"}`;

      case GamePhase.WEREWOLF_TURN: {
        const nonWolves = alivePlayers.filter(p => p.role !== RoleName.WEREWOLF);
        const wolfTeammateNames = alivePlayers.filter(p => p.role === RoleName.WEREWOLF && p.id !== player.id).map(p => p.name);
        const wolfVotes = gameState.nightActions?.werewolfVotes || [];
        let wolfHint = '';
        if (wolfVotes.length > 0) {
          const targets = wolfVotes.map((v: any) => {
            const tName = v.targetId ? gameState.players.find(p => p.id === v.targetId)?.name : '空刀';
            return tName;
          });
          wolfHint = `\n队友已选择: ${targets.join('、')}。建议跟随队友目标统一行动，避免平票。`;
        }
        let wolfStrategy = '';
        if (wolfTeammateNames.length > 0) {
          wolfStrategy = `\n白天策略建议：你和队友${wolfTeammateNames.join('、')}可以分别怀疑不同的好人来分散注意力。如果被预言家查到，可以考虑对跳预言家。`;
        }
        return `【你的任务 - 狼人杀人】
选择一名非狼人玩家杀害（不能杀队友，可空刀）。
优先杀对狼人威胁最大的人：预言家 > 发言有逻辑的好人 > 女巫。${wolfHint}${wolfStrategy}
可选目标：
${nonWolves.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请先分析谁威胁最大，然后回复JSON：{"action": "kill", "targetId": "玩家ID"}`;
      }

      case GamePhase.WITCH_TURN: {
        let inst = `【你的任务 - 女巫用药】\n`;
        const target = gameState.nightActions.werewolfTarget;
        const targetName = target ? gameState.players.find(p => p.id === target)?.name || '?' : null;

        if (targetName) {
          inst += `今晚 ${targetName} 被杀害了。\n`;
          if (gameState.witchPotions.antidote) {
            if (target === player.id && gameState.round > 1) {
              inst += `被杀的是你自己，但非首晚不能自救。\n`;
            } else {
              inst += `你有解药，可以救 ${targetName}。\n`;
            }
          }
        } else {
          inst += `今晚是平安夜，无人被杀。\n`;
        }
        if (gameState.witchPotions.poison) {
          inst += `你有毒药，可以毒杀某人。同一晚不能同时用解药和毒药。\n`;
        }
        inst += `请先说明理由，然后回复JSON：
- 救人: {"action": "witch_save"}
- 毒人: {"action": "witch_poison", "targetId": "玩家ID"}
- 跳过: {"action": "witch_skip"}`;
        return inst;
      }

      case GamePhase.SEER_TURN:
        return `【你的任务 - 预言家查验】
选择一名玩家查验其身份。优先查验最可疑的人。
可选目标：
${alivePlayers.filter(p => p.id !== player.id && !this.seerResults.has(p.id)).map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请先说明理由，然后回复JSON：{"action": "investigate", "targetId": "玩家ID"}`;

      case GamePhase.VOTING:
        return `【你的任务 - 投票放逐】
根据以上所有信息，投票放逐你认为最可疑的玩家（可弃票）。
提示：如果有人跳预言家并声称查到了狼人，且他的逻辑自洽，优先投他指认的那个人。好人内讧只会让狼人得利。
可选目标：
${alivePlayers.filter(p => p.id !== player.id).map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请先说明投票理由（结合发言和投票记录分析），然后回复JSON：{"action": "vote", "targetId": "玩家ID"}`;

      case GamePhase.PK_VOTING: {
        const pkCandidates = alivePlayers.filter(p => (gameState.pkCandidates || []).includes(p.id));
        return `【你的任务 - PK投票】
以下玩家平票进入PK，从中选一人放逐：
${pkCandidates.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请先说明理由，然后回复JSON：{"action": "vote", "targetId": "候选人ID"}`;
      }

      case GamePhase.HUNTER_SHOOT:
        return `【你的任务 - 猎人开枪】
你死亡了，可以带走一名玩家。
${alivePlayers.filter(p => p.id !== player.id).map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请回复JSON：{"action": "shoot", "targetId": "玩家ID"} 或放弃 {"action": "shoot"}`;

      default:
        return '请等待。';
    }
  }

  private buildSpeechInstruction(player: Player, gameState: GameState): string {
    const roleName = ROLE_DISPLAY_NAME[player.role as RoleName] || '未知';
    const phaseDesc = gameState.phase === GamePhase.PK_SPEECH ? 'PK发言'
      : gameState.phase === GamePhase.LAST_WORDS ? '遗言'
      : '讨论发言';

    return `【你的任务 - ${phaseDesc}】
你的真实身份是：${roleName}
请根据当前局势和你的身份策略，生成一段发言（30-80字）。

要求：
- 关注最新一天的信息，不要重复之前说过的话
- ${player.role === RoleName.WEREWOLF ? '你是狼人，需要伪装。注意：不要踩你的狼队友，可以适当帮队友说话或转移火力到其他人身上' : '你是好人阵营，积极推理分析，尝试找出狼人，关注谁在保谁、谁的投票行为可疑'}
- 有自己的独立观点，不要只是附和或否定别人
- 第一天可以分析发言风格和态度，但不要下定论
- 从第二天起要更果断：结合投票行为给出明确判断
- 直接输出发言文字，不要加JSON`;
  }

  // ========== 上下文窗口管理 ==========

  private manageContextWindow(): void {
    // 保留system + 最近18条对话（共20条上限）
    if (this.conversationHistory.length > 20) {
      const system = this.conversationHistory[0];
      const recentMessages = this.conversationHistory.slice(-18);

      // 压缩被移除的旧对话为摘要
      const removed = this.conversationHistory.slice(1, -18);
      const summary = this.compressMessages(removed);

      const roleName = ROLE_DISPLAY_NAME[this.playerRole as RoleName] || this.playerRole;
      this.conversationHistory = [
        system,
        { role: 'user', content: `[提醒：你是「${this.playerName}」，身份是${roleName}。]\n\n【之前的游戏摘要】\n${summary}` },
        { role: 'assistant', content: `好的，我是${this.playerName}，我已了解之前的游戏情况，继续。` },
        ...recentMessages,
      ];
    }
  }

  private compressMessages(messages: ChatMessage[]): string {
    // 提取关键信息
    const lines: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && msg.content.includes('=====')) {
        // 提取阶段标题
        const titleMatch = msg.content.match(/=====\s*(.+?)\s*=====/);
        if (titleMatch) lines.push(titleMatch[1]);
      }
      if (msg.role === 'assistant' && msg.content.length < 200) {
        lines.push(`我回复: ${msg.content.substring(0, 100)}`);
      }
    }
    return lines.join('\n') || '游戏早期阶段，信息有限。';
  }

  // ========== LLM API调用 ==========

  private async callAPI(messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiToken}`,
          'HTTP-Referer': 'https://werewolf-ai-game.app',
          'X-Title': 'Werewolf AI Game',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content || '';
    } finally {
      clearTimeout(timeout);
    }
  }

  // ========== Response解析 ==========

  private parseResponse(response: string, player: Player, gameState: GameState): ActionRequest {
    try {
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          playerId: player.id,
          action: parsed.action,
          targetId: parsed.targetId || undefined,
        };
      }
    } catch {
      // JSON解析失败
    }
    return this.fallbackAction(player, gameState);
  }

  private fallbackAction(player: Player, gameState: GameState): ActionRequest {
    const alivePlayers = gameState.players.filter(p => p.alive && p.id !== player.id);
    const randomTarget = alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null;

    switch (gameState.phase) {
      case GamePhase.GUARD_TURN:
        return { playerId: player.id, action: 'guard', targetId: randomTarget?.id };
      case GamePhase.WEREWOLF_TURN: {
        const nonWolves = alivePlayers.filter(p => p.role !== RoleName.WEREWOLF);
        const target = nonWolves.length > 0
          ? nonWolves[Math.floor(Math.random() * nonWolves.length)]
          : null;
        return { playerId: player.id, action: 'kill', targetId: target?.id };
      }
      case GamePhase.WITCH_TURN:
        return { playerId: player.id, action: 'witch_skip' };
      case GamePhase.SEER_TURN:
        return { playerId: player.id, action: 'investigate', targetId: randomTarget?.id };
      case GamePhase.VOTING:
        return { playerId: player.id, action: 'vote', targetId: randomTarget?.id };
      case GamePhase.PK_VOTING: {
        const pkIds = gameState.pkCandidates || [];
        const pkTargets = alivePlayers.filter(p => pkIds.includes(p.id));
        const pkTarget = pkTargets.length > 0
          ? pkTargets[Math.floor(Math.random() * pkTargets.length)]
          : null;
        return { playerId: player.id, action: 'vote', targetId: pkTarget?.id };
      }
      case GamePhase.HUNTER_SHOOT:
        return { playerId: player.id, action: 'shoot', targetId: randomTarget?.id };
      default:
        return { playerId: player.id, action: 'skip' };
    }
  }

  // ========== 思考日志 ==========

  private logThought(entry: ThoughtEntry): void {
    this.thoughtLog.push(entry);
    try {
      const logFile = join(this.logDir, `ai_thoughts_${this.roomId || 'unknown'}.jsonl`);
      appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch { /* 日志写入失败不影响游戏 */ }
  }

  /** 获取思考日志（用于评估） */
  getThoughtLog(): ThoughtEntry[] {
    return this.thoughtLog;
  }

  /** 获取对话历史（用于调试） */
  getConversationHistory(): ChatMessage[] {
    return this.conversationHistory;
  }

  private getPhaseDescription(phase: GamePhase | string): string {
    const descriptions: Record<string, string> = {
      [GamePhase.WAITING]: '等待中',
      [GamePhase.NIGHT_START]: '夜晚',
      [GamePhase.GUARD_TURN]: '守卫行动',
      [GamePhase.WEREWOLF_TURN]: '狼人行动',
      [GamePhase.WITCH_TURN]: '女巫行动',
      [GamePhase.SEER_TURN]: '预言家行动',
      [GamePhase.DAWN]: '天亮了',
      [GamePhase.LAST_WORDS]: '遗言',
      [GamePhase.DISCUSSION]: '讨论',
      [GamePhase.VOTING]: '投票',
      [GamePhase.VOTE_RESULT]: '投票结果',
      [GamePhase.PK_SPEECH]: 'PK发言',
      [GamePhase.PK_VOTING]: 'PK投票',
      [GamePhase.HUNTER_SHOOT]: '猎人开枪',
      [GamePhase.GAME_OVER]: '游戏结束',
    };
    return descriptions[phase] || phase;
  }
}

// ========== AIManager ==========

export class AIManager {
  private agents = new Map<string, AIAgent>();
  private config: AIConfig | null = null;

  setConfig(apiToken: string): void {
    this.config = {
      apiToken,
      baseUrl: 'https://openrouter.ai',
    };
  }

  getConfig(): AIConfig | null {
    return this.config;
  }

  createAgent(playerId: string, model: string): AIAgent | null {
    if (!this.config) return null;

    const agent = new AIAgent(this.config, model);
    this.agents.set(playerId, agent);
    return agent;
  }

  getAgent(playerId: string): AIAgent | undefined {
    return this.agents.get(playerId);
  }

  removeAgent(playerId: string): void {
    this.agents.delete(playerId);
  }

  clearAll(): void {
    this.agents.clear();
  }
}
