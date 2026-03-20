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

let httpServer: HttpServer, io: SocketServer, port: number, rm: RoomManager;
const origFetch = globalThis.fetch;
const savedTimeouts = { ...PHASE_TIMEOUTS };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  httpServer = createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: '*' } });
  rm = new RoomManager();
  setupRoutes(app, rm);
  setupSocketHandlers(io, rm);
  await new Promise<void>(r => httpServer.listen(0, r));
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
function waitFor(s: ClientSocket, ev: string, pred: (d: any) => boolean, ms = 10000): Promise<any> {
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
async function api(path: string, opts?: RequestInit) {
  return origFetch(`http://127.0.0.1:${port}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
}
function mockFetchForOpenRouter() {
  globalThis.fetch = vi.fn(async (url: any, init?: any) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), { status: 200 });
    }
    return origFetch(url, init);
  }) as any;
}
function pollUntil(roomId: string, pred: (s: any) => boolean, ms = 20000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('pollEngine timeout')), ms);
    const poll = () => {
      const s = rm.getRoom(roomId)?.engine.getState();
      if (s && pred(s)) { clearTimeout(t); res(s); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe('Settings → add_ai (API驱动)', () => {
  it('POST /api/ai/config写入 + GET回读 + add_ai成功', async () => {
    // Mock fetch for OpenRouter token validation
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 'm' }] }) }) as any;

    // 1. POST save config
    const postRes = await api('/api/ai/config', {
      method: 'POST', body: JSON.stringify({ apiToken: 'test-token', models: ['gpt-4'] }),
    });
    expect(postRes.status).toBe(200);

    // 2. GET verify configured
    const getRes = await api('/api/ai/config');
    const cfg = await getRes.json() as any;
    expect(cfg.configured).toBe(true);

    // 3. Socket add_ai succeeds
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'cfg', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'H');
      const aiP = waitFor(c, 'game_state', (s: any) => s.players?.some((p: any) => p.type === 'ai'));
      c.emit('add_ai', { roomId: room.roomId, playerName: 'AI-1', aiModel: 'gpt-4' });
      const gs = await aiP;
      const ai = gs.players.find((p: any) => p.type === 'ai');
      expect(ai).toBeDefined();
      expect(ai.type).toBe('ai');
    } finally { c.disconnect(); }
  }, 15000);

  it('未配置Token时add_ai返回错误', async () => {
    resetGlobalAIConfig();
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'no-cfg', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      await joinRoom(c, room.roomId, 'H');
      const errP = waitFor(c, 'error', () => true);
      c.emit('add_ai', { roomId: room.roomId, playerName: 'AI', aiModel: 'gpt-4' });
      const err = await errP;
      expect(err.message).toBeDefined();
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
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('test');
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'ai', totalPlayers: 6 }) });
    const { roomId } = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, roomId, 'H');
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
  it('死亡AI成为currentSpeaker并产生chat_message', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    PHASE_TIMEOUTS['dawn'] = 200;
    PHASE_TIMEOUTS['night_start'] = 200;
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const t = gs.players.filter((x: any) => x.alive && x.id !== p.id)[0]?.id;
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: t };
      if (gs.phase === 'werewolf_turn') {
        const aiTargets = gs.players.filter((x: any) => x.alive && x.id !== p.id && x.type === 'ai');
        return { playerId: p.id, action: 'kill', targetId: aiTargets[0]?.id };
      }
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: t };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: t };
      return { playerId: p.id, action: 'skip' };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('AI遗言测试');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'lw', totalPlayers: 6 }) });
    const room = await r.json() as { roomId: string };
    const c = conn();
    try {
      const j = await joinRoom(c, room.roomId, 'Human');
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId: room.roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await new Promise(r => setTimeout(r, 300));

      // Collect chat_message events
      const chatMessages: any[] = [];
      c.on('chat_message', (m: any) => chatMessages.push(m));

      c.emit('start_game');

      // Poll engine until last_words
      const lwState = await pollUntil(room.roomId,
        (s: any) => s.phase === 'last_words', 20000);

      // Hard assertions
      expect(lwState.deaths.length).toBeGreaterThan(0);
      expect(lwState.currentSpeaker).toBeDefined();
      expect(lwState.deaths).toContain(lwState.currentSpeaker);
      // currentSpeaker should be AI (not the human)
      const deadPlayer = lwState.players.find((p: any) => p.id === lwState.currentSpeaker);
      expect(deadPlayer.type).toBe('ai');

      // Wait for chat_message from dead AI
      await new Promise(r => setTimeout(r, 1000));
      const aiChat = chatMessages.find((m: any) => m.playerId === lwState.currentSpeaker);
      expect(aiChat).toBeDefined();
      expect(aiChat.message).toBe('AI遗言测试');
      expect(aiChat.aiModel).toBeDefined();
    } finally { c.disconnect(); }
  }, 30000);
});

describe('PK_VOTING (socket边界)', () => {
  it('socket触发游戏到voting阶段', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 10);
    Object.keys(PHASE_TIMEOUTS).forEach(k => { PHASE_TIMEOUTS[k] = 200; });
    PHASE_TIMEOUTS['dawn'] = 200;
    PHASE_TIMEOUTS['night_start'] = 200;
    vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const alive = gs.players.filter((x: any) => x.alive && x.id !== p.id);
      if (gs.phase === 'werewolf_turn') {
        const aiTargets = gs.players.filter((x: any) => x.alive && x.id !== p.id && x.type === 'ai');
        return { playerId: p.id, action: 'kill', targetId: aiTargets[0]?.id };
      }
      if (gs.phase === 'guard_turn') return { playerId: p.id, action: 'guard', targetId: alive[0]?.id };
      if (gs.phase === 'witch_turn') return { playerId: p.id, action: 'witch_skip' };
      if (gs.phase === 'seer_turn') return { playerId: p.id, action: 'investigate', targetId: alive[0]?.id };
      if (gs.phase === 'voting') return { playerId: p.id, action: 'vote', targetId: alive[0]?.id };
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
      // Poll for voting or any post-night phase
      const state = await pollUntil(room.roomId,
        (s: any) => ['voting', 'pk_voting', 'pk_speech', 'vote_result'].includes(s.phase), 20000);

      expect(['voting', 'pk_voting', 'pk_speech', 'vote_result']).toContain(state.phase);
      // PK candidate exclusion is verified by shouldAIAct unit tests above
    } finally { c.disconnect(); }
  }, 25000);
});
