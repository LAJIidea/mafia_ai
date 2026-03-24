import { Player, GamePhase, RoleName, GameState, ActionRequest, ROLE_DISPLAY_NAME } from '../engine/types.js';

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

export class AIAgent {
  private config: AIConfig;
  private model: string;
  private memory: string[] = [];  // AI 记忆（观察到的事件）

  constructor(config: AIConfig, model: string) {
    this.config = config;
    this.model = model;
  }

  async decide(player: Player, gameState: GameState): Promise<ActionRequest> {
    const prompt = this.buildPrompt(player, gameState);

    try {
      const response = await this.callAPI(prompt);
      const action = this.parseResponse(response, player, gameState);
      return action;
    } catch (error) {
      console.error(`AI决策失败 (${this.model}):`, error);
      return this.fallbackAction(player, gameState);
    }
  }

  async generateSpeech(player: Player, gameState: GameState): Promise<string> {
    const prompt = this.buildSpeechPrompt(player, gameState);

    try {
      const response = await this.callAPI(prompt);
      return response;
    } catch (error) {
      console.error(`AI发言生成失败 (${this.model}):`, error);
      return '我没有什么特别想说的。';
    }
  }

  addMemory(event: string): void {
    this.memory.push(event);
    // 保留最近50条记忆
    if (this.memory.length > 50) {
      this.memory = this.memory.slice(-50);
    }
  }

  private buildPrompt(player: Player, gameState: GameState): string {
    const role = player.role ? ROLE_DISPLAY_NAME[player.role] : '未知';
    const alivePlayers = gameState.players.filter(p => p.alive);
    const phase = this.getPhaseDescription(gameState.phase);

    let prompt = `你是一个狼人杀游戏的AI玩家。
你的名字是：${player.name}
你的身份是：${role}
当前是第${gameState.round}轮，阶段：${phase}

存活玩家列表：
${alivePlayers.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}

你的记忆（观察到的事件）：
${this.memory.length > 0 ? this.memory.join('\n') : '暂无'}

`;

    switch (gameState.phase) {
      case GamePhase.GUARD_TURN:
        prompt += `你是守卫，请选择一名玩家进行守护（也可以选择自己，或者不守护）。
${gameState.lastGuardTarget ? `注意：你上一晚守护了ID为 ${gameState.lastGuardTarget} 的玩家，本晚不能守同一人。` : ''}
请以JSON格式回复：{"action": "guard", "targetId": "玩家ID"} 或 {"action": "guard", "targetId": null}`;
        break;

      case GamePhase.WEREWOLF_TURN:
        const nonWerewolves = alivePlayers.filter(p => p.role !== RoleName.WEREWOLF);
        prompt += `你是狼人，请选择一名非狼人玩家进行杀害（也可以空刀）。
可选目标：
${nonWerewolves.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请以JSON格式回复：{"action": "kill", "targetId": "玩家ID"} 或 {"action": "kill", "targetId": null}`;
        break;

      case GamePhase.WITCH_TURN:
        prompt += `你是女巫。`;
        if (gameState.witchPotions.antidote && gameState.nightActions.werewolfTarget) {
          prompt += `\n今晚有人被狼人杀害了。你有解药，是否使用解药救人？`;
        }
        if (gameState.witchPotions.poison) {
          prompt += `\n你有毒药，是否使用毒药毒杀某人？`;
        }
        prompt += `\n请以JSON格式回复以下之一：
- 使用解药：{"action": "witch_save"}
- 使用毒药：{"action": "witch_poison", "targetId": "玩家ID"}
- 跳过：{"action": "witch_skip"}`;
        break;

      case GamePhase.SEER_TURN:
        prompt += `你是预言家，请选择一名玩家查验其是否为狼人。
请以JSON格式回复：{"action": "investigate", "targetId": "玩家ID"}`;
        break;

      case GamePhase.VOTING:
        prompt += `现在是投票阶段，请选择一名你认为是狼人的玩家进行投票（也可以弃票）。
请以JSON格式回复：{"action": "vote", "targetId": "玩家ID"} 或 {"action": "vote", "targetId": null}`;
        break;

      case GamePhase.PK_VOTING:
        const pkCandidates = alivePlayers.filter(p => gameState.pkCandidates?.includes(p.id));
        prompt += `现在是PK投票阶段，以下玩家平票进入PK：
${pkCandidates.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}
请从PK候选人中选择一人投票（也可以弃票）。
请以JSON格式回复：{"action": "vote", "targetId": "候选人ID"} 或 {"action": "vote", "targetId": null}`;
        break;

      case GamePhase.HUNTER_SHOOT:
        prompt += `你是猎人，你刚刚死亡，可以选择带走一名玩家。
请以JSON格式回复：{"action": "shoot", "targetId": "玩家ID"} 或 {"action": "shoot", "targetId": null}`;
        break;
    }

    return prompt;
  }

  private buildSpeechPrompt(player: Player, gameState: GameState): string {
    const role = player.role ? ROLE_DISPLAY_NAME[player.role] : '未知';

    return `你是一个狼人杀游戏的AI玩家。
你的名字是：${player.name}
你的真实身份是：${role}
当前是第${gameState.round}轮，发言阶段。

你的记忆：
${this.memory.length > 0 ? this.memory.join('\n') : '暂无'}

请根据你的身份和策略，生成一段合理的发言（30-100字）。
注意：
- 如果你是狼人，你需要伪装自己
- 如果你是好人，你需要分析局势找出狼人
- 发言要自然，像真人玩家
- 直接回复发言内容，不要包含JSON或其他格式`;
  }

  private async callAPI(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
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
        messages: [
          { role: 'system', content: '你是一个聪明的狼人杀玩家。你需要根据规则和当前局势做出最优决策。回复要简洁。' },
          { role: 'user', content: prompt },
        ],
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

  private parseResponse(response: string, player: Player, gameState: GameState): ActionRequest {
    try {
      // 尝试从回复中提取JSON
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
      // JSON解析失败，使用降级策略
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

  private getPhaseDescription(phase: GamePhase): string {
    const descriptions: Record<GamePhase, string> = {
      [GamePhase.WAITING]: '等待中',
      [GamePhase.NIGHT_START]: '天黑了',
      [GamePhase.GUARD_TURN]: '守卫行动',
      [GamePhase.WEREWOLF_TURN]: '狼人行动',
      [GamePhase.WITCH_TURN]: '女巫行动',
      [GamePhase.SEER_TURN]: '预言家行动',
      [GamePhase.DAWN]: '天亮了',
      [GamePhase.LAST_WORDS]: '遗言阶段',
      [GamePhase.DISCUSSION]: '讨论阶段',
      [GamePhase.VOTING]: '投票阶段',
      [GamePhase.VOTE_RESULT]: '投票结果',
      [GamePhase.PK_SPEECH]: 'PK发言',
      [GamePhase.PK_VOTING]: 'PK投票',
      [GamePhase.HUNTER_SHOOT]: '猎人开枪',
      [GamePhase.GAME_OVER]: '游戏结束',
    };
    return descriptions[phase] || phase;
  }
}

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
