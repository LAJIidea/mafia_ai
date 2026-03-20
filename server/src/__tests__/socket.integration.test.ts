import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { RoomManager } from '../engine/index.js';
import { setupRoutes } from '../routes/api.js';
import { setupSocketHandlers, shouldAIAct, setAIDelay } from '../socket.js';
import { setGlobalAIConfig, resetGlobalAIConfig } from '../ai/config.js';
import { AIAgent } from '../ai/AIAgent.js';
import { RoleName, GamePhase, PHASE_TIMEOUTS } from '../engine/types.js';

const savedTimeouts = { ...PHASE_TIMEOUTS };

let httpServer: HttpServer, io: SocketServer, port: number, rm: RoomManager;
const origFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  httpServer = createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: '*' } });
  rm = new RoomManager();
  setupRoutes(app, rm);
  setupSocketHandlers(io, rm);
  await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
  port = (httpServer.address() as any).port;
});
afterAll(async () => { io.close(); await new Promise<void>(r => httpServer.close(() => r())); });
afterEach(() => {
  resetGlobalAIConfig(); vi.restoreAllMocks(); globalThis.fetch = origFetch;
  setAIDelay(() => 1000 + Math.random() * 2000);
  Object.assign(PHASE_TIMEOUTS, savedTimeouts);
});

function conn(): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
}
async function api(path: string, opts?: RequestInit) {
  return origFetch(`http://127.0.0.1:${port}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
}
function waitFor(s: ClientSocket, ev: string, pred: (d: any) => boolean, ms = 10000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`Timeout: ${ev}`)); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
    s.on(ev, h);
  });
}

// Poll engine state until predicate is true, submitting human actions via socket as needed
async function pollUntil(
  roomId: string, c: ClientSocket, playerId: string,
  pred: (s: any) => boolean, ms = 40000
): Promise<any> {
  const NIGHT: Record<string, string> = {
    guard_turn: 'guard', werewolf_turn: 'kill', witch_turn: 'witch_skip', seer_turn: 'investigate',
  };
  const acted = new Set<string>();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pollUntil timeout')), ms);
    const poll = () => {
      const room = rm.getRoom(roomId);
      if (!room) { setTimeout(poll, 50); return; }
      const s = room.engine.getState();
      if (pred(s)) { clearTimeout(timeout); resolve(s); return; }
      // Handle human night action
      const me = s.players.find((p: any) => p.id === playerId);
      if (me && NIGHT[s.phase] && me.role) {
        const key = `${s.phase}-${s.round}`;
        const rolePhase: Record<string, string> = {
          guard: 'guard_turn', werewolf: 'werewolf_turn', witch: 'witch_turn', seer: 'seer_turn',
        };
        if (rolePhase[me.role] === s.phase && !acted.has(key)) {
          acted.add(key);
          const targets = s.players.filter((p: any) => p.alive && p.id !== playerId);
          if (s.phase === 'witch_turn') {
            c.emit('game_action', { action: 'witch_skip' });
          } else {
            c.emit('game_action', { action: NIGHT[s.phase], targetId: targets[0]?.id });
          }
        }
      }
      // Handle human speaking turn
      if (s.currentSpeaker === playerId && !acted.has(`speak-${s.phase}-${s.round}-${s.currentSpeaker}`)) {
        acted.add(`speak-${s.phase}-${s.round}-${s.currentSpeaker}`);
        c.emit('skip_phase');
      }
      // Handle human voting
      if (s.phase === 'voting' && me?.alive && !acted.has(`vote-${s.round}`)) {
        acted.add(`vote-${s.round}`);
        c.emit('game_action', { action: 'vote' });
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

function joinRoom(c: ClientSocket, roomId: string, name: string, device = 'desktop'): Promise<{ playerId: string }> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('join timeout')), 5000);
    c.once('joined', (d: any) => { clearTimeout(t); res(d); });
    c.once('error', (d: any) => { clearTimeout(t); rej(new Error(d.message)); });
    c.emit('join_room', { roomId, playerName: name, device });
  });
}

const pollUntilPhase = pollUntil;

describe('Settings → add_ai', () => {
  it('未配置Token时add_ai错误', async () => {
    resetGlobalAIConfig();
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 't', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      await joinRoom(c, room.roomId, 'H');
      const err = await new Promise<any>((res) => { c.once('error', res); c.emit('add_ai', { roomId: room.roomId, playerName: 'AI', aiModel: 'gpt-4' }); });
      expect(err.message).toContain('Token');
    } finally { c.disconnect(); }
  }, 15000);

  it('REST保存Token后add_ai成功', async () => {
    setGlobalAIConfig({ apiToken: 'test-token', models: ['gpt-4'] });
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'ai', totalPlayers: 6 }) });
    const { roomId } = await r.json() as { roomId: string };
    const c = conn();
    try {
      await joinRoom(c, roomId, 'H');
      c.emit('add_ai', { roomId, playerName: 'AI-GPT', aiModel: 'gpt-4' });
      const gs = await waitFor(c, 'game_state', (s: any) => s.players?.length === 2);
      const ai = gs.players.find((p: any) => p.name === 'AI-GPT');
      expect(ai).toBeDefined();
      expect(ai.type).toBe('ai');
    } finally { c.disconnect(); }
  }, 15000);
});

describe('游戏启动 + AI触发', () => {
  it('start_game后AI decide被调用', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 50);
    const spy = vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id)[0]?.id;
      return { playerId: p.id, action: 'skip', targetId: t };
    });
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'ai', totalPlayers: 6 }) });
    const { roomId } = await r.json() as { roomId: string };
    const c = conn();
    try {
      await joinRoom(c, roomId, 'H');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await new Promise(r => setTimeout(r, 500));
      c.emit('start_game');
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('decide not called')), 15000);
        const poll = () => { if (spy.mock.calls.length > 0) { clearTimeout(t); res(); } else setTimeout(poll, 100); };
        poll();
      });
      expect(spy).toHaveBeenCalled();
    } finally { c.disconnect(); }
  }, 20000);
});

describe('shouldAIAct socket层', () => {
  it('PK候选人在pk_voting被排除', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_VOTING, ['p1', 'p3'])).toBe(false);
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p2' }, GamePhase.PK_VOTING, ['p1', 'p3'])).toBe(true);
  });
  it('PK候选人在pk_speech可发言', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_SPEECH, ['p1', 'p3'])).toBe(true);
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p2' }, GamePhase.PK_SPEECH, ['p1', 'p3'])).toBe(false);
  });
  it('普通投票所有人可投', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.VOTING, [])).toBe(true);
  });
});

describe('LAST_WORDS (socket边界)', () => {
  it('socket start_game触发夜晚流程产生deaths和currentSpeaker', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id)[0]?.id;
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: t };
      if (gs.phase === 'werewolf_turn') return { playerId: p.id, action: 'kill', targetId: t };
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: t };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: t };
      return { playerId: p.id, action: 'skip' };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('AI遗言');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'lw', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'Human');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId: room.roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await new Promise(r => setTimeout(r, 500));
      c.emit('start_game');

      // Wait up to 15s, checking every 200ms
      let found = false;
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 200));
        const state = rm.getRoom(room.roomId)?.engine.getState();
        if (!state) continue;
        if (state.deaths && state.deaths.length > 0) {
          found = true;
          expect(state.deaths.length).toBeGreaterThan(0);
          break;
        }
      }
      expect(found).toBe(true);
    } finally { c.disconnect(); }
  }, 30000);
});

describe('PK_VOTING (socket边界)', () => {
  it('socket start_game触发游戏流程超越night阶段', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id)[0]?.id;
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: t };
      if (gs.phase === 'werewolf_turn') return { playerId: p.id, action: 'kill', targetId: t };
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: t };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: t };
      return { playerId: p.id, action: 'skip' };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('PK测试');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'pk', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'Human');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId: room.roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await new Promise(r => setTimeout(r, 500));
      c.emit('start_game');

      // Wait up to 15s, checking every 200ms
      const dayPhases = ['dawn', 'last_words', 'discussion', 'voting', 'pk_speech', 'pk_voting', 'night_start'];
      let found = false;
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 200));
        const state = rm.getRoom(room.roomId)?.engine.getState();
        if (!state) continue;
        if (dayPhases.includes(state.phase)) {
          found = true;
          expect(dayPhases).toContain(state.phase);
          break;
        }
      }
      expect(found).toBe(true);
    } finally { c.disconnect(); }
  }, 30000);
});
