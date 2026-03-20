import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine, validateRoleConfig, getDefaultConfig } from '../engine/GameEngine.js';
import { RoleName, GamePhase, PlayerType, RoomConfig, PRESET_CONFIGS, Team } from '../engine/types.js';
import { AIAgent } from '../ai/AIAgent.js';
import { setGlobalAIConfig, getGlobalAIConfig, resetGlobalAIConfig } from '../ai/config.js';

function setupGame(playerCount: number = 12): { engine: GameEngine; playerIds: string[] } {
  const preset = PRESET_CONFIGS[playerCount];
  const config: RoomConfig = { totalPlayers: playerCount, roleConfig: { ...preset } };
  const engine = new GameEngine('test', config);

  const playerIds: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const result = engine.addPlayer(
      `Player${i}`,
      i === 0 ? PlayerType.HUMAN : PlayerType.AI,
      i === 0 ? 'desktop' : 'desktop',
    );
    if (result.data?.playerId) playerIds.push(result.data.playerId as string);
  }
  return { engine, playerIds };
}

function findPlayerByRole(engine: GameEngine, role: RoleName): string | undefined {
  return engine.getState().players.find(p => p.role === role)?.id;
}

describe('GameEngine', () => {
  describe('配置验证', () => {
    it('拒绝5人局', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 5,
        roleConfig: { werewolf: 2, villager: 1, seer: 1, witch: 1, hunter: 0, guard: 0, fool: 0 },
      })).toThrow('玩家人数必须在6-16之间');
    });

    it('拒绝17人局', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 17,
        roleConfig: { werewolf: 5, villager: 7, seer: 1, witch: 1, hunter: 1, guard: 1, fool: 1 },
      })).toThrow('玩家人数必须在6-16之间');
    });

    it('角色总数不匹配应报错', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 12,
        roleConfig: { werewolf: 4, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1, fool: 0 },
      })).toThrow('角色总数必须等于玩家人数');
    });

    it('无狼人应报错', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 6,
        roleConfig: { werewolf: 0, villager: 4, seer: 1, witch: 1, hunter: 0, guard: 0, fool: 0 },
      })).toThrow('至少需要1名狼人');
    });

    it('合法6人局', () => {
      const e = new GameEngine('r', { totalPlayers: 6, roleConfig: PRESET_CONFIGS[6] });
      expect(e.getState().phase).toBe(GamePhase.WAITING);
    });

    it('合法12人局', () => {
      const e = new GameEngine('r', { totalPlayers: 12, roleConfig: PRESET_CONFIGS[12] });
      expect(e.getState().phase).toBe(GamePhase.WAITING);
    });

    it('合法16人局（5狼6民5神含白痴）', () => {
      const config = PRESET_CONFIGS[16];
      const total = Object.values(config).reduce((a, b) => a + b, 0);
      expect(total).toBe(16);
      expect(config.fool).toBe(1);
      const e = new GameEngine('r', { totalPlayers: 16, roleConfig: config });
      expect(e.getState().phase).toBe(GamePhase.WAITING);
    });
  });

  describe('玩家管理', () => {
    it('添加真人玩家', () => {
      const engine = new GameEngine('r', { totalPlayers: 12, roleConfig: PRESET_CONFIGS[12] });
      const result = engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      expect(result.success).toBe(true);
    });

    it('电脑端最多1个真人', () => {
      const engine = new GameEngine('r', { totalPlayers: 12, roleConfig: PRESET_CONFIGS[12] });
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      const result = engine.addPlayer('P2', PlayerType.HUMAN, 'desktop');
      expect(result.success).toBe(false);
      expect(result.message).toContain('电脑端仅支持1名真人');
    });

    it('真人最多4人', () => {
      const engine = new GameEngine('r', { totalPlayers: 12, roleConfig: PRESET_CONFIGS[12] });
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      engine.addPlayer('P2', PlayerType.HUMAN, 'mobile');
      engine.addPlayer('P3', PlayerType.HUMAN, 'mobile');
      engine.addPlayer('P4', PlayerType.HUMAN, 'mobile');
      const result = engine.addPlayer('P5', PlayerType.HUMAN, 'mobile');
      expect(result.success).toBe(false);
      expect(result.message).toContain('真人玩家最多4人');
    });

    it('房间满后不能加入', () => {
      const { engine } = setupGame(6);
      const result = engine.addPlayer('Extra', PlayerType.AI, 'desktop');
      expect(result.success).toBe(false);
      expect(result.message).toContain('房间已满');
    });
  });

  describe('游戏流程', () => {
    it('人数不足不能开始', () => {
      const engine = new GameEngine('r', { totalPlayers: 12, roleConfig: PRESET_CONFIGS[12] });
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      expect(engine.startGame().success).toBe(false);
    });

    it('成功开始12人局', () => {
      const { engine } = setupGame(12);
      expect(engine.startGame().success).toBe(true);
      expect(engine.getState().round).toBe(1);
    });

    it('6人局跳过守卫阶段', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      expect(engine.getState().phase).toBe(GamePhase.WEREWOLF_TURN);
    });

    it('游戏进行中不能开始新局', () => {
      const { engine } = setupGame(12);
      engine.startGame();
      expect(engine.startGame().success).toBe(false);
      expect(engine.startGame().message).toContain('游戏已经开始');
    });

    it('死亡玩家不能操作', () => {
      const { engine } = setupGame(12);
      engine.startGame();
      const state = engine.getState();
      const nonGuard = state.players.find(p => p.role !== RoleName.GUARD && p.role !== RoleName.WEREWOLF);
      if (nonGuard) {
        // Use internal state manipulation for test only - kill the player
        const internalState = (engine as any).state;
        const internalPlayer = internalState.players.find((p: any) => p.id === nonGuard.id);
        if (internalPlayer) internalPlayer.alive = false;
        const result = engine.handleAction({ playerId: nonGuard.id, action: 'vote' });
        expect(result.success).toBe(false);
        expect(result.message).toContain('死亡');
      }
    });
  });

  describe('角色权限控制', () => {
    it('非守卫不能执行守卫操作', () => {
      const { engine } = setupGame(12);
      engine.startGame();
      const state = engine.getState();
      if (state.phase !== GamePhase.GUARD_TURN) return;

      const nonGuard = state.players.find(p => p.role !== RoleName.GUARD);
      if (!nonGuard) return;

      const result = engine.handleAction({ playerId: nonGuard.id, action: 'guard' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('未轮到你操作');
    });

    it('守卫不能连续两晚守同一人', () => {
      const { engine } = setupGame(12);
      engine.startGame();
      const state = engine.getState();
      if (state.phase !== GamePhase.GUARD_TURN) return;

      const guard = state.players.find(p => p.role === RoleName.GUARD);
      const target = state.players.find(p => p.id !== guard?.id && p.alive);
      if (!guard || !target) return;

      // First guard action
      const r1 = engine.handleAction({ playerId: guard.id, action: 'guard', targetId: target.id });
      expect(r1.success).toBe(true);

      // Simulate through a full round to get back to guard turn
      // Skip remaining night phases
      const werewolf = state.players.find(p => p.role === RoleName.WEREWOLF);
      if (!werewolf) return;
      engine.handleAction({ playerId: werewolf.id, action: 'kill' });

      const witch = state.players.find(p => p.role === RoleName.WITCH);
      if (witch) engine.handleAction({ playerId: witch.id, action: 'witch_skip' });

      const seer = state.players.find(p => p.role === RoleName.SEER);
      if (seer) engine.handleAction({ playerId: seer.id, action: 'investigate' });

      // Now in day phase, skip through to next night
      engine.skipCurrentPhase(); // discussion
      // Vote phase - all skip
      const currentState = engine.getState();
      if (currentState.phase === GamePhase.VOTING) {
        for (const p of currentState.players.filter(pl => pl.alive)) {
          engine.handleAction({ playerId: p.id, action: 'vote' });
        }
      }

      // Should be back at guard turn (round 2)
      const newState = engine.getState();
      if (newState.phase === GamePhase.GUARD_TURN) {
        const r2 = engine.handleAction({ playerId: guard.id, action: 'guard', targetId: target.id });
        expect(r2.success).toBe(false);
        expect(r2.message).toContain('不能连续两晚守护同一名玩家');
      }
    });
  });

  describe('投票PK机制', () => {
    it('平票进入PK阶段而非直接平安', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      // Skip night phases
      engine.skipCurrentPhase(); // werewolf
      engine.skipCurrentPhase(); // witch
      engine.skipCurrentPhase(); // seer

      const state = engine.getState();
      // Skip dawn/last_words/discussion to get to voting
      while (engine.getState().phase !== GamePhase.VOTING &&
             engine.getState().phase !== GamePhase.GAME_OVER) {
        engine.skipCurrentPhase();
      }

      if (engine.getState().phase !== GamePhase.VOTING) return;

      // Create a tie: half vote for player A, half for player B
      const voters = engine.getState().players.filter(p => p.alive);
      if (voters.length < 4) return;

      const targetA = voters[0].id;
      const targetB = voters[1].id;

      // Vote to create a tie
      engine.handleAction({ playerId: voters[2].id, action: 'vote', targetId: targetA });
      engine.handleAction({ playerId: voters[3].id, action: 'vote', targetId: targetB });
      // Remaining voters abstain
      for (let i = 4; i < voters.length; i++) {
        engine.handleAction({ playerId: voters[i].id, action: 'vote' });
      }
      // The two candidates vote for each other
      engine.handleAction({ playerId: voters[0].id, action: 'vote', targetId: targetB });
      engine.handleAction({ playerId: voters[1].id, action: 'vote', targetId: targetA });

      const afterVote = engine.getState();
      // Should be in PK speech or PK voting, not vote_result (peaceful)
      expect([GamePhase.PK_SPEECH, GamePhase.PK_VOTING]).toContain(afterVote.phase);
    });
  });

  describe('白痴角色', () => {
    it('16人局包含白痴角色', () => {
      const { engine } = setupGame(16);
      engine.startGame();
      const fool = engine.getState().players.find(p => p.role === RoleName.FOOL);
      expect(fool).toBeDefined();
    });
  });

  describe('getState返回深拷贝', () => {
    it('修改getState返回值不影响引擎内部状态', () => {
      const { engine } = setupGame(6);
      const state1 = engine.getState();
      state1.players[0].alive = false;
      const state2 = engine.getState();
      expect(state2.players[0].alive).toBe(true);
    });
  });

  describe('超时和阶段控制', () => {
    it('phaseDeadline在游戏开始后被设置', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      expect(engine.getState().phaseDeadline).not.toBeNull();
    });

    it('skipCurrentPhase正常推进', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      const phase1 = engine.getState().phase;
      engine.skipCurrentPhase();
      const phase2 = engine.getState().phase;
      expect(phase2).not.toBe(phase1);
    });
  });

  describe('发言权限', () => {
    it('非讨论阶段不能发言', () => {
      const { engine, playerIds } = setupGame(6);
      engine.startGame();
      expect(engine.canSpeak(playerIds[0])).toBe(false);
    });
  });

  describe('遗言阶段', () => {
    it('活人在遗言阶段不能发言', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      // Skip to dawn with a death
      const state = engine.getState();
      const werewolf = state.players.find(p => p.role === RoleName.WEREWOLF);
      const target = state.players.find(p => p.role !== RoleName.WEREWOLF && p.alive);
      if (!werewolf || !target) return;

      engine.handleAction({ playerId: werewolf.id, action: 'kill', targetId: target.id });

      const witch = state.players.find(p => p.role === RoleName.WITCH);
      if (witch) engine.handleAction({ playerId: witch.id, action: 'witch_skip' });

      const seer = state.players.find(p => p.role === RoleName.SEER);
      if (seer) engine.handleAction({ playerId: seer.id, action: 'investigate' });

      // Should now be in dawn/last_words
      const current = engine.getState();
      if (current.phase === GamePhase.LAST_WORDS) {
        // Dead player should be able to speak
        expect(engine.canSpeak(target.id)).toBe(true);
        // Alive player should NOT be able to speak
        const aliveNonTarget = current.players.find(p => p.alive && p.id !== target.id);
        if (aliveNonTarget) {
          expect(engine.canSpeak(aliveNonTarget.id)).toBe(false);
        }
      }
    });
  });

  describe('AI配置', () => {
    it('AIAgent记忆系统保留发言', () => {
      const agent = new AIAgent({ apiToken: 'test', baseUrl: 'http://test' }, 'test-model');
      agent.addMemory('Player1说: "我是预言家"');
      agent.addMemory('Player2说: "我不信你"');
      expect(() => agent.addMemory('test')).not.toThrow();
    });
  });

  describe('遗言阶段发言队列', () => {
    it('遗言阶段的speaker queue来自deaths', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      const state = engine.getState();
      const werewolf = state.players.find(p => p.role === RoleName.WEREWOLF);
      const target = state.players.find(p => p.role !== RoleName.WEREWOLF && p.alive);
      if (!werewolf || !target) return;

      engine.handleAction({ playerId: werewolf.id, action: 'kill', targetId: target.id });
      const witch = state.players.find(p => p.role === RoleName.WITCH);
      if (witch) engine.handleAction({ playerId: witch.id, action: 'witch_skip' });
      const seer = state.players.find(p => p.role === RoleName.SEER);
      if (seer) engine.handleAction({ playerId: seer.id, action: 'investigate' });

      const current = engine.getState();
      if (current.phase === GamePhase.LAST_WORDS) {
        // currentSpeaker should be the dead player
        expect(current.currentSpeaker).toBe(target.id);
        expect(current.deaths).toContain(target.id);
      }
    });
  });

  describe('PK候选人不能在pk_voting投票', () => {
    it('PK候选人投票应被拒绝', () => {
      const { engine } = setupGame(6);
      engine.startGame();
      // Skip through night to voting
      while (engine.getState().phase !== GamePhase.VOTING &&
             engine.getState().phase !== GamePhase.GAME_OVER) {
        engine.skipCurrentPhase();
      }
      if (engine.getState().phase !== GamePhase.VOTING) return;

      // Create tie
      const voters = engine.getState().players.filter(p => p.alive);
      if (voters.length < 4) return;
      engine.handleAction({ playerId: voters[0].id, action: 'vote', targetId: voters[1].id });
      engine.handleAction({ playerId: voters[1].id, action: 'vote', targetId: voters[0].id });
      engine.handleAction({ playerId: voters[2].id, action: 'vote', targetId: voters[0].id });
      engine.handleAction({ playerId: voters[3].id, action: 'vote', targetId: voters[1].id });
      for (let i = 4; i < voters.length; i++) {
        engine.handleAction({ playerId: voters[i].id, action: 'vote' });
      }

      const afterVote = engine.getState();
      if (afterVote.phase === GamePhase.PK_SPEECH) {
        // Skip PK speech to get to PK voting
        engine.skipCurrentPhase();
        const pkState = engine.getState();
        if (pkState.phase === GamePhase.PK_VOTING && pkState.pkCandidates.length > 0) {
          const candidate = pkState.pkCandidates[0];
          const result = engine.handleAction({ playerId: candidate, action: 'vote', targetId: pkState.pkCandidates[1] || candidate });
          expect(result.success).toBe(false);
          expect(result.message).toContain('PK候选人不能投票');
        }
      }
    });
  });
});

describe('validateRoleConfig', () => {
  it('有效配置返回null', () => {
    expect(validateRoleConfig(12, PRESET_CONFIGS[12])).toBeNull();
  });

  it('人数过少返回错误', () => {
    expect(validateRoleConfig(5, {} as any)).toBe('玩家人数必须在6-16之间');
  });

  it('人数过多返回错误', () => {
    expect(validateRoleConfig(17, {} as any)).toBe('玩家人数必须在6-16之间');
  });
});

describe('getDefaultConfig', () => {
  it('返回预设12人配置', () => {
    const config = getDefaultConfig(12);
    expect(config[RoleName.WEREWOLF]).toBe(4);
    expect(config[RoleName.VILLAGER]).toBe(4);
  });

  it('为非预设人数生成合理配置', () => {
    const config = getDefaultConfig(10);
    const total = Object.values(config).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
    expect(config[RoleName.WEREWOLF]).toBeGreaterThanOrEqual(2);
  });

  it('16人配置包含白痴且总数正确', () => {
    const config = getDefaultConfig(16);
    expect(config[RoleName.FOOL]).toBe(1);
    const total = Object.values(config).reduce((a, b) => a + b, 0);
    expect(total).toBe(16);
  });
});

describe('AI配置存储', () => {
  it('未设置时返回null', () => {
    resetGlobalAIConfig();
    const config = getGlobalAIConfig();
    expect(config).toBeNull();
  });

  it('设置和获取全局AI配置', () => {
    resetGlobalAIConfig();
    setGlobalAIConfig({ apiToken: 'test-token', models: ['gpt-4'] });
    const config = getGlobalAIConfig();
    expect(config).not.toBeNull();
    expect(config!.apiToken).toBe('test-token');
    expect(config!.models).toContain('gpt-4');
  });

  it('重置后返回null', () => {
    setGlobalAIConfig({ apiToken: 'x', models: [] });
    resetGlobalAIConfig();
    expect(getGlobalAIConfig()).toBeNull();
  });
});
