// 游戏核心类型定义

export enum Team {
  WEREWOLF = 'werewolf',
  VILLAGER = 'villager',
}

export enum RoleName {
  WEREWOLF = 'werewolf',
  VILLAGER = 'villager',
  SEER = 'seer',
  WITCH = 'witch',
  HUNTER = 'hunter',
  GUARD = 'guard',
}

export const ROLE_TEAM: Record<RoleName, Team> = {
  [RoleName.WEREWOLF]: Team.WEREWOLF,
  [RoleName.VILLAGER]: Team.VILLAGER,
  [RoleName.SEER]: Team.VILLAGER,
  [RoleName.WITCH]: Team.VILLAGER,
  [RoleName.HUNTER]: Team.VILLAGER,
  [RoleName.GUARD]: Team.VILLAGER,
};

export const ROLE_DISPLAY_NAME: Record<RoleName, string> = {
  [RoleName.WEREWOLF]: '狼人',
  [RoleName.VILLAGER]: '平民',
  [RoleName.SEER]: '预言家',
  [RoleName.WITCH]: '女巫',
  [RoleName.HUNTER]: '猎人',
  [RoleName.GUARD]: '守卫',
};

export enum GamePhase {
  WAITING = 'waiting',
  NIGHT_START = 'night_start',
  GUARD_TURN = 'guard_turn',
  WEREWOLF_TURN = 'werewolf_turn',
  WITCH_TURN = 'witch_turn',
  SEER_TURN = 'seer_turn',
  DAWN = 'dawn',
  LAST_WORDS = 'last_words',
  DISCUSSION = 'discussion',
  VOTING = 'voting',
  VOTE_RESULT = 'vote_result',
  HUNTER_SHOOT = 'hunter_shoot',
  GAME_OVER = 'game_over',
}

export enum PlayerType {
  HUMAN = 'human',
  AI = 'ai',
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  role: RoleName | null;
  alive: boolean;
  device: 'desktop' | 'mobile';
  aiModel?: string;
  connected: boolean;
}

export interface WitchPotions {
  antidote: boolean;   // 解药是否可用
  poison: boolean;     // 毒药是否可用
}

export interface NightActions {
  guardTarget: string | null;       // 守卫守护的目标
  werewolfTarget: string | null;    // 狼人杀害的目标
  witchSave: boolean;               // 女巫是否使用解药
  witchPoisonTarget: string | null; // 女巫毒药目标
  seerTarget: string | null;        // 预言家查验目标
}

export interface VoteRecord {
  voterId: string;
  targetId: string | null; // null 表示弃票
}

export interface GameEvent {
  type: string;
  phase: GamePhase;
  round: number;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface RoomConfig {
  totalPlayers: number;
  roleConfig: Record<RoleName, number>;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  round: number;
  players: Player[];
  config: RoomConfig;
  nightActions: NightActions;
  witchPotions: WitchPotions;
  lastGuardTarget: string | null;  // 守卫上一晚守护的目标
  votes: VoteRecord[];
  deaths: string[];                // 本轮死亡玩家ID列表
  events: GameEvent[];
  hunterCanShoot: boolean;         // 猎人是否可以开枪
  winner: Team | null;
}

// 预设配置
export const PRESET_CONFIGS: Record<number, Record<RoleName, number>> = {
  6:  { werewolf: 2, villager: 2, seer: 1, witch: 1, hunter: 0, guard: 0 },
  9:  { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 0 },
  12: { werewolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, guard: 1 },
  16: { werewolf: 5, villager: 7, seer: 1, witch: 1, hunter: 1, guard: 1 },
};

export interface ActionRequest {
  playerId: string;
  action: string;
  targetId?: string;
  data?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}
