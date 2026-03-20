import { v4 as uuidv4 } from 'uuid';
import {
  GameState, GamePhase, Player, RoleName, Team, PlayerType,
  NightActions, VoteRecord, ActionRequest, ActionResult,
  RoomConfig, ROLE_TEAM, PRESET_CONFIGS, WitchPotions,
} from './types.js';

export class GameEngine {
  private state: GameState;

  constructor(roomId: string, config: RoomConfig) {
    this.validateConfig(config);
    this.state = {
      roomId,
      phase: GamePhase.WAITING,
      round: 0,
      players: [],
      config,
      nightActions: this.emptyNightActions(),
      witchPotions: { antidote: true, poison: true },
      lastGuardTarget: null,
      votes: [],
      deaths: [],
      events: [],
      hunterCanShoot: false,
      winner: null,
    };
  }

  getState(): GameState {
    return { ...this.state };
  }

  getPlayerView(playerId: string): Partial<GameState> {
    const player = this.findPlayer(playerId);
    if (!player) return {};

    const state = this.getState();
    // 隐藏其他玩家的角色信息（除非游戏结束）
    if (state.phase !== GamePhase.GAME_OVER) {
      state.players = state.players.map(p => {
        if (p.id === playerId) return p;
        // 狼人可以看到其他狼人
        if (player.role === RoleName.WEREWOLF && p.role === RoleName.WEREWOLF) return p;
        return { ...p, role: null };
      });
    }
    // 隐藏夜间行动细节
    state.nightActions = this.emptyNightActions();
    return state;
  }

  addPlayer(name: string, type: PlayerType, device: 'desktop' | 'mobile', aiModel?: string): ActionResult {
    if (this.state.phase !== GamePhase.WAITING) {
      return { success: false, message: '游戏已开始，无法加入' };
    }
    if (this.state.players.length >= this.state.config.totalPlayers) {
      return { success: false, message: '房间已满' };
    }

    // 电脑端最多1个真人
    if (type === PlayerType.HUMAN && device === 'desktop') {
      const desktopHumans = this.state.players.filter(p => p.type === PlayerType.HUMAN && p.device === 'desktop');
      if (desktopHumans.length >= 1) {
        return { success: false, message: '电脑端仅支持1名真人玩家' };
      }
    }

    // 真人玩家最多4个
    if (type === PlayerType.HUMAN) {
      const humanCount = this.state.players.filter(p => p.type === PlayerType.HUMAN).length;
      if (humanCount >= 4) {
        return { success: false, message: '真人玩家最多4人' };
      }
    }

    const player: Player = {
      id: uuidv4(),
      name,
      type,
      role: null,
      alive: true,
      device,
      aiModel,
      connected: true,
    };

    this.state.players.push(player);
    return { success: true, data: { playerId: player.id } };
  }

  removePlayer(playerId: string): ActionResult {
    if (this.state.phase !== GamePhase.WAITING) {
      return { success: false, message: '游戏已开始，无法离开' };
    }
    this.state.players = this.state.players.filter(p => p.id !== playerId);
    return { success: true };
  }

  startGame(): ActionResult {
    if (this.state.phase !== GamePhase.WAITING) {
      return { success: false, message: '游戏已经开始' };
    }
    if (this.state.players.length !== this.state.config.totalPlayers) {
      return { success: false, message: `需要${this.state.config.totalPlayers}名玩家才能开始` };
    }

    const humanCount = this.state.players.filter(p => p.type === PlayerType.HUMAN).length;
    if (humanCount < 1) {
      return { success: false, message: '至少需要1名真人玩家' };
    }

    this.assignRoles();
    this.state.round = 1;
    this.transitionTo(GamePhase.NIGHT_START);
    return { success: true };
  }

  handleAction(request: ActionRequest): ActionResult {
    const player = this.findPlayer(request.playerId);
    if (!player) {
      return { success: false, message: '玩家不存在' };
    }
    if (!player.alive && request.action !== 'hunter_shoot') {
      return { success: false, message: '你已死亡，无法操作' };
    }

    switch (this.state.phase) {
      case GamePhase.GUARD_TURN:
        return this.handleGuardAction(player, request);
      case GamePhase.WEREWOLF_TURN:
        return this.handleWerewolfAction(player, request);
      case GamePhase.WITCH_TURN:
        return this.handleWitchAction(player, request);
      case GamePhase.SEER_TURN:
        return this.handleSeerAction(player, request);
      case GamePhase.VOTING:
        return this.handleVoteAction(player, request);
      case GamePhase.HUNTER_SHOOT:
        return this.handleHunterShoot(player, request);
      default:
        return { success: false, message: '当前阶段不允许此操作' };
    }
  }

  // 跳过当前阶段（超时处理）
  skipCurrentPhase(): void {
    this.advancePhase();
  }

  // ========== 私有方法 ==========

  private validateConfig(config: RoomConfig): void {
    if (config.totalPlayers < 6 || config.totalPlayers > 16) {
      throw new Error('玩家人数必须在6-16之间');
    }
    const totalRoles = Object.values(config.roleConfig).reduce((a, b) => a + b, 0);
    if (totalRoles !== config.totalPlayers) {
      throw new Error('角色总数必须等于玩家人数');
    }
    if ((config.roleConfig[RoleName.WEREWOLF] || 0) < 1) {
      throw new Error('至少需要1名狼人');
    }
  }

  private assignRoles(): void {
    const roles: RoleName[] = [];
    for (const [role, count] of Object.entries(this.state.config.roleConfig)) {
      for (let i = 0; i < count; i++) {
        roles.push(role as RoleName);
      }
    }
    // Fisher-Yates 洗牌
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    this.state.players.forEach((player, index) => {
      player.role = roles[index];
    });
  }

  private emptyNightActions(): NightActions {
    return {
      guardTarget: null,
      werewolfTarget: null,
      witchSave: false,
      witchPoisonTarget: null,
      seerTarget: null,
    };
  }

  private findPlayer(playerId: string): Player | undefined {
    return this.state.players.find(p => p.id === playerId);
  }

  private alivePlayers(): Player[] {
    return this.state.players.filter(p => p.alive);
  }

  private alivePlayersByRole(role: RoleName): Player[] {
    return this.state.players.filter(p => p.alive && p.role === role);
  }

  private transitionTo(phase: GamePhase): void {
    this.state.phase = phase;
    this.addEvent(phase, {});

    // 跳过没有存活角色的阶段
    if (phase === GamePhase.GUARD_TURN && this.alivePlayersByRole(RoleName.GUARD).length === 0) {
      this.transitionTo(GamePhase.WEREWOLF_TURN);
      return;
    }
    if (phase === GamePhase.WITCH_TURN && this.alivePlayersByRole(RoleName.WITCH).length === 0) {
      this.transitionTo(GamePhase.SEER_TURN);
      return;
    }
    if (phase === GamePhase.SEER_TURN && this.alivePlayersByRole(RoleName.SEER).length === 0) {
      this.resolveDawn();
      return;
    }
    if (phase === GamePhase.NIGHT_START) {
      this.state.nightActions = this.emptyNightActions();
      this.state.deaths = [];
      this.transitionTo(GamePhase.GUARD_TURN);
    }
  }

  private advancePhase(): void {
    switch (this.state.phase) {
      case GamePhase.GUARD_TURN:
        this.transitionTo(GamePhase.WEREWOLF_TURN);
        break;
      case GamePhase.WEREWOLF_TURN:
        this.transitionTo(GamePhase.WITCH_TURN);
        break;
      case GamePhase.WITCH_TURN:
        this.transitionTo(GamePhase.SEER_TURN);
        break;
      case GamePhase.SEER_TURN:
        this.resolveDawn();
        break;
      case GamePhase.DAWN:
        if (this.state.deaths.length > 0) {
          this.transitionTo(GamePhase.LAST_WORDS);
        } else {
          this.transitionTo(GamePhase.DISCUSSION);
        }
        break;
      case GamePhase.LAST_WORDS:
        this.transitionTo(GamePhase.DISCUSSION);
        break;
      case GamePhase.DISCUSSION:
        this.transitionTo(GamePhase.VOTING);
        break;
      case GamePhase.VOTING:
        this.resolveVotes();
        break;
      case GamePhase.VOTE_RESULT:
        this.checkWinCondition();
        if (!this.state.winner) {
          this.state.round++;
          this.transitionTo(GamePhase.NIGHT_START);
        }
        break;
      case GamePhase.HUNTER_SHOOT:
        this.checkWinCondition();
        if (!this.state.winner) {
          // 猎人开枪后继续当前流程
          if (this.state.deaths.length > 0 && this.state.phase === GamePhase.HUNTER_SHOOT) {
            this.transitionTo(GamePhase.DISCUSSION);
          }
        }
        break;
    }
  }

  private handleGuardAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.GUARD) {
      return { success: false, message: '你不是守卫' };
    }
    if (request.action !== 'guard') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId || null;

    // 不能连续两晚守同一人
    if (targetId && targetId === this.state.lastGuardTarget) {
      return { success: false, message: '不能连续两晚守护同一名玩家' };
    }

    if (targetId) {
      const target = this.findPlayer(targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标玩家不存在或已死亡' };
      }
    }

    this.state.nightActions.guardTarget = targetId;
    this.state.lastGuardTarget = targetId;
    this.advancePhase();
    return { success: true, message: targetId ? '守护成功' : '未选择守护目标' };
  }

  private handleWerewolfAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.WEREWOLF) {
      return { success: false, message: '你不是狼人' };
    }
    if (request.action !== 'kill') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId || null; // null 表示空刀
    if (targetId) {
      const target = this.findPlayer(targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标玩家不存在或已死亡' };
      }
    }

    this.state.nightActions.werewolfTarget = targetId;
    this.advancePhase();
    return { success: true, message: targetId ? '已选择目标' : '选择空刀' };
  }

  private handleWitchAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.WITCH) {
      return { success: false, message: '你不是女巫' };
    }

    if (request.action === 'witch_save') {
      if (!this.state.witchPotions.antidote) {
        return { success: false, message: '解药已用完' };
      }
      if (!this.state.nightActions.werewolfTarget) {
        return { success: false, message: '今晚没有人被杀' };
      }
      this.state.nightActions.witchSave = true;
      this.state.witchPotions.antidote = false;
      this.advancePhase();
      return { success: true, message: '已使用解药' };
    }

    if (request.action === 'witch_poison') {
      if (!this.state.witchPotions.poison) {
        return { success: false, message: '毒药已用完' };
      }
      const targetId = request.targetId;
      if (!targetId) {
        return { success: false, message: '请选择毒药目标' };
      }
      const target = this.findPlayer(targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标无效' };
      }
      this.state.nightActions.witchPoisonTarget = targetId;
      this.state.witchPotions.poison = false;
      this.advancePhase();
      return { success: true, message: '已使用毒药' };
    }

    if (request.action === 'witch_skip') {
      this.advancePhase();
      return { success: true, message: '女巫跳过' };
    }

    return { success: false, message: '无效操作' };
  }

  private handleSeerAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.SEER) {
      return { success: false, message: '你不是预言家' };
    }
    if (request.action !== 'investigate') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId;
    if (!targetId) {
      this.advancePhase();
      return { success: true, message: '跳过查验' };
    }

    const target = this.findPlayer(targetId);
    if (!target || !target.alive) {
      return { success: false, message: '目标无效' };
    }

    this.state.nightActions.seerTarget = targetId;
    const isWerewolf = target.role === RoleName.WEREWOLF;
    this.advancePhase();
    return {
      success: true,
      message: isWerewolf ? '查验结果：狼人' : '查验结果：好人',
      data: { targetId, isWerewolf },
    };
  }

  private handleVoteAction(player: Player, request: ActionRequest): ActionResult {
    if (request.action !== 'vote') {
      return { success: false, message: '无效操作' };
    }
    if (!player.alive) {
      return { success: false, message: '死亡玩家不能投票' };
    }

    // 检查是否已投票
    if (this.state.votes.find(v => v.voterId === player.id)) {
      return { success: false, message: '你已经投过票了' };
    }

    const targetId = request.targetId || null;
    if (targetId) {
      const target = this.findPlayer(targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标无效' };
      }
    }

    this.state.votes.push({ voterId: player.id, targetId });

    // 所有存活玩家投票完成
    if (this.state.votes.length >= this.alivePlayers().length) {
      this.resolveVotes();
    }

    return { success: true, message: '投票成功' };
  }

  private handleHunterShoot(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.HUNTER) {
      return { success: false, message: '你不是猎人' };
    }
    if (!this.state.hunterCanShoot) {
      return { success: false, message: '猎人无法开枪（被毒杀）' };
    }
    if (request.action !== 'shoot') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId;
    if (targetId) {
      const target = this.findPlayer(targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标无效' };
      }
      target.alive = false;
      this.state.deaths.push(targetId);
      this.addEvent(GamePhase.HUNTER_SHOOT, { hunterId: player.id, targetId });
    }

    this.state.hunterCanShoot = false;
    this.advancePhase();
    return { success: true, message: targetId ? '猎人开枪' : '猎人放弃开枪' };
  }

  private resolveDawn(): void {
    const nightActions = this.state.nightActions;
    this.state.deaths = [];

    // 解算狼人杀人
    if (nightActions.werewolfTarget) {
      let killed = true;

      // 守卫守护
      if (nightActions.guardTarget === nightActions.werewolfTarget) {
        killed = false;
      }

      // 女巫解药
      if (nightActions.witchSave) {
        // 同守同救失效
        if (nightActions.guardTarget === nightActions.werewolfTarget) {
          killed = true; // 同守同救，两者都不生效
        } else {
          killed = false;
        }
      }

      if (killed) {
        const target = this.findPlayer(nightActions.werewolfTarget);
        if (target) {
          target.alive = false;
          this.state.deaths.push(target.id);

          // 猎人被狼杀可以开枪
          if (target.role === RoleName.HUNTER) {
            this.state.hunterCanShoot = true;
          }
        }
      }
    }

    // 解算女巫毒药
    if (nightActions.witchPoisonTarget) {
      const target = this.findPlayer(nightActions.witchPoisonTarget);
      if (target && target.alive) {
        target.alive = false;
        this.state.deaths.push(target.id);

        // 猎人被毒杀不能开枪
        if (target.role === RoleName.HUNTER) {
          this.state.hunterCanShoot = false;
        }
      }
    }

    this.addEvent(GamePhase.DAWN, { deaths: [...this.state.deaths] });

    // 先检查胜负
    const winner = this.calculateWinner();
    if (winner) {
      this.state.winner = winner;
      this.transitionTo(GamePhase.GAME_OVER);
      return;
    }

    // 检查猎人是否需要开枪
    if (this.state.hunterCanShoot) {
      this.state.phase = GamePhase.DAWN;
      // 会在 dawn -> hunter_shoot 之间处理
      this.transitionTo(GamePhase.HUNTER_SHOOT);
      return;
    }

    this.transitionTo(GamePhase.DAWN);
  }

  private resolveVotes(): void {
    const voteCounts = new Map<string, number>();
    for (const vote of this.state.votes) {
      if (vote.targetId) {
        voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
      }
    }

    if (voteCounts.size === 0) {
      // 全部弃票，平安日
      this.addEvent(GamePhase.VOTE_RESULT, { result: 'no_exile', votes: [...this.state.votes] });
      this.state.votes = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    const maxVotes = Math.max(...voteCounts.values());
    const topPlayers = [...voteCounts.entries()].filter(([, count]) => count === maxVotes);

    if (topPlayers.length > 1) {
      // 平票，当日平安
      this.addEvent(GamePhase.VOTE_RESULT, { result: 'tie', votes: [...this.state.votes] });
      this.state.votes = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    // 放逐得票最多的玩家
    const exiledId = topPlayers[0][0];
    const exiled = this.findPlayer(exiledId);
    if (exiled) {
      exiled.alive = false;
      this.state.deaths.push(exiledId);

      // 猎人被放逐可以开枪
      if (exiled.role === RoleName.HUNTER) {
        this.state.hunterCanShoot = true;
      }
    }

    this.addEvent(GamePhase.VOTE_RESULT, {
      result: 'exiled',
      exiledId,
      votes: [...this.state.votes],
    });

    this.state.votes = [];

    // 检查猎人开枪
    if (this.state.hunterCanShoot) {
      this.state.phase = GamePhase.HUNTER_SHOOT;
      return;
    }

    // 检查胜负
    this.checkWinCondition();
    if (!this.state.winner) {
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
    }
  }

  private checkWinCondition(): void {
    const winner = this.calculateWinner();
    if (winner) {
      this.state.winner = winner;
      this.transitionTo(GamePhase.GAME_OVER);
    }
  }

  private calculateWinner(): Team | null {
    const alive = this.alivePlayers();
    const aliveWerewolves = alive.filter(p => p.role === RoleName.WEREWOLF);
    const aliveVillagers = alive.filter(p => p.role === RoleName.VILLAGER);
    const aliveGods = alive.filter(p =>
      p.role && ROLE_TEAM[p.role] === Team.VILLAGER && p.role !== RoleName.VILLAGER
    );

    // 狼人全部死亡 → 好人胜
    if (aliveWerewolves.length === 0) {
      return Team.VILLAGER;
    }

    // 平民全部死亡（屠民） → 狼人胜
    if (aliveVillagers.length === 0) {
      return Team.WEREWOLF;
    }

    // 神职全部死亡（屠神） → 狼人胜
    if (aliveGods.length === 0) {
      return Team.WEREWOLF;
    }

    return null;
  }

  private addEvent(phase: GamePhase, data: Record<string, unknown>): void {
    this.state.events.push({
      type: phase,
      phase,
      round: this.state.round,
      data,
      timestamp: Date.now(),
    });
  }
}

// 验证角色配置
export function validateRoleConfig(totalPlayers: number, roleConfig: Record<RoleName, number>): string | null {
  if (totalPlayers < 6 || totalPlayers > 16) {
    return '玩家人数必须在6-16之间';
  }

  const total = Object.values(roleConfig).reduce((a, b) => a + b, 0);
  if (total !== totalPlayers) {
    return '角色总数必须等于玩家人数';
  }

  if ((roleConfig[RoleName.WEREWOLF] || 0) < 1) {
    return '至少需要1名狼人';
  }

  return null;
}

// 根据人数生成默认配置
export function getDefaultConfig(totalPlayers: number): Record<RoleName, number> {
  if (PRESET_CONFIGS[totalPlayers]) {
    return { ...PRESET_CONFIGS[totalPlayers] };
  }

  // 对非预设人数，按比例生成
  const werewolves = Math.max(2, Math.floor(totalPlayers / 3));
  const gods = Math.min(werewolves + 1, 5);
  const villagers = totalPlayers - werewolves - gods;

  const config: Record<RoleName, number> = {
    [RoleName.WEREWOLF]: werewolves,
    [RoleName.VILLAGER]: villagers,
    [RoleName.SEER]: 1,
    [RoleName.WITCH]: 1,
    [RoleName.HUNTER]: gods >= 3 ? 1 : 0,
    [RoleName.GUARD]: gods >= 4 ? 1 : 0,
  };

  // 剩余神职位给平民
  const assignedGods = config[RoleName.SEER] + config[RoleName.WITCH] +
    config[RoleName.HUNTER] + config[RoleName.GUARD];
  config[RoleName.VILLAGER] += (gods - assignedGods);

  return config;
}
