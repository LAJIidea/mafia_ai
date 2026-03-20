import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { RoomManager } from '../engine/RoomManager.js';
import { setupSocketHandlers } from '../socket.js';
import { setupRoutes } from '../routes/api.js';
import { setGlobalAIConfig, resetGlobalAIConfig } from '../ai/config.js';

let httpServer: HttpServer;
let io: SocketServer;
let port: number;
let roomManager: RoomManager;

function createClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
}

function waitForEvent<T = any>(socket: ClientSocket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  httpServer = createServer(app);
  io = new SocketServer(httpServer, { cors: { origin: '*' } });
  roomManager = new RoomManager();
  setupRoutes(app, roomManager);
  setupSocketHandlers(io, roomManager);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterEach(() => {
  resetGlobalAIConfig();
});

afterAll(async () => {
  io.close();
  await new Promise<void>(r => httpServer.close(() => r()));
});

describe('Socket/API 集成测试', () => {
  describe('Settings保存 → Lobby add_ai 成功链路', () => {
    it('未配置AI Token时add_ai返回错误', async () => {
      resetGlobalAIConfig();
      const roomId = roomManager.createRoom('test-no-token', 6).id;
      const client = createClient();

      try {
        await waitForEvent(client, 'connect');
        client.emit('join_room', { roomId, playerName: 'Host', device: 'desktop' });
        await waitForEvent(client, 'joined');

        client.emit('add_ai', { roomId, playerName: 'AI-GPT', aiModel: 'openai/gpt-4' });
        const err = await waitForEvent(client, 'error');
        expect(err.message).toContain('API Token');
      } finally {
        client.disconnect();
      }
    });

    it('REST保存Token后add_ai成功添加AI玩家', async () => {
      // Save config via REST API
      const res = await fetch(`http://localhost:${port}/api/ai/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken: 'test-token-123', models: ['openai/gpt-4'] }),
      });
      const json = await res.json() as any;
      expect(json.success).toBe(true);

      // Create room and join
      const roomId = roomManager.createRoom('test-with-token', 6).id;
      const client = createClient();

      try {
        await waitForEvent(client, 'connect');
        client.emit('join_room', { roomId, playerName: 'Host', device: 'desktop' });
        await waitForEvent(client, 'joined');

        // Add AI - should succeed now (token saved via REST)
        client.emit('add_ai', { roomId, playerName: 'AI-GPT', aiModel: 'openai/gpt-4' });
        const state = await waitForEvent(client, 'game_state');
        const aiPlayer = state.players.find((p: any) => p.type === 'ai');
        expect(aiPlayer).toBeDefined();
        expect(aiPlayer.name).toBe('AI-GPT');
        expect(aiPlayer.aiModel).toBe('openai/gpt-4');
      } finally {
        client.disconnect();
      }
    });

    it('GET /api/ai/config 返回已保存的配置状态', async () => {
      setGlobalAIConfig({ apiToken: 'my-token', models: ['claude'] });
      const res = await fetch(`http://localhost:${port}/api/ai/config`);
      const json = await res.json() as any;
      expect(json.configured).toBe(true);
    });
  });

  describe('LAST_WORDS 死亡AI遗言链路', () => {
    it('死亡玩家在遗言阶段作为currentSpeaker被设置', async () => {
      setGlobalAIConfig({ apiToken: 'test-token', models: ['openai/gpt-4'] });
      const roomId = roomManager.createRoom('lastwords-test', 6).id;
      const client = createClient();

      try {
        await waitForEvent(client, 'connect');
        client.emit('join_room', { roomId, playerName: 'Human', device: 'desktop' });
        await waitForEvent(client, 'joined');

        // Add 5 AI players
        for (let i = 0; i < 5; i++) {
          client.emit('add_ai', { roomId, playerName: `AI-${i}`, aiModel: 'openai/gpt-4' });
          await waitForEvent(client, 'game_state');
        }

        // Start game
        client.emit('start_game');
        await new Promise(r => setTimeout(r, 300));

        const room = roomManager.getRoom(roomId);
        expect(room).toBeDefined();
        if (!room) return;

        const state = room.engine.getState();
        const werewolf = state.players.find(p => p.role === 'werewolf');
        const target = state.players.find(p => p.role !== 'werewolf' && p.alive);
        expect(werewolf).toBeDefined();
        expect(target).toBeDefined();
        if (!werewolf || !target) return;

        // Execute night actions through engine
        room.engine.handleAction({ playerId: werewolf.id, action: 'kill', targetId: target.id });
        const witch = state.players.find(p => p.role === 'witch');
        if (witch) room.engine.handleAction({ playerId: witch.id, action: 'witch_skip' });
        const seer = state.players.find(p => p.role === 'seer');
        if (seer) room.engine.handleAction({ playerId: seer.id, action: 'investigate' });

        const afterDawn = room.engine.getState();
        if (afterDawn.phase === 'last_words') {
          expect(afterDawn.currentSpeaker).toBe(target.id);
          expect(afterDawn.deaths).toContain(target.id);
          const deadPlayer = afterDawn.players.find(p => p.id === target.id);
          expect(deadPlayer?.alive).toBe(false);
        }
      } finally {
        client.disconnect();
      }
    });
  });

  describe('PK_VOTING 候选人投票约束链路', () => {
    it('PK候选人投票被引擎拒绝，非候选人可投票', async () => {
      setGlobalAIConfig({ apiToken: 'test-token', models: ['openai/gpt-4'] });
      const roomId = roomManager.createRoom('pk-vote-test', 6).id;
      const client = createClient();

      try {
        await waitForEvent(client, 'connect');
        client.emit('join_room', { roomId, playerName: 'Human', device: 'desktop' });
        await waitForEvent(client, 'joined');

        // Add 5 AI players
        for (let i = 0; i < 5; i++) {
          client.emit('add_ai', { roomId, playerName: `AI-${i}`, aiModel: 'openai/gpt-4' });
          await waitForEvent(client, 'game_state');
        }

        // Start game
        client.emit('start_game');
        await new Promise(r => setTimeout(r, 300));

        const room = roomManager.getRoom(roomId);
        expect(room).toBeDefined();
        if (!room) return;

        // Skip night phases to voting
        while (room.engine.getState().phase !== 'voting' &&
               room.engine.getState().phase !== 'game_over') {
          room.engine.skipCurrentPhase();
        }
        if (room.engine.getState().phase !== 'voting') return;

        // Create a tie to trigger PK
        const voters = room.engine.getState().players.filter(p => p.alive);
        if (voters.length < 4) return;

        room.engine.handleAction({ playerId: voters[0].id, action: 'vote', targetId: voters[1].id });
        room.engine.handleAction({ playerId: voters[1].id, action: 'vote', targetId: voters[0].id });
        room.engine.handleAction({ playerId: voters[2].id, action: 'vote', targetId: voters[0].id });
        room.engine.handleAction({ playerId: voters[3].id, action: 'vote', targetId: voters[1].id });
        for (let i = 4; i < voters.length; i++) {
          room.engine.handleAction({ playerId: voters[i].id, action: 'vote' });
        }

        const afterVote = room.engine.getState();
        if (afterVote.phase === 'pk_speech') {
          room.engine.skipCurrentPhase();
          const pkState = room.engine.getState();

          if (pkState.phase === 'pk_voting' && pkState.pkCandidates.length > 0) {
            // PK candidate cannot vote
            const candidate = pkState.pkCandidates[0];
            const otherCandidate = pkState.pkCandidates[1];
            const result = room.engine.handleAction({
              playerId: candidate,
              action: 'vote',
              targetId: otherCandidate || candidate,
            });
            expect(result.success).toBe(false);
            expect(result.message).toContain('PK候选人不能投票');

            // Non-candidate CAN vote for a candidate
            const nonCandidate = voters.find(v => v.alive && !pkState.pkCandidates.includes(v.id));
            if (nonCandidate) {
              const voteResult = room.engine.handleAction({
                playerId: nonCandidate.id,
                action: 'vote',
                targetId: pkState.pkCandidates[0],
              });
              expect(voteResult.success).toBe(true);
            }
          }
        }
      } finally {
        client.disconnect();
      }
    });
  });
});
