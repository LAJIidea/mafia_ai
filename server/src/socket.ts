import { Server as SocketServer, Socket } from 'socket.io';
import { RoomManager, Room } from './engine/index.js';
import { PlayerType, GamePhase, RoleName, PHASE_TIMEOUTS, PHASE_MIN_DURATION } from './engine/types.js';
import { AIManager } from './ai/AIAgent.js';
import { getGlobalAIConfig } from './ai/config.js';

// Socket → player mapping (only for human players)
const socketPlayerMap = new Map<string, { roomId: string; playerId: string }>();
// Room → AI manager
const roomAIManagers = new Map<string, AIManager>();
// Room → phase timers
const roomTimers = new Map<string, NodeJS.Timeout>();
// Room → phase start timestamp (for min duration enforcement)
const roomPhaseStart = new Map<string, number>();
// Room → AI action mutex (prevent concurrent triggerAIActions)
const roomAILock = new Map<string, boolean>();
// Room → last recorded phase key for acted tracking
const roomLastPhaseKey = new Map<string, string>();
// Room → set of player IDs that already acted in current phase
const roomActedPlayers = new Map<string, Set<string>>();
// Configurable AI action delay (for testing)
let aiDelayMs = () => 1000 + Math.random() * 2000;
export function setAIDelay(fn: () => number) { aiDelayMs = fn; }

export function setupSocketHandlers(io: SocketServer, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`客户端连接: ${socket.id}`);

    // Human player joins room
    socket.on('join_room', (data: {
      roomId: string;
      playerName: string;
      device: 'desktop' | 'mobile';
    }) => {
      const room = roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit('error', { message: '房间不存在' });
        return;
      }

      const result = room.engine.addPlayer(
        data.playerName,
        PlayerType.HUMAN,
        data.device,
      );

      if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
      }

      const playerId = result.data?.playerId as string;
      socketPlayerMap.set(socket.id, { roomId: data.roomId, playerId });
      socket.join(data.roomId);

      if (!room.hostId) {
        room.hostId = playerId;
      }

      socket.emit('joined', { playerId, roomId: data.roomId });
      io.to(data.roomId).emit('game_state', room.engine.getState());
    });

    // Add AI player (separate from human join - does NOT modify socket mapping)
    socket.on('add_ai', (data: {
      roomId: string;
      playerName: string;
      aiModel: string;
    }) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping || mapping.roomId !== data.roomId) {
        socket.emit('error', { message: '你不在该房间中' });
        return;
      }

      const room = roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit('error', { message: '房间不存在' });
        return;
      }

      // Check AI config - sync from global store if needed
      const aiManager = getOrCreateAIManager(data.roomId);
      if (!aiManager.getConfig()) {
        const globalConfig = getGlobalAIConfig();
        if (globalConfig) {
          aiManager.setConfig(globalConfig.apiToken);
        } else {
          socket.emit('error', { message: '请先在设置页面配置AI API Token' });
          return;
        }
      }

      const result = room.engine.addPlayer(
        data.playerName,
        PlayerType.AI,
        'desktop',
        data.aiModel,
      );

      if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
      }

      // Create AI agent for this player
      const playerId = result.data?.playerId as string;
      aiManager.createAgent(playerId, data.aiModel);

      io.to(data.roomId).emit('game_state', room.engine.getState());
    });

    // Configure AI token
    socket.on('configure_ai', (data: { apiToken: string }) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const aiManager = getOrCreateAIManager(mapping.roomId);
      aiManager.setConfig(data.apiToken);
      socket.emit('ai_configured', { success: true });
    });

    socket.on('start_game', () => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      const result = room.engine.startGame();
      if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
      }

      broadcastPlayerViews(io, room);
      emitPhaseChange(io, room);
      startPhaseTimer(io, room);
      triggerAIActions(io, room);
    });

    socket.on('game_action', (data: { action: string; targetId?: string }) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      const result = room.engine.handleAction({
        playerId: mapping.playerId,
        action: data.action,
        targetId: data.targetId,
      });

      socket.emit('action_result', result);

      if (result.success) {
        broadcastPlayerViews(io, room);
        emitPhaseChange(io, room);
        startPhaseTimer(io, room);
        triggerAIActions(io, room);
      }
    });

    socket.on('advance_speaker', () => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      const state = room.engine.getState();
      if (state.currentSpeaker === mapping.playerId) {
        room.engine.advanceSpeaker();
        broadcastPlayerViews(io, room);
        emitPhaseChange(io, room);
        startPhaseTimer(io, room);
        triggerAIActions(io, room);
      }
    });

    socket.on('skip_phase', () => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      room.engine.skipCurrentPhase();
      broadcastPlayerViews(io, room);
      emitPhaseChange(io, room);
      startPhaseTimer(io, room);
      triggerAIActions(io, room);
    });

    socket.on('chat_message', (data: { message: string; type: 'voice' | 'text' }) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      // Check speaking permission
      if (!room.engine.canSpeak(mapping.playerId)) {
        socket.emit('error', { message: '未轮到你发言' });
        return;
      }

      const state = room.engine.getState();
      const player = state.players.find(p => p.id === mapping.playerId);
      if (!player) return;

      io.to(mapping.roomId).emit('chat_message', {
        playerId: mapping.playerId,
        playerName: player.name,
        message: data.message,
        type: data.type,
        timestamp: Date.now(),
      });

      // Write chat to all AI agents' memory for future decisions
      const aiManager = roomAIManagers.get(mapping.roomId);
      if (aiManager) {
        for (const aiPlayer of state.players) {
          if (aiPlayer.type === PlayerType.AI && aiPlayer.id !== mapping.playerId) {
            const agent = aiManager.getAgent(aiPlayer.id);
            if (agent) {
              agent.addMemory(`${player.name}说: "${data.message}"`);
            }
          }
        }
      }
    });

    socket.on('disconnect', () => {
      const mapping = socketPlayerMap.get(socket.id);
      if (mapping) {
        const room = roomManager.getRoom(mapping.roomId);
        if (room) {
          const state = room.engine.getState();
          const player = state.players.find(p => p.id === mapping.playerId);
          if (player) {
            player.connected = false;
          }
          io.to(mapping.roomId).emit('player_disconnected', {
            playerId: mapping.playerId,
          });
        }
        socketPlayerMap.delete(socket.id);
      }
      console.log(`客户端断开: ${socket.id}`);
    });
  });
}

function getOrCreateAIManager(roomId: string): AIManager {
  let mgr = roomAIManagers.get(roomId);
  if (!mgr) {
    mgr = new AIManager();
    roomAIManagers.set(roomId, mgr);
  }
  return mgr;
}

function broadcastPlayerViews(io: SocketServer, room: Room): void {
  const state = room.engine.getState();
  for (const player of state.players) {
    if (player.type === PlayerType.AI) continue;

    const sockets = [...(io.sockets.sockets || new Map()).entries()]
      .filter(([socketId]) => {
        const m = socketPlayerMap.get(socketId);
        return m && m.playerId === player.id;
      })
      .map(([, s]) => s);

    const view = room.engine.getPlayerView(player.id);
    for (const s of sockets) {
      s.emit('game_state', view);
    }
  }
}

function emitPhaseChange(io: SocketServer, room: Room): void {
  const state = room.engine.getState();
  io.to(room.id).emit('phase_change', {
    phase: state.phase,
    round: state.round,
    deaths: state.deaths,
    winner: state.winner,
    currentSpeaker: state.currentSpeaker,
    phaseDeadline: state.phaseDeadline,
    pkCandidates: state.pkCandidates,
  });
}

function startPhaseTimer(io: SocketServer, room: Room): void {
  const existing = roomTimers.get(room.id);
  if (existing) clearTimeout(existing);

  const state = room.engine.getState();
  if (state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.WAITING) return;

  // Reset acted players only when phase/round actually changes
  const phaseKey = `${state.phase}-${state.round}`;
  if (roomLastPhaseKey.get(room.id) !== phaseKey) {
    roomLastPhaseKey.set(room.id, phaseKey);
    roomPhaseStart.set(room.id, Date.now());
    roomActedPlayers.set(room.id, new Set());
  }

  const timeout = PHASE_TIMEOUTS[state.phase];
  if (!timeout) return;

  const timer = setTimeout(() => {
    const currentState = room.engine.getState();
    if (currentState.phase === state.phase && currentState.round === state.round) {
      if (currentState.currentSpeaker) {
        room.engine.advanceSpeaker();
      } else {
        room.engine.skipCurrentPhase();
      }
      roomPhaseStart.delete(room.id);
      roomAILock.set(room.id, false); // Force release mutex on timeout
      broadcastPlayerViews(io, room);
      emitPhaseChange(io, room);
      startPhaseTimer(io, room);
      triggerAIActions(io, room);
    }
  }, timeout);

  roomTimers.set(room.id, timer);
}

async function triggerAIActions(io: SocketServer, room: Room): Promise<void> {
  // Mutex: prevent concurrent execution for same room
  if (roomAILock.get(room.id)) return;
  roomAILock.set(room.id, true);

  try {
    await doTriggerAIActions(io, room);
  } finally {
    roomAILock.set(room.id, false);
  }
}

async function doTriggerAIActions(io: SocketServer, room: Room): Promise<void> {
  const state = room.engine.getState();
  const aiManager = roomAIManagers.get(room.id);
  if (!aiManager || !aiManager.getConfig()) return;

  if (state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.WAITING) return;

  // Find AI players who need to act this phase
  let aiPlayers: typeof state.players;
  if (state.phase === GamePhase.LAST_WORDS) {
    // In last words, include dead AI players from deaths list
    aiPlayers = state.players.filter(
      p => p.type === PlayerType.AI && state.deaths.includes(p.id)
    );
  } else {
    aiPlayers = state.players.filter(p => p.type === PlayerType.AI && p.alive);
  }

  for (const aiPlayer of aiPlayers) {
    const agent = aiManager.getAgent(aiPlayer.id);
    if (!agent) continue;

    // Skip if this AI already acted in this phase
    const actedSet = roomActedPlayers.get(room.id);
    if (actedSet?.has(aiPlayer.id)) continue;

    // Check if this AI should act in this phase
    const shouldAct = shouldAIAct(aiPlayer, state.phase, state.pkCandidates || []);
    if (!shouldAct) continue;

    // Slight delay so actions feel natural
    await new Promise(resolve => setTimeout(resolve, aiDelayMs()));

    // Re-check state hasn't changed
    const currentState = room.engine.getState();
    if (currentState.phase !== state.phase) return;

    try {
      if (state.phase === GamePhase.DISCUSSION ||
          state.phase === GamePhase.LAST_WORDS ||
          state.phase === GamePhase.PK_SPEECH) {
        // AI speaking turn
        if (currentState.currentSpeaker === aiPlayer.id) {
          const speech = await agent.generateSpeech(aiPlayer, currentState);
          io.to(room.id).emit('chat_message', {
            playerId: aiPlayer.id,
            playerName: aiPlayer.name,
            message: speech,
            type: 'text',
            timestamp: Date.now(),
            aiModel: aiPlayer.aiModel,
          });
          // Write speech to all other AI agents' memory
          for (const otherPlayer of currentState.players) {
            if (otherPlayer.type === PlayerType.AI && otherPlayer.id !== aiPlayer.id) {
              const otherAgent = aiManager.getAgent(otherPlayer.id);
              if (otherAgent) {
                otherAgent.addMemory(`${aiPlayer.name}说: "${speech}"`);
              }
            }
          }
          agent.addMemory(`我发言: "${speech}"`);
          actedSet?.add(aiPlayer.id);
          // Advance to next speaker
          room.engine.advanceSpeaker();
          broadcastPlayerViews(io, room);
          emitPhaseChange(io, room);
          startPhaseTimer(io, room);
          // Recursively trigger next AI
          await doTriggerAIActions(io, room);
          return;
        }
      } else {
        // AI action (vote, kill, guard, etc.) with retry
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const recheck = room.engine.getState();
          if (recheck.phase !== state.phase) return;

          const action = await agent.decide(aiPlayer, recheck);
          const result = room.engine.handleAction(action);

          if (result.success) {
            agent.addMemory(`Round ${recheck.round}, ${state.phase}: performed ${action.action}`);
            actedSet?.add(aiPlayer.id);

            // Enforce minimum phase duration for night phases
            const minDuration = PHASE_MIN_DURATION[state.phase];
            if (minDuration) {
              const phaseStart = roomPhaseStart.get(room.id) || Date.now();
              const elapsed = Date.now() - phaseStart;
              const remaining = minDuration - elapsed;
              if (remaining > 0) {
                await new Promise(resolve => setTimeout(resolve, remaining));
              }
            }
            // phaseStart kept for acted tracking

            broadcastPlayerViews(io, room);
            emitPhaseChange(io, room);
            startPhaseTimer(io, room);
            await doTriggerAIActions(io, room);
            return;
          }
          console.warn(`AI ${aiPlayer.name} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${result.message}`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        // All retries failed - submit default/skip action to keep game moving
        console.error(`AI ${aiPlayer.name} all retries exhausted, using fallback action`);
        const fallbackActions: Record<string, { action: string; targetId?: string }> = {
          [GamePhase.GUARD_TURN]: { action: 'guard' },
          [GamePhase.WEREWOLF_TURN]: { action: 'kill' },
          [GamePhase.WITCH_TURN]: { action: 'witch_skip' },
          [GamePhase.SEER_TURN]: { action: 'investigate' },
          [GamePhase.VOTING]: { action: 'vote' },
          [GamePhase.PK_VOTING]: { action: 'vote' },
          [GamePhase.HUNTER_SHOOT]: { action: 'shoot' },
        };
        const fallback = fallbackActions[state.phase];
        if (fallback) {
          const fbResult = room.engine.handleAction({ playerId: aiPlayer.id, ...fallback });
          if (fbResult.success) {
            const minDuration = PHASE_MIN_DURATION[state.phase];
            if (minDuration) {
              const phaseStart = roomPhaseStart.get(room.id) || Date.now();
              const remaining = minDuration - (Date.now() - phaseStart);
              if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
            }
            // phaseStart kept for acted tracking
            broadcastPlayerViews(io, room);
            emitPhaseChange(io, room);
            startPhaseTimer(io, room);
            await doTriggerAIActions(io, room);
            return;
          }
        }
      }
    } catch (err) {
      console.error(`AI ${aiPlayer.name} error:`, err);
      // On error, also try fallback to prevent game from sticking
      try {
        const fallbackActions: Record<string, { action: string }> = {
          [GamePhase.GUARD_TURN]: { action: 'guard' },
          [GamePhase.WEREWOLF_TURN]: { action: 'kill' },
          [GamePhase.WITCH_TURN]: { action: 'witch_skip' },
          [GamePhase.SEER_TURN]: { action: 'investigate' },
          [GamePhase.VOTING]: { action: 'vote' },
          [GamePhase.PK_VOTING]: { action: 'vote' },
          [GamePhase.HUNTER_SHOOT]: { action: 'shoot' },
        };
        const fb = fallbackActions[state.phase];
        if (fb) {
          const fbResult = room.engine.handleAction({ playerId: aiPlayer.id, ...fb });
          if (fbResult.success) {
            // phaseStart kept for acted tracking
            broadcastPlayerViews(io, room);
            emitPhaseChange(io, room);
            startPhaseTimer(io, room);
            await doTriggerAIActions(io, room);
            return;
          }
        }
      } catch { /* ignore fallback errors */ }
    }
  }
}

export function shouldAIAct(player: { role: RoleName | null; id: string }, phase: GamePhase, pkCandidates: string[] = []): boolean {
  switch (phase) {
    case GamePhase.GUARD_TURN:
      return player.role === RoleName.GUARD;
    case GamePhase.WEREWOLF_TURN:
      return player.role === RoleName.WEREWOLF;
    case GamePhase.WITCH_TURN:
      return player.role === RoleName.WITCH;
    case GamePhase.SEER_TURN:
      return player.role === RoleName.SEER;
    case GamePhase.VOTING:
      return true;
    case GamePhase.PK_VOTING:
      // PK candidates cannot vote in PK round
      return !pkCandidates.includes(player.id);
    case GamePhase.HUNTER_SHOOT:
      return player.role === RoleName.HUNTER;
    case GamePhase.DISCUSSION:
    case GamePhase.LAST_WORDS:
      return true;
    case GamePhase.PK_SPEECH:
      // Only PK candidates speak in PK speech
      return pkCandidates.includes(player.id);
    default:
      return false;
  }
}
