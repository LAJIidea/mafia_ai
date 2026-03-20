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
import { RoleName, GamePhase } from '../engine/types.js';

const NIGHT_ROLES: Record<string, string> = {
  guard_turn: 'guard', werewolf_turn: 'werewolf',
  witch_turn: 'witch', seer_turn: 'seer',
};
const NIGHT_ACTIONS: Record<string, string> = {
  guard: 'guard', werewolf: 'kill', seer: 'investigate', witch: 'witch_skip',
};

function waitFor(s: ClientSocket, ev: string, pred: (d: any) => boolean, ms = 30000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`Timeout: ${ev}`)); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
    s.on(ev, h);
  });
}

let httpServer: HttpServer, io: SocketServer, port: number, roomManager: RoomManager;
const origFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express(); app.use(express.json());
  httpServer = createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: '*' } });
  roomManager = new RoomManager();
  setupRoutes(app, roomManager);
  setupSocketHandlers(io, roomManager);
  await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
  port = (httpServer.address() as any).port;
});
afterAll(async () => { io.close(); await new Promise<void>(r => httpServer.close(() => r())); });
afterEach(() => { resetGlobalAIConfig(); vi.restoreAllMocks(); globalThis.fetch = origFetch; setAIDelay(() => 1000 + Math.random() * 2000); });

function conn(): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
}
async function api(path: string, opts?: RequestInit) {
  return origFetch(`http://127.0.0.1:${port}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
}

// Auto-play: human submits actions for all night phases + skips talk phases
function autoPlay(client: ClientSocket, myId: string) {
  const handled = new Set<string>();
  client.on('game_state', (gs: any) => {
    const key = `${gs.phase}-${gs.round}-${gs.currentSpeaker || ''}`;
    if (handled.has(key)) return;
    const me = gs.players?.find((p: any) => p.id === myId);
    if (!me) return;
    const neededRole = NIGHT_ROLES[gs.phase];
    if (neededRole && me.role === neededRole) {
      handled.add(key);
      const others = gs.players.filter((p: any) => p.alive && p.id !== myId);
      const act = NIGHT_ACTIONS[me.role];
      if (act === 'witch_skip') {
        client.emit('game_action', { playerId: myId, action: 'witch_skip' });
      } else {
        client.emit('game_action', { playerId: myId, action: act, targetId: others[0]?.id });
      }
    }
    if ((gs.phase === 'discussion' || gs.phase === 'pk_speech' || gs.phase === 'last_words')
        && gs.currentSpeaker === myId) {
      handled.add(key);
      setTimeout(() => client.emit('skip_phase'), 200);
    }
    if (gs.phase === 'voting' && me.alive) {
      handled.add(key);
      setTimeout(() => client.emit('game_action', { playerId: myId, action: 'vote' }), 200);
    }
  });
}

describe('Settings → add_ai', () => {
  it('未配置Token时add_ai错误', async () => {
    resetGlobalAIConfig();
    const r = await api('/api/rooms', { method: 'POST',
      body: JSON.stringify({ name: 't', totalPlayers: 6 }) });
    const room = await r.json();
    const c = conn();
    try {
      c.emit('join_room', { roomId: room.roomId, playerName: 'H', device: 'desktop' });
      await waitFor(c, 'joined', () => true);
      const errP = waitFor(c, 'error', () => true, 5000);
      c.emit('add_ai', { roomId: room.roomId, playerName: 'AI', aiModel: 'gpt-4' });
      const err = await errP;
      expect(err.message).toContain('Token');
    } finally { c.disconnect(); }
  }, 15000);

  it('REST保存Token后add_ai成功', async () => {
    await api('/api/ai/config', { method: 'POST',
      body: JSON.stringify({ apiToken: 'tok123', models: ['gpt-4'] }) });
    const r = await api('/api/rooms', { method: 'POST',
      body: JSON.stringify({ name: 't2', totalPlayers: 6 }) });
    const room = await r.json();
    const c = conn();
    try {
      c.emit('join_room', { roomId: room.roomId, playerName: 'H', device: 'desktop' });
      await waitFor(c, 'joined', () => true);
      c.emit('add_ai', { roomId: room.roomId, playerName: 'AI-G', aiModel: 'gpt-4' });
      const gs = await waitFor(c, 'game_state', (s: any) =>
        s.players?.some((p: any) => p.name === 'AI-G'), 10000);
      const ai = gs.players.find((p: any) => p.name === 'AI-G');
      expect(ai).toBeDefined();
      expect(ai.type).toBe('ai');
    } finally { c.disconnect(); }
  }, 15000);
});

describe('游戏启动 + AI触发链路', () => {
  it('start_game后AI的decide被调用', async () => {
    setGlobalAIConfig({ apiToken: 'test', models: ['m'] });
    setAIDelay(() => 50);
    const decideSpy = vi.spyOn(AIAgent.prototype, 'decide').mockImplementation(async (p: any, gs: any) => {
      const alive = gs.players.filter((x: any) => x.alive && x.id !== p.id);
      return { playerId: p.id, action: 'guard', targetId: alive[0]?.id };
    });
    vi.spyOn(AIAgent.prototype, 'generateSpeech').mockResolvedValue('test');

    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'ai', totalPlayers: 6 }) });
    const { roomId } = await r.json();
    const c = conn();
    try {
      c.emit('join_room', { roomId, playerName: 'Human', device: 'desktop' });
      await waitFor(c, 'joined', () => true);
      for (let i = 0; i < 5; i++) c.emit('add_ai', { roomId, playerName: `AI${i}`, aiModel: 'gpt-4' });
      await new Promise(r => setTimeout(r, 500));
      c.emit('start_game');
      // Wait for at least one phase change (AI acted)
      await waitFor(c, 'game_state', (s: any) => s.phase && s.phase !== 'waiting', 10000);
      // Wait for AI decide to fire (async with 50ms delay)
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('decide not called')), 15000);
        const poll = () => {
          if (decideSpy.mock.calls.length > 0) { clearTimeout(t); res(); }
          else setTimeout(poll, 100);
        };
        poll();
      });
      expect(decideSpy).toHaveBeenCalled();
    } finally { c.disconnect(); }
  }, 20000);
});

describe('shouldAIAct socket层逻辑', () => {
  it('PK候选人在pk_voting阶段被排除', () => {
    const candidate = { role: RoleName.VILLAGER, id: 'p1' };
    const nonCandidate = { role: RoleName.VILLAGER, id: 'p2' };
    const pkCandidates = ['p1', 'p3'];

    // Candidate should NOT act in pk_voting
    expect(shouldAIAct(candidate, GamePhase.PK_VOTING, pkCandidates)).toBe(false);
    // Non-candidate SHOULD act in pk_voting
    expect(shouldAIAct(nonCandidate, GamePhase.PK_VOTING, pkCandidates)).toBe(true);
  });

  it('PK候选人在pk_speech阶段可以发言', () => {
    const candidate = { role: RoleName.VILLAGER, id: 'p1' };
    const nonCandidate = { role: RoleName.VILLAGER, id: 'p2' };
    const pkCandidates = ['p1', 'p3'];

    // Candidate SHOULD speak in pk_speech
    expect(shouldAIAct(candidate, GamePhase.PK_SPEECH, pkCandidates)).toBe(true);
    // Non-candidate should NOT speak in pk_speech
    expect(shouldAIAct(nonCandidate, GamePhase.PK_SPEECH, pkCandidates)).toBe(false);
  });

  it('普通投票阶段所有人都可以投票', () => {
    const player = { role: RoleName.VILLAGER, id: 'p1' };
    expect(shouldAIAct(player, GamePhase.VOTING, [])).toBe(true);
  });
});
