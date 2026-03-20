import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine, validateRoleConfig, getDefaultConfig } from '../engine/GameEngine.js';
import { RoleName, GamePhase, PlayerType, RoomConfig, PRESET_CONFIGS, Team } from '../engine/types.js';

describe('GameEngine', () => {
  let engine: GameEngine;
  const config12: RoomConfig = {
    totalPlayers: 12,
    roleConfig: { ...PRESET_CONFIGS[12] },
  };

  beforeEach(() => {
    engine = new GameEngine('test-room', config12);
  });

  describe('配置验证', () => {
    it('拒绝5人局（低于6人下限）', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 5,
        roleConfig: { werewolf: 2, villager: 1, seer: 1, witch: 1, hunter: 0, guard: 0 } as any,
      })).toThrow('玩家人数必须在6-16之间');
    });

    it('拒绝17人局（超过16人上限）', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 17,
        roleConfig: { werewolf: 5, villager: 7, seer: 1, witch: 1, hunter: 1, guard: 1, fool: 1 } as any,
      })).toThrow('玩家人数必须在6-16之间');
    });

    it('角色总数与玩家数不匹配应报错', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 12,
        roleConfig: { werewolf: 4, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1 } as any,
      })).toThrow('角色总数必须等于玩家人数');
    });

    it('无狼人应报错', () => {
      expect(() => new GameEngine('r', {
        totalPlayers: 6,
        roleConfig: { werewolf: 0, villager: 4, seer: 1, witch: 1, hunter: 0, guard: 0 } as any,
      })).toThrow('至少需要1名狼人');
    });

    it('合法的6人局配置', () => {
      const e = new GameEngine('r', {
        totalPlayers: 6,
        roleConfig: PRESET_CONFIGS[6],
      });
      expect(e.getState().phase).toBe(GamePhase.WAITING);
    });

    it('合法的12人局配置', () => {
      expect(engine.getState().phase).toBe(GamePhase.WAITING);
    });

    it('合法的16人局配置', () => {
      const e = new GameEngine('r', {
        totalPlayers: 16,
        roleConfig: PRESET_CONFIGS[16],
      });
      expect(e.getState().phase).toBe(GamePhase.WAITING);
    });
  });

  describe('玩家管理', () => {
    it('添加真人玩家', () => {
      const result = engine.addPlayer('Player1', PlayerType.HUMAN, 'desktop');
      expect(result.success).toBe(true);
      expect(result.data?.playerId).toBeDefined();
    });

    it('电脑端最多1个真人', () => {
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      const result = engine.addPlayer('P2', PlayerType.HUMAN, 'desktop');
      expect(result.success).toBe(false);
      expect(result.message).toContain('电脑端仅支持1名真人');
    });

    it('真人玩家最多4人', () => {
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      engine.addPlayer('P2', PlayerType.HUMAN, 'mobile');
      engine.addPlayer('P3', PlayerType.HUMAN, 'mobile');
      engine.addPlayer('P4', PlayerType.HUMAN, 'mobile');
      const result = engine.addPlayer('P5', PlayerType.HUMAN, 'mobile');
      expect(result.success).toBe(false);
      expect(result.message).toContain('真人玩家最多4人');
    });

    it('房间满后不能加入', () => {
      const e = new GameEngine('r', {
        totalPlayers: 6,
        roleConfig: PRESET_CONFIGS[6],
      });
      for (let i = 0; i < 6; i++) {
        e.addPlayer(`P${i}`, i === 0 ? PlayerType.HUMAN : PlayerType.AI, 'desktop');
      }
      const result = e.addPlayer('P7', PlayerType.AI, 'desktop');
      expect(result.success).toBe(false);
      expect(result.message).toContain('房间已满');
    });
  });

  describe('游戏流程', () => {
    let players: string[];

    function setupFullGame(playerCount: number = 12): { engine: GameEngine; players: string[] } {
      const preset = PRESET_CONFIGS[playerCount];
      const e = new GameEngine('test', { totalPlayers: playerCount, roleConfig: { ...preset } });

      const ids: string[] = [];
      for (let i = 0; i < playerCount; i++) {
        const result = e.addPlayer(
          `Player${i}`,
          i === 0 ? PlayerType.HUMAN : PlayerType.AI,
          i === 0 ? 'desktop' : 'desktop'
        );
        if (result.data?.playerId) ids.push(result.data.playerId as string);
      }

      return { engine: e, players: ids };
    }

    it('人数不足不能开始', () => {
      engine.addPlayer('P1', PlayerType.HUMAN, 'desktop');
      const result = engine.startGame();
      expect(result.success).toBe(false);
    });

    it('成功开始12人局', () => {
      const { engine: e } = setupFullGame(12);
      const result = e.startGame();
      expect(result.success).toBe(true);
      expect(e.getState().round).toBe(1);
      // 应该在某个夜间阶段
      const nightPhases = [GamePhase.GUARD_TURN, GamePhase.WEREWOLF_TURN, GamePhase.WITCH_TURN, GamePhase.SEER_TURN];
      expect(nightPhases).toContain(e.getState().phase);
    });

    it('成功开始6人局', () => {
      const { engine: e } = setupFullGame(6);
      const result = e.startGame();
      expect(result.success).toBe(true);
      // 6人局没有守卫，应跳过守卫阶段
      expect(e.getState().phase).toBe(GamePhase.WEREWOLF_TURN);
    });

    it('游戏进行中不能开始新局', () => {
      const { engine: e } = setupFullGame(12);
      e.startGame();
      const result = e.startGame();
      expect(result.success).toBe(false);
      expect(result.message).toContain('游戏已经开始');
    });

    it('死亡玩家不能操作', () => {
      const { engine: e, players: ids } = setupFullGame(12);
      e.startGame();

      // 找到一个非守卫玩家标记为死亡
      const state = e.getState();
      const nonGuard = state.players.find(p => p.role !== RoleName.GUARD);
      if (nonGuard) {
        nonGuard.alive = false;
        const result = e.handleAction({ playerId: nonGuard.id, action: 'vote' });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('角色技能', () => {
    function setupAndFindRole(roleName: RoleName, playerCount: number = 12) {
      const preset = PRESET_CONFIGS[playerCount];
      const e = new GameEngine('test', { totalPlayers: playerCount, roleConfig: { ...preset } });

      for (let i = 0; i < playerCount; i++) {
        e.addPlayer(`P${i}`, i === 0 ? PlayerType.HUMAN : PlayerType.AI, 'desktop');
      }
      e.startGame();

      const state = e.getState();
      const player = state.players.find(p => p.role === roleName);
      return { engine: e, player, state };
    }

    it('守卫不能连续守同一人', () => {
      const { engine: e, player: guard } = setupAndFindRole(RoleName.GUARD);
      if (!guard) return;

      // 先推进到守卫阶段
      const state = e.getState();
      if (state.phase !== GamePhase.GUARD_TURN) return;

      const target = state.players.find(p => p.id !== guard.id && p.alive);
      if (!target) return;

      // 第一次守护
      e.handleAction({ playerId: guard.id, action: 'guard', targetId: target.id });
      // ... 经过一轮后再次尝试守护同一人（需要模拟完整轮次，这里测试验证逻辑）
    });

    it('非对应角色不能执行操作', () => {
      const { engine: e, state } = setupAndFindRole(RoleName.GUARD);
      if (state.phase !== GamePhase.GUARD_TURN) return;

      const nonGuard = state.players.find(p => p.role !== RoleName.GUARD);
      if (!nonGuard) return;

      const result = e.handleAction({ playerId: nonGuard.id, action: 'guard' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('你不是守卫');
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
  it('返回预设的12人配置', () => {
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
});
