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
  FOOL = 'fool',
}

export const ROLE_TEAM: Record<RoleName, Team> = {
  [RoleName.WEREWOLF]: Team.WEREWOLF,
  [RoleName.VILLAGER]: Team.VILLAGER,
  [RoleName.SEER]: Team.VILLAGER,
  [RoleName.WITCH]: Team.VILLAGER,
  [RoleName.HUNTER]: Team.VILLAGER,
  [RoleName.GUARD]: Team.VILLAGER,
  [RoleName.FOOL]: Team.VILLAGER,
};

export const ROLE_DISPLAY_NAME: Record<RoleName, string> = {
  [RoleName.WEREWOLF]: '狼人',
  [RoleName.VILLAGER]: '平民',
  [RoleName.SEER]: '预言家',
  [RoleName.WITCH]: '女巫',
  [RoleName.HUNTER]: '猎人',
  [RoleName.GUARD]: '守卫',
  [RoleName.FOOL]: '白痴',
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
  PK_SPEECH = 'pk_speech',
  PK_VOTING = 'pk_voting',
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
  foolRevealed: boolean;  // 白痴是否已翻牌（翻牌后失去投票权）
}

export interface WitchPotions {
  antidote: boolean;
  poison: boolean;
}

export interface NightActions {
  guardTarget: string | null;
  werewolfTarget: string | null;
  witchSave: boolean;
  witchPoisonTarget: string | null;
  seerTarget: string | null;
}

export interface VoteRecord {
  voterId: string;
  targetId: string | null;
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
  lastGuardTarget: string | null;
  votes: VoteRecord[];
  deaths: string[];
  events: GameEvent[];
  hunterCanShoot: boolean;
  winner: Team | null;
  currentSpeaker: string | null;    // 当前发言者ID
  speakerQueue: string[];           // 发言顺序队列
  phaseDeadline: number | null;     // 当前阶段截止时间(ms)
  pkCandidates: string[];           // PK候选人列表
}

// 预设配置
export const PRESET_CONFIGS: Record<number, Record<RoleName, number>> = {
  6:  { werewolf: 2, villager: 2, seer: 1, witch: 1, hunter: 0, guard: 0, fool: 0 },
  9:  { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 0, fool: 0 },
  12: { werewolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, guard: 1, fool: 0 },
  16: { werewolf: 5, villager: 6, seer: 1, witch: 1, hunter: 1, guard: 1, fool: 1 },
};

// 阶段超时配置（毫秒）
export const PHASE_TIMEOUTS: Record<string, number> = {
  [GamePhase.GUARD_TURN]: 30000,
  [GamePhase.WEREWOLF_TURN]: 30000,
  [GamePhase.WITCH_TURN]: 30000,
  [GamePhase.SEER_TURN]: 30000,
  [GamePhase.LAST_WORDS]: 60000,
  [GamePhase.DISCUSSION]: 180000,
  [GamePhase.VOTING]: 15000,
  [GamePhase.PK_SPEECH]: 60000,
  [GamePhase.PK_VOTING]: 20000,
  [GamePhase.HUNTER_SHOOT]: 15000,
};

// 夜间阶段最低持续时间（毫秒）- 防止AI行动过快暴露身份
export const PHASE_MIN_DURATION: Record<string, number> = {
  [GamePhase.GUARD_TURN]: 15000,
  [GamePhase.WEREWOLF_TURN]: 15000,
  [GamePhase.WITCH_TURN]: 15000,
  [GamePhase.SEER_TURN]: 15000,
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
