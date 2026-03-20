import { Server as SocketServer, Socket } from 'socket.io';
import { RoomManager } from './engine/index.js';
import { PlayerType, ActionRequest, GamePhase } from './engine/types.js';

// 追踪 socket 与玩家的映射关系
const socketPlayerMap = new Map<string, { roomId: string; playerId: string }>();

export function setupSocketHandlers(io: SocketServer, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`客户端连接: ${socket.id}`);

    socket.on('join_room', (data: {
      roomId: string;
      playerName: string;
      playerType: PlayerType;
      device: 'desktop' | 'mobile';
      aiModel?: string;
    }) => {
      const room = roomManager.getRoom(data.roomId);
      if (!room) {
        socket.emit('error', { message: '房间不存在' });
        return;
      }

      const result = room.engine.addPlayer(
        data.playerName,
        data.playerType,
        data.device,
        data.aiModel
      );

      if (!result.success) {
        socket.emit('error', { message: result.message });
        return;
      }

      const playerId = result.data?.playerId as string;
      socketPlayerMap.set(socket.id, { roomId: data.roomId, playerId });
      socket.join(data.roomId);

      socket.emit('joined', { playerId, roomId: data.roomId });
      io.to(data.roomId).emit('game_state', room.engine.getState());
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

      // 发送各玩家各自的视角
      broadcastPlayerViews(io, room);
      io.to(mapping.roomId).emit('phase_change', {
        phase: room.engine.getState().phase,
        round: room.engine.getState().round,
      });
    });

    socket.on('game_action', (data: ActionRequest) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      const result = room.engine.handleAction({
        ...data,
        playerId: mapping.playerId,
      });

      socket.emit('action_result', result);

      if (result.success) {
        broadcastPlayerViews(io, room);
        const state = room.engine.getState();
        io.to(mapping.roomId).emit('phase_change', {
          phase: state.phase,
          round: state.round,
          deaths: state.deaths,
          winner: state.winner,
        });
      }
    });

    socket.on('skip_phase', () => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      room.engine.skipCurrentPhase();
      broadcastPlayerViews(io, room);
      const state = room.engine.getState();
      io.to(mapping.roomId).emit('phase_change', {
        phase: state.phase,
        round: state.round,
      });
    });

    socket.on('chat_message', (data: { message: string; type: 'voice' | 'text' }) => {
      const mapping = socketPlayerMap.get(socket.id);
      if (!mapping) return;

      const room = roomManager.getRoom(mapping.roomId);
      if (!room) return;

      const state = room.engine.getState();
      const player = state.players.find(p => p.id === mapping.playerId);
      if (!player) return;

      // 只允许在讨论阶段和遗言阶段发言
      if (state.phase !== GamePhase.DISCUSSION && state.phase !== GamePhase.LAST_WORDS) {
        socket.emit('error', { message: '当前阶段不允许发言' });
        return;
      }

      io.to(mapping.roomId).emit('chat_message', {
        playerId: mapping.playerId,
        playerName: player.name,
        message: data.message,
        type: data.type,
        timestamp: Date.now(),
      });
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

function broadcastPlayerViews(io: SocketServer, room: { id: string; engine: { getState: () => any; getPlayerView: (id: string) => any } }): void {
  const state = room.engine.getState();
  for (const player of state.players) {
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
