import { v4 as uuidv4 } from 'uuid';
import {
  GameState, GamePhase, Player, RoleName, Team, PlayerType,
  NightActions, VoteRecord, ActionRequest, ActionResult,
  RoomConfig, ROLE_TEAM, PRESET_CONFIGS, WitchPotions, PHASE_TIMEOUTS,
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
      currentSpeaker: null,
      speakerQueue: [],
      phaseDeadline: null,
      pkCandidates: [],
    };
  }

  getState(): GameState {
    // Deep copy to prevent external mutation
    return JSON.parse(JSON.stringify(this.state));
  }

  getPlayerView(playerId: string): Partial<GameState> {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return {};

    const state = this.getState();
    if (state.phase !== GamePhase.GAME_OVER) {
      state.players = state.players.map(p => {
        if (p.id === playerId) return p;
        if (player.role === RoleName.WEREWOLF && p.role === RoleName.WEREWOLF) return p;
        return { ...p, role: null };
      });
    }

    // 角色特定的nightActions视图
    if (player.role === RoleName.WITCH && state.phase === GamePhase.WITCH_TURN) {
      // 女巫看到今晚被杀者
      state.nightActions = {
        ...this.emptyNightActions(),
        werewolfTarget: this.state.nightActions.werewolfTarget,
      };
    } else if (player.role === RoleName.WEREWOLF && state.phase === GamePhase.WEREWOLF_TURN) {
      // 狼人看到队友的投票意向
      state.nightActions = {
        ...this.emptyNightActions(),
        werewolfVotes: this.state.nightActions.werewolfVotes,
      };
    } else {
      state.nightActions = this.emptyNightActions();
    }

    return state;
  }

  addPlayer(name: string, type: PlayerType, device: 'desktop' | 'mobile', aiModel?: string): ActionResult {
    if (this.state.phase !== GamePhase.WAITING) {
      return { success: false, message: '游戏已开始，无法加入' };
    }
    if (this.state.players.length >= this.state.config.totalPlayers) {
      return { success: false, message: '房间已满' };
    }

    if (type === PlayerType.HUMAN && device === 'desktop') {
      const desktopHumans = this.state.players.filter(p => p.type === PlayerType.HUMAN && p.device === 'desktop');
      if (desktopHumans.length >= 1) {
        return { success: false, message: '电脑端仅支持1名真人玩家' };
      }
    }

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
      foolRevealed: false,
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
    const player = this.state.players.find(p => p.id === request.playerId);
    if (!player) {
      return { success: false, message: '玩家不存在' };
    }
    if (!player.alive && request.action !== 'hunter_shoot' && request.action !== 'shoot') {
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
      case GamePhase.PK_VOTING:
        return this.handlePKVoteAction(player, request);
      case GamePhase.HUNTER_SHOOT:
        return this.handleHunterShoot(player, request);
      default:
        return { success: false, message: '当前阶段不允许此操作' };
    }
  }

  // 检查发言权限
  canSpeak(playerId: string): boolean {
    if (this.state.phase !== GamePhase.DISCUSSION &&
        this.state.phase !== GamePhase.LAST_WORDS &&
        this.state.phase !== GamePhase.PK_SPEECH) {
      return false;
    }
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    // 遗言阶段：只有死者可发言
    if (this.state.phase === GamePhase.LAST_WORDS) {
      if (player.alive) return false; // 活人不能在遗言阶段发言
      // 检查是否是当前发言的死者
      if (this.state.currentSpeaker) {
        return this.state.currentSpeaker === playerId;
      }
      return this.state.deaths.includes(playerId);
    }

    // 讨论/PK发言：只有活人可发言
    if (!player.alive) return false;

    if (this.state.currentSpeaker) {
      return this.state.currentSpeaker === playerId;
    }
    return true;
  }

  // 推进发言到下一个人
  advanceSpeaker(): void {
    if (this.state.speakerQueue.length > 0) {
      this.state.currentSpeaker = this.state.speakerQueue.shift()!;
      this.setPhaseDeadline();
    } else {
      this.state.currentSpeaker = null;
      this.advancePhase();
    }
  }

  skipCurrentPhase(): void {
    this.state.currentSpeaker = null;
    this.state.speakerQueue = [];
    this.advancePhase();
  }

  getPhaseDeadline(): number | null {
    return this.state.phaseDeadline;
  }

  // ========== 私有方法 ==========

  private setPhaseDeadline(): void {
    const timeout = PHASE_TIMEOUTS[this.state.phase];
    this.state.phaseDeadline = timeout ? Date.now() + timeout : null;
  }

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
      werewolfVotes: [],
      witchSave: false,
      witchPoisonTarget: null,
      seerTarget: null,
    };
  }

  private alivePlayers(): Player[] {
    return this.state.players.filter(p => p.alive);
  }

  private alivePlayersByRole(role: RoleName): Player[] {
    return this.state.players.filter(p => p.alive && p.role === role);
  }

  private transitionTo(phase: GamePhase): void {
    this.state.phase = phase;
    this.state.currentSpeaker = null;
    this.state.speakerQueue = [];
    this.setPhaseDeadline();
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
      return;
    }
    if (phase === GamePhase.DAWN) {
      // 黎明自动推进到遗言或讨论
      this.advancePhase();
      return;
    }
    if (phase === GamePhase.LAST_WORDS) {
      // 遗言阶段：死者发言队列
      this.state.speakerQueue = [...this.state.deaths];
      this.state.currentSpeaker = this.state.speakerQueue.shift() || null;
      if (!this.state.currentSpeaker) {
        // 无死者，跳过遗言
        this.transitionTo(GamePhase.DISCUSSION);
        return;
      }
    }
    if (phase === GamePhase.DISCUSSION) {
      this.setupSpeakerQueue();
    }
    if (phase === GamePhase.PK_SPEECH) {
      this.state.speakerQueue = [...this.state.pkCandidates];
      this.state.currentSpeaker = this.state.speakerQueue.shift() || null;
    }
  }

  private setupSpeakerQueue(): void {
    this.state.speakerQueue = this.alivePlayers().map(p => p.id);
    this.state.currentSpeaker = this.state.speakerQueue.shift() || null;
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
        this.state.votes = [];
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
      case GamePhase.PK_SPEECH:
        this.state.votes = [];
        this.transitionTo(GamePhase.PK_VOTING);
        break;
      case GamePhase.PK_VOTING:
        this.resolvePKVotes();
        break;
      case GamePhase.HUNTER_SHOOT:
        this.checkWinCondition();
        if (!this.state.winner) {
          this.state.phase = GamePhase.VOTE_RESULT;
          this.advancePhase();
        }
        break;
    }
  }

  private handleGuardAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.GUARD) {
      return { success: false, message: '未轮到你操作' };
    }
    if (request.action !== 'guard') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId || null;
    if (targetId && targetId === this.state.lastGuardTarget) {
      return { success: false, message: '不能连续两晚守护同一名玩家' };
    }
    if (targetId) {
      const target = this.state.players.find(p => p.id === targetId);
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
      return { success: false, message: '未轮到你操作' };
    }
    if (request.action !== 'kill') {
      return { success: false, message: '无效操作' };
    }

    // 检查是否已投过
    const alreadyVoted = this.state.nightActions.werewolfVotes.find(v => v.voterId === player.id);
    if (alreadyVoted) {
      return { success: false, message: '你已经投过票了' };
    }

    const targetId = request.targetId || null;
    if (targetId) {
      const target = this.state.players.find(p => p.id === targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标玩家不存在或已死亡' };
      }
      // 不能杀自己队友
      if (target.role === RoleName.WEREWOLF) {
        return { success: false, message: '不能杀害狼人队友' };
      }
    }

    // 记录这个狼人的投票
    this.state.nightActions.werewolfVotes.push({ voterId: player.id, targetId });

    // 检查是否所有存活狼人都已投票
    const aliveWolves = this.alivePlayersByRole(RoleName.WEREWOLF);
    if (this.state.nightActions.werewolfVotes.length >= aliveWolves.length) {
      // 统计投票结果
      this.resolveWerewolfVotes();
      this.advancePhase();
    }

    return { success: true, message: targetId ? '已选择目标' : '选择空刀', data: {
      werewolfVotes: this.state.nightActions.werewolfVotes,
      totalWolves: aliveWolves.length,
    }};
  }

  private resolveWerewolfVotes(): void {
    const votes = this.state.nightActions.werewolfVotes;
    const voteCounts = new Map<string, number>();

    for (const vote of votes) {
      if (vote.targetId) {
        voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
      }
    }

    if (voteCounts.size === 0) {
      // 全部空刀
      this.state.nightActions.werewolfTarget = null;
      return;
    }

    const maxVotes = Math.max(...voteCounts.values());
    const topTargets = [...voteCounts.entries()].filter(([, count]) => count === maxVotes);

    if (topTargets.length === 1) {
      // 多数票一致
      this.state.nightActions.werewolfTarget = topTargets[0][0];
    } else {
      // 平票：随机从最高票目标中选一个
      const randomIdx = Math.floor(Math.random() * topTargets.length);
      this.state.nightActions.werewolfTarget = topTargets[randomIdx][0];
    }
  }

  private handleWitchAction(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.WITCH) {
      return { success: false, message: '未轮到你操作' };
    }

    if (request.action === 'witch_save') {
      if (!this.state.witchPotions.antidote) {
        return { success: false, message: '解药已用完' };
      }
      if (!this.state.nightActions.werewolfTarget) {
        return { success: false, message: '今晚没有人被杀' };
      }
      // 同一晚不能同时使用解药和毒药
      if (this.state.nightActions.witchPoisonTarget) {
        return { success: false, message: '本晚已使用毒药，不能再使用解药' };
      }
      // 非首晚不能自救（被杀目标是自己）
      if (this.state.nightActions.werewolfTarget === player.id && this.state.round > 1) {
        return { success: false, message: '非首晚不能自救' };
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
      // 同一晚不能同时使用解药和毒药
      if (this.state.nightActions.witchSave) {
        return { success: false, message: '本晚已使用解药，不能再使用毒药' };
      }
      const targetId = request.targetId;
      if (!targetId) {
        return { success: false, message: '请选择毒药目标' };
      }
      const target = this.state.players.find(p => p.id === targetId);
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
      return { success: false, message: '未轮到你操作' };
    }
    if (request.action !== 'investigate') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId;
    if (!targetId) {
      this.advancePhase();
      return { success: true, message: '跳过查验' };
    }

    const target = this.state.players.find(p => p.id === targetId);
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
    // 白痴翻牌后不能投票
    if (player.foolRevealed) {
      return { success: false, message: '白痴翻牌后不能投票' };
    }
    if (this.state.votes.find(v => v.voterId === player.id)) {
      return { success: false, message: '你已经投过票了' };
    }

    const targetId = request.targetId || null;
    if (targetId) {
      const target = this.state.players.find(p => p.id === targetId);
      if (!target || !target.alive) {
        return { success: false, message: '目标无效' };
      }
    }

    this.state.votes.push({ voterId: player.id, targetId });

    const eligibleVoters = this.alivePlayers().filter(p => !p.foolRevealed);
    if (this.state.votes.length >= eligibleVoters.length) {
      this.resolveVotes();
    }

    return { success: true, message: '投票成功' };
  }

  private handlePKVoteAction(player: Player, request: ActionRequest): ActionResult {
    if (request.action !== 'vote') {
      return { success: false, message: '无效操作' };
    }
    if (!player.alive) {
      return { success: false, message: '死亡玩家不能投票' };
    }
    // PK中，候选人不能投票
    if (this.state.pkCandidates.includes(player.id)) {
      return { success: false, message: 'PK候选人不能投票' };
    }
    if (player.foolRevealed) {
      return { success: false, message: '白痴翻牌后不能投票' };
    }
    if (this.state.votes.find(v => v.voterId === player.id)) {
      return { success: false, message: '你已经投过票了' };
    }

    const targetId = request.targetId || null;
    if (targetId && !this.state.pkCandidates.includes(targetId)) {
      return { success: false, message: '只能投票给PK候选人' };
    }

    this.state.votes.push({ voterId: player.id, targetId });

    const eligibleVoters = this.alivePlayers().filter(
      p => !this.state.pkCandidates.includes(p.id) && !p.foolRevealed
    );
    if (this.state.votes.length >= eligibleVoters.length) {
      this.resolvePKVotes();
    }

    return { success: true, message: '投票成功' };
  }

  private handleHunterShoot(player: Player, request: ActionRequest): ActionResult {
    if (player.role !== RoleName.HUNTER) {
      return { success: false, message: '未轮到你操作' };
    }
    if (!this.state.hunterCanShoot) {
      return { success: false, message: '猎人无法开枪（被毒杀）' };
    }
    if (request.action !== 'shoot') {
      return { success: false, message: '无效操作' };
    }

    const targetId = request.targetId;
    if (targetId) {
      const target = this.state.players.find(p => p.id === targetId);
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

    if (nightActions.werewolfTarget) {
      let killed = true;

      if (nightActions.guardTarget === nightActions.werewolfTarget) {
        killed = false;
      }

      if (nightActions.witchSave) {
        if (nightActions.guardTarget === nightActions.werewolfTarget) {
          killed = true; // 同守同救失效
        } else {
          killed = false;
        }
      }

      if (killed) {
        const target = this.state.players.find(p => p.id === nightActions.werewolfTarget);
        if (target) {
          target.alive = false;
          this.state.deaths.push(target.id);
          if (target.role === RoleName.HUNTER) {
            this.state.hunterCanShoot = true;
          }
        }
      }
    }

    if (nightActions.witchPoisonTarget) {
      const target = this.state.players.find(p => p.id === nightActions.witchPoisonTarget);
      if (target && target.alive) {
        target.alive = false;
        this.state.deaths.push(target.id);
        if (target.role === RoleName.HUNTER) {
          this.state.hunterCanShoot = false;
        }
      }
    }

    this.addEvent(GamePhase.DAWN, { deaths: [...this.state.deaths] });

    const winner = this.calculateWinner();
    if (winner) {
      this.state.winner = winner;
      this.transitionTo(GamePhase.GAME_OVER);
      return;
    }

    if (this.state.hunterCanShoot) {
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
      this.addEvent(GamePhase.VOTE_RESULT, { result: 'no_exile', votes: [...this.state.votes] });
      this.state.votes = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    const maxVotes = Math.max(...voteCounts.values());
    const topPlayers = [...voteCounts.entries()].filter(([, count]) => count === maxVotes);

    if (topPlayers.length > 1) {
      // 平票 → 进入PK
      this.state.pkCandidates = topPlayers.map(([id]) => id);
      this.addEvent(GamePhase.VOTE_RESULT, {
        result: 'tie',
        votes: [...this.state.votes],
        pkCandidates: [...this.state.pkCandidates],
      });
      this.state.votes = [];
      this.transitionTo(GamePhase.PK_SPEECH);
      return;
    }

    this.exilePlayer(topPlayers[0][0]);
  }

  private resolvePKVotes(): void {
    const voteCounts = new Map<string, number>();
    for (const vote of this.state.votes) {
      if (vote.targetId) {
        voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
      }
    }

    if (voteCounts.size === 0) {
      // 全弃票→平安
      this.addEvent(GamePhase.VOTE_RESULT, { result: 'pk_no_exile' });
      this.state.votes = [];
      this.state.pkCandidates = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    const maxVotes = Math.max(...voteCounts.values());
    const topPlayers = [...voteCounts.entries()].filter(([, count]) => count === maxVotes);

    if (topPlayers.length > 1) {
      // 再次平票 → 平安日
      this.addEvent(GamePhase.VOTE_RESULT, { result: 'pk_tie_safe', votes: [...this.state.votes] });
      this.state.votes = [];
      this.state.pkCandidates = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    this.state.pkCandidates = [];
    this.exilePlayer(topPlayers[0][0]);
  }

  private exilePlayer(exiledId: string): void {
    const exiled = this.state.players.find(p => p.id === exiledId);
    if (!exiled) return;

    // 白痴被投票放逐时翻牌免死
    if (exiled.role === RoleName.FOOL && !exiled.foolRevealed) {
      exiled.foolRevealed = true;
      this.addEvent(GamePhase.VOTE_RESULT, {
        result: 'fool_revealed',
        exiledId,
        votes: [...this.state.votes],
      });
      this.state.votes = [];
      this.state.phase = GamePhase.VOTE_RESULT;
      this.advancePhase();
      return;
    }

    exiled.alive = false;
    this.state.deaths.push(exiledId);

    if (exiled.role === RoleName.HUNTER) {
      this.state.hunterCanShoot = true;
    }

    this.addEvent(GamePhase.VOTE_RESULT, {
      result: 'exiled',
      exiledId,
      votes: [...this.state.votes],
    });

    this.state.votes = [];

    if (this.state.hunterCanShoot) {
      this.state.phase = GamePhase.HUNTER_SHOOT;
      this.setPhaseDeadline();
      return;
    }

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

    if (aliveWerewolves.length === 0) {
      return Team.VILLAGER;
    }
    if (aliveVillagers.length === 0) {
      return Team.WEREWOLF;
    }
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

export function getDefaultConfig(totalPlayers: number): Record<RoleName, number> {
  if (PRESET_CONFIGS[totalPlayers]) {
    return { ...PRESET_CONFIGS[totalPlayers] };
  }

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
    [RoleName.FOOL]: gods >= 5 ? 1 : 0,
  };

  const assignedGods = config[RoleName.SEER] + config[RoleName.WITCH] +
    config[RoleName.HUNTER] + config[RoleName.GUARD] + config[RoleName.FOOL];
  config[RoleName.VILLAGER] += (gods - assignedGods);

  return config;
}
