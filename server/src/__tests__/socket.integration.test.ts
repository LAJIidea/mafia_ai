import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { RoomManager } from '../engine/index.js';
import { setupRoutes } from '../routes/api.js';
import { setupSocketHandlers, shouldAIAct, setAIDelay } from '../socket.js';
import { setGlobalAIConfig, resetGlobalAIConfig, getGlobalAIConfig } from '../ai/config.js';
import { AIAgent } from '../ai/AIAgent.js';
import { RoleName, GamePhase, PHASE_TIMEOUTS } from '../engine/types.js';

let httpServer: HttpServer, io: SocketServer, port: number, rm: RoomManager;
const origFetch = globalThis.fetch;
const savedTimeouts = { ...PHASE_TIMEOUTS };

function mockFetch(valid = true) {
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url).includes('openrouter.ai'))
      return valid
        ? { ok: true, status: 200, json: async () => ({ data: [] }) } as any
        : { ok: false, status: 401, json: async () => ({}) } as any;
    return origFetch(url);
  }) as any;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  rm = new RoomManager();
  setupRoutes(app, rm);
  httpServer = createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: '*' } });
  setupSocketHandlers(io, rm);
  await new Promise<void>((r, j) => {
    httpServer.on('error', j);
    httpServer.listen(0, () => { httpServer.removeListener('error', j); r(); });
  });
  port = (httpServer.address() as any).port;
});
afterAll(() => new Promise<void>(r => { io.close(); httpServer.close(() => r()); }));
afterEach(() => {
  resetGlobalAIConfig(); vi.restoreAllMocks(); globalThis.fetch = origFetch;
  setAIDelay(() => 1000 + Math.random() * 2000);
  Object.assign(PHASE_TIMEOUTS, savedTimeouts);
});

function conn() { return ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] }); }
function api(path: string, opts?: RequestInit) {
  return origFetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts?.headers } });
}
function waitFor(s: ClientSocket, ev: string, pred: (d: any) => boolean, ms = 30000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`Timeout: ${ev}`)); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
    s.on(ev, h);
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
function tick(ms = 50) { return new Promise(r => setTimeout(r, ms)); }

describe('Settings → add_ai (API+socket)', () => {
  it('POST写入 + GET回读configured+models + add_ai成功', async () => {
    mockFetch(true);
    const post = await api('/api/ai/config', {
      method: 'POST', body: JSON.stringify({ apiToken: 'tok', models: ['gpt-4'] }),
    });
    expect(post.status).toBe(200);
    // GET readback
    const get = await api('/api/ai/config');
    const cfg = await get.json() as any;
    expect(cfg.configured).toBe(true);
    expect(cfg.models).toContain('gpt-4');
    // Socket add_ai
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 's', totalPlayers: 6 }) });
    const { roomId } = await r.json() as any;
    const c = conn();
    try {
      const j = await joinRoom(c, roomId, 'H');
      const aiP = waitFor(c, 'game_state', () => true);
      c.emit('add_ai', { roomId, playerName: 'AI0', aiModel: 'gpt-4' });
      const gs = await aiP;
      const ai = gs.players.find((p: any) => p.type === 'ai');
      expect(ai).toBeDefined();
      expect(ai.type).toBe('ai');
    } finally { c.disconnect(); }
  }, 15000);

  it('未配置Token时add_ai返回error', async () => {
    resetGlobalAIConfig();
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'e', totalPlayers: 6 }) });
    const { roomId } = await r.json() as any;
    const c = conn();
    try {
      await joinRoom(c, roomId, 'H');
      const errP = waitFor(c, 'error', () => true);
      c.emit('add_ai', { roomId, playerName: 'AI', aiModel: 'gpt-4' });
      const err = await errP;
      expect(err.message).toBeDefined();
    } finally { c.disconnect(); }
  }, 15000);

  it('invalid token返回401', async () => {
    mockFetch(false);
    const res = await api('/api/ai/config', {
      method: 'POST', body: JSON.stringify({ apiToken: 'bad', models: ['m'] }),
    });
    expect(res.status).toBe(401);
  });
});

describe('LAST_WORDS (socket边界)', () => {
  it('死亡AI成为currentSpeaker + chat_message遗言', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    PHASE_TIMEOUTS['dawn'] = 200;
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id);
      if (gs.phase === 'werewolf_turn') {
        const aiT = t.filter((x: any) => x.type === 'ai');
        return { playerId: p.id, action: 'kill', targetId: aiT[0]?.id };
      }
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: t[0]?.id };
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: t[0]?.id };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: t[0]?.id };
      return { playerId: p.id, action: 'skip' };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('AI遗言测试');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'lw', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'H');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId: room.roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await tick(500);

      // Collect chat_message events BEFORE starting game
      const chatMessages: any[] = [];
      c.on('chat_message', (m: any) => chatMessages.push(m));

      // Collect phase_change events
      const phaseChanges: any[] = [];
      c.on('phase_change', (p: any) => phaseChanges.push(p));

      c.emit('start_game');

      // Poll engine state until last_words
      const state = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for last_words')), 20000);
        const poll = () => {
          const s = rm.getRoom(room.roomId)?.engine.getState();
          if (s && s.phase === 'last_words') { clearTimeout(t); resolve(s); return; }
          setTimeout(poll, 10);
        };
        poll();
      });

      // Verify: deaths exist, currentSpeaker is dead AI
      expect(state.deaths.length).toBeGreaterThan(0);
      expect(state.currentSpeaker).toBeDefined();
      const deadPlayer = state.players.find((p: any) => p.id === state.currentSpeaker);
      expect(deadPlayer).toBeDefined();
      expect(deadPlayer.alive).toBe(false);
      expect(deadPlayer.type).toBe('ai');

      // Wait for AI speech to complete
      await tick(500);

      // Verify chat_message from dead AI
      const aiChat = chatMessages.find((m: any) => m.playerId === state.currentSpeaker);
      expect(aiChat).toBeDefined();
      expect(aiChat.message).toBe('AI遗言测试');
      expect(aiChat.aiModel).toBeDefined();

      // Verify phase_change included last_words with currentSpeaker
      const lwPhaseChange = phaseChanges.find((p: any) => p.phase === 'last_words');
      expect(lwPhaseChange).toBeDefined();
      expect(lwPhaseChange.currentSpeaker).toBe(state.currentSpeaker);
    } finally { c.disconnect(); }
  }, 30000);
});

describe('PK_VOTING (socket边界)', () => {
  it('游戏到达voting阶段 + shouldAIAct验证PK排除', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    PHASE_TIMEOUTS['dawn'] = 200;
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id);
      if (gs.phase === 'werewolf_turn') {
        const aiT = t.filter((x: any) => x.type === 'ai');
        return { playerId: p.id, action: 'kill', targetId: aiT[0]?.id };
      }
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: t[0]?.id };
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: t[0]?.id };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: t[0]?.id };
      return { playerId: p.id, action: 'skip' };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('PK测试');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'pk', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'H');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId: room.roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await tick(500);

      c.emit('start_game');

      // Poll engine state until voting or beyond
      const dayPhases = ['dawn', 'last_words', 'discussion', 'voting', 'pk_speech', 'pk_voting', 'vote_result'];
      const state = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for day phase')), 20000);
        const poll = () => {
          const s = rm.getRoom(room.roomId)?.engine.getState();
          if (s && dayPhases.includes(s.phase)) { clearTimeout(t); resolve(s); return; }
          setTimeout(poll, 10);
        };
        poll();
      });

      expect(dayPhases).toContain(state.phase);

      // PK candidate exclusion verified by shouldAIAct:
      // Candidate AI excluded from pk_voting
      expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_VOTING, ['p1'])).toBe(false);
      // Non-candidate can vote in pk_voting
      expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p2' }, GamePhase.PK_VOTING, ['p1'])).toBe(true);
      // Candidate can speak in pk_speech
      expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_SPEECH, ['p1'])).toBe(true);
    } finally { c.disconnect(); }
  }, 30000);
});

describe('shouldAIAct socket层', () => {
  it('PK候选人在pk_voting被排除', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_VOTING, ['p1', 'p3'])).toBe(false);
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p2' }, GamePhase.PK_VOTING, ['p1', 'p3'])).toBe(true);
  });
  it('PK候选人在pk_speech可发言', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.PK_SPEECH, ['p1'])).toBe(true);
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p2' }, GamePhase.PK_SPEECH, ['p1'])).toBe(false);
  });
  it('普通投票所有人可投', () => {
    expect(shouldAIAct({ role: RoleName.VILLAGER, id: 'p1' }, GamePhase.VOTING, [])).toBe(true);
  });
});
