import type { ClassId } from "./classes";

export type CreatorRole = "manager" | "player";
export type ParticipantRole = "manager" | "player";
export type LobbyStatus = "waiting" | "rolling" | "drafting" | "complete" | "closed";

export interface ClassCounts {
  [classId: string]: number;
}

export interface LobbySettings {
  creatorRole: CreatorRole;
  rounds: number;
  mirrorDraft: boolean;
  classCounts: ClassCounts;
}

export interface LobbySummary {
  id: string;
  hostName: string;
  creatorRole: CreatorRole;
  hasPassword: boolean;
  status: LobbyStatus;
  playerCount: number;
  requiredPlayers: number;
  rounds: number;
  mirrorDraft: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  slot: 1 | 2 | null;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface DraftRoundResult {
  index: number;
  pair: [ClassId, ClassId];
  chooserId: string;
  chosenClassId: ClassId;
  assigned: Record<string, ClassId[]>;
  completedAt: number;
}

export interface CurrentRound {
  index: number;
  pair: [ClassId, ClassId];
  chooserId: string;
  startedAt: number;
}

export interface RollAttempt {
  attempt: number;
  rolls: Record<string, number>;
  winnerId: string | null;
  tied: boolean;
  completedAt: number;
}

export interface RollState {
  roundIndex: number;
  attempt: number;
  currentRolls: Record<string, number>;
  history: RollAttempt[];
}

export interface PublicLobbyState {
  id: string;
  hasPassword: boolean;
  settings: LobbySettings;
  status: LobbyStatus;
  hostParticipantId: string;
  viewerParticipantId: string | null;
  participants: Participant[];
  players: Participant[];
  requiredPlayers: number;
  canStart: boolean;
  startBlockers: string[];
  remainingCounts: ClassCounts;
  playerPools: Record<string, ClassId[]>;
  completedRounds: DraftRoundResult[];
  currentRound: CurrentRound | null;
  roll: RollState | null;
  lastRoundChooserId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateLobbyRequest {
  creatorName: string;
  creatorRole: CreatorRole;
  password?: string;
  rounds: number;
  mirrorDraft: boolean;
  classCounts: ClassCounts;
}

export interface CreateLobbyResponse {
  lobbyId: string;
  sessionId: string;
  state: PublicLobbyState;
}

export interface JoinLobbyRequest {
  playerName: string;
  password?: string;
}

export interface JoinLobbyResponse {
  lobbyId: string;
  sessionId: string;
  state: PublicLobbyState;
}

export type ClientMessage =
  | { type: "startDraft" }
  | { type: "chooseClass"; classId: ClassId }
  | { type: "rollDie" }
  | { type: "closeLobby" };

export type ServerMessage =
  | { type: "state"; state: PublicLobbyState }
  | { type: "error"; message: string };
