import { v4 as uuidv4 } from 'uuid';
import { GameEngine, getDefaultConfig, validateRoleConfig } from './GameEngine.js';
import { RoomConfig, RoleName, PlayerType, GamePhase } from './types.js';

export interface Room {
  id: string;
  name: string;
  engine: GameEngine;
  createdAt: number;
  hostId: string | null;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(name: string, totalPlayers: number, roleConfig?: Record<RoleName, number>): Room {
    const config: RoomConfig = {
      totalPlayers,
      roleConfig: roleConfig || getDefaultConfig(totalPlayers),
    };

    const error = validateRoleConfig(config.totalPlayers, config.roleConfig);
    if (error) {
      throw new Error(error);
    }

    const roomId = uuidv4().substring(0, 8).toUpperCase();
    const engine = new GameEngine(roomId, config);
    const room: Room = {
      id: roomId,
      name,
      engine,
      createdAt: Date.now(),
      hostId: null,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  listRooms(): Array<{ id: string; name: string; playerCount: number; totalPlayers: number; phase: GamePhase }> {
    return [...this.rooms.values()].map(room => {
      const state = room.engine.getState();
      return {
        id: room.id,
        name: room.name,
        playerCount: state.players.length,
        totalPlayers: state.config.totalPlayers,
        phase: state.phase,
      };
    });
  }
}
