import { CLASS_BY_ID, CLASS_IDS, type ClassId } from "../shared/classes";
import {
  consumePair,
  normalizeClassCounts,
  pairKey,
  selectDraftPair,
  validateDraftConfig
} from "../shared/draftRules";
import type {
  ClassCounts,
  ClientMessage,
  CreateLobbyRequest,
  CreatorRole,
  JoinLobbyRequest,
  LobbySettings,
  LobbyStatus,
  PublicLobbyResults,
  PublicResultsPlayer,
  LobbySummary,
  Participant,
  PublicLobbyState,
  RollAttempt,
  RollState,
  ServerMessage
} from "../shared/types";

interface Env {
  ASSETS: Fetcher;
  DRAFT_LOBBY: DurableObjectNamespace;
  LOBBY_REGISTRY: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
}

interface InternalLobby {
  id: string;
  password: string | null;
  settings: LobbySettings;
  status: LobbyStatus;
  hostParticipantId: string;
  participants: Record<string, Participant>;
  sessionIndex: Record<string, string>;
  playerOrder: string[];
  remainingCounts: Record<ClassId, number>;
  usedPairs: string[];
  playerPools: Record<string, ClassId[]>;
  completedRounds: PublicLobbyState["completedRounds"];
  currentRound: PublicLobbyState["currentRound"];
  roll: RollState | null;
  rollRevealAt: number | null;
  lastRoundChooserId: string | null;
  createdAt: number;
  updatedAt: number;
  autoCloseAt: number;
}

interface RegistryLobbyRecord extends LobbySummary {
  participantNames?: string[];
}

interface StoredPlayerResult extends PublicResultsPlayer {
  lobbyId: string;
  completedAt: number;
}

const LOBBY_STORAGE_KEY = "lobby";
const REGISTRY_PREFIX = "lobby:";
const PLAYER_RESULT_PREFIX = "player-result:";
const ROLL_REVEAL_DELAY_MS = 2200;
const LOBBY_IDLE_AUTO_CLOSE_MS = 15 * 60 * 1000;
const LOBBY_ID_PATTERN = /^[A-Z0-9]{6}$/;
const LOBBY_STATUSES = new Set<LobbyStatus>(["waiting", "rolling", "drafting", "complete", "closed"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/lobbies" && request.method === "GET") {
      if (!isAuthorizedAdmin(request, env)) {
        return json({ error: "Not found" }, 404);
      }

      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      return registry.fetch(new Request("https://registry/list", request));
    }

    if (url.pathname === "/api/admin/lobbies/close-all" && request.method === "POST") {
      if (!isAuthorizedAdmin(request, env)) {
        return json({ error: "Not found" }, 404);
      }

      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      return registry.fetch("https://registry/admin-close-all", { method: "POST" });
    }

    const adminCloseRoute = url.pathname.match(/^\/api\/admin\/lobbies\/([a-zA-Z0-9]{6})\/close\/?$/);
    if (adminCloseRoute && request.method === "POST") {
      if (!isAuthorizedAdmin(request, env)) {
        return json({ error: "Not found" }, 404);
      }

      const [, lobbyId] = adminCloseRoute;
      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      return registry.fetch("https://registry/admin-close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lobbyId.toUpperCase() })
      });
    }

    if (url.pathname === "/api/lobbies" && request.method === "GET") {
      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      return registry.fetch(new Request("https://registry/list", request));
    }

    if (url.pathname === "/api/lobbies" && request.method === "POST") {
      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      return registry.fetch(new Request("https://registry/create", request));
    }

    if (url.pathname === "/api/player-results" && request.method === "GET") {
      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      const target = new URL("https://registry/player-results");
      target.search = url.search;
      return registry.fetch(new Request(target, request));
    }

    const playerResultsRoute = url.pathname.match(/^\/api\/players\/(.+)\/results\/?$/);
    if (playerResultsRoute && request.method === "GET") {
      const [, rawName] = playerResultsRoute;
      const registry = env.LOBBY_REGISTRY.get(env.LOBBY_REGISTRY.idFromName("global"));
      const target = new URL("https://registry/player-results");
      target.searchParams.set("name", safeDecodeURIComponent(rawName));
      return registry.fetch(new Request(target, request));
    }

    const lobbyRoute = url.pathname.match(/^\/api\/lobbies\/([a-zA-Z0-9]{6})\/(join|state|ws|results)\/?$/);
    if (lobbyRoute) {
      const [, lobbyId, action] = lobbyRoute;
      const lobby = env.DRAFT_LOBBY.get(env.DRAFT_LOBBY.idFromName(lobbyId.toUpperCase()));
      const target = new URL(`https://lobby/${action}`);
      target.search = url.search;
      return lobby.fetch(new Request(target, request));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "API endpoint not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

export class LobbyRegistry {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/list" && request.method === "GET") {
      return json({ lobbies: await this.listVisibleLobbies() });
    }

    if (url.pathname === "/create" && request.method === "POST") {
      const body = await readJson<CreateLobbyRequest>(request);
      const creatorName = cleanName(body.creatorName);

      if (creatorName && (await this.isNameUsedInActiveLobby(creatorName))) {
        return json({ error: `Имя "${creatorName}" уже используется в другом лобби.` }, 409);
      }

      const lobbyId = await this.createLobbyId();
      const lobby = this.env.DRAFT_LOBBY.get(this.env.DRAFT_LOBBY.idFromName(lobbyId));
      const initResponse = await lobby.fetch(
        "https://lobby/init",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, lobbyId })
        }
      );

      if (!initResponse.ok) {
        return initResponse;
      }

      const payload = (await initResponse.json()) as {
        lobbyId: string;
        sessionId: string;
        state: PublicLobbyState;
      };
      await this.state.storage.put(`${REGISTRY_PREFIX}${payload.lobbyId}`, toRegistryRecord(payload.state));

      return json(payload, 201);
    }

    if (url.pathname === "/upsert" && request.method === "POST") {
      const summary = normalizeRegistryRecord(await readJson<RegistryLobbyRecord>(request));
      if (!summary) {
        return json({ error: "Invalid lobby record." }, 400);
      }

      await this.state.storage.put(`${REGISTRY_PREFIX}${summary.id}`, summary);
      return json({ ok: true });
    }

    if (url.pathname === "/name-check" && request.method === "POST") {
      const body = await readJson<{ name: string; excludeLobbyId?: string }>(request);
      return json({
        used: await this.isNameUsedInActiveLobby(body.name, body.excludeLobbyId?.toUpperCase())
      });
    }

    if (url.pathname === "/player-results" && request.method === "GET") {
      return this.playerResults(url.searchParams.get("name"));
    }

    if (url.pathname === "/player-results/upsert" && request.method === "POST") {
      const body = await readJson<{ results: StoredPlayerResult[] }>(request);
      await this.upsertPlayerResults(body.results);
      return json({ ok: true });
    }

    if (url.pathname === "/remove" && request.method === "POST") {
      const body = await readJson<{ id: string }>(request);
      const lobbyId = normalizeLobbyId(body.id);
      if (lobbyId) {
        await this.state.storage.delete(`${REGISTRY_PREFIX}${lobbyId}`);
      }

      return json({ ok: true });
    }

    if (url.pathname === "/admin-close" && request.method === "POST") {
      const body = await readJson<{ id: string }>(request);
      const closed = await this.closeLobbyById(body.id);
      return json({ closed });
    }

    if (url.pathname === "/admin-close-all" && request.method === "POST") {
      const records = await this.listActiveLobbyRecords();
      const ids = records.map((lobby) => lobby.id);
      const closed = [];

      for (const id of ids) {
        closed.push(...(await this.closeLobbyById(id)));
      }

      return json({ closed });
    }

    return json({ error: "Not found" }, 404);
  }

  private async playerResults(rawName: unknown): Promise<Response> {
    const playerName = cleanName(rawName);

    if (!playerName) {
      return json({ error: "Нужно указать имя игрока." }, 400);
    }

    const refreshedResult = await this.findAndStoreCompletedPlayerResult(playerName);
    if (refreshedResult) {
      return json(toPublicPlayerResult(refreshedResult));
    }

    if (await this.isNameUsedInActiveLobby(playerName)) {
      return json({ error: "Драфт этого игрока ещё не завершён." }, 409);
    }

    const storedResult = await this.getStoredPlayerResult(playerName);
    if (storedResult) {
      return json(toPublicPlayerResult(storedResult));
    }

    return json({ error: "Результаты для игрока не найдены." }, 404);
  }

  private async upsertPlayerResults(results: StoredPlayerResult[]): Promise<void> {
    for (const result of results) {
      const key = getPlayerResultKey(result.name);
      if (!key) {
        continue;
      }

      await this.state.storage.put(key, result);
    }
  }

  private async getStoredPlayerResult(name: string): Promise<StoredPlayerResult | null> {
    const key = getPlayerResultKey(name);
    return key ? (await this.state.storage.get<StoredPlayerResult>(key)) ?? null : null;
  }

  private async findAndStoreCompletedPlayerResult(name: string): Promise<StoredPlayerResult | null> {
    const normalizedName = normalizeNameForLookup(name);
    const records = await this.listActiveLobbyRecords();

    for (const record of records) {
      if (
        !getRegistryParticipantNames(record).some(
          (participantName) => normalizeNameForLookup(participantName) === normalizedName
        )
      ) {
        continue;
      }

      const result = await this.fetchPlayerResultFromLobby(record.id, name);
      if (result) {
        await this.upsertPlayerResults([result]);
        return result;
      }
    }

    return null;
  }

  private async fetchPlayerResultFromLobby(
    lobbyId: string,
    name: string
  ): Promise<StoredPlayerResult | null> {
    const lobby = this.env.DRAFT_LOBBY.get(this.env.DRAFT_LOBBY.idFromName(lobbyId));
    const target = new URL("https://lobby/player-result");
    target.searchParams.set("name", name);

    try {
      const response = await lobby.fetch(target, { method: "GET" });
      if (!response.ok) {
        return null;
      }

      return (await response.json()) as StoredPlayerResult;
    } catch {
      return null;
    }
  }

  private async closeLobbyById(id: string): Promise<string[]> {
    const lobbyId = normalizeLobbyId(id);
    if (!lobbyId) {
      return [];
    }

    const storageKey = `${REGISTRY_PREFIX}${lobbyId}`;
    const summary = await this.state.storage.get<RegistryLobbyRecord>(storageKey);
    if (!summary) {
      return [];
    }

    try {
      const lobby = this.env.DRAFT_LOBBY.get(this.env.DRAFT_LOBBY.idFromName(lobbyId));
      await lobby.fetch("https://lobby/admin-close", { method: "POST" });
    } finally {
      await this.state.storage.delete(storageKey);
    }

    return [lobbyId];
  }

  private async listVisibleLobbies(): Promise<LobbySummary[]> {
    const records = await this.listActiveLobbyRecords();
    return records.map(toPublicSummary).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async isNameUsedInActiveLobby(name: string, excludeLobbyId?: string): Promise<boolean> {
    const normalizedName = normalizeNameForLookup(name);
    if (!normalizedName) {
      return false;
    }

    const records = await this.listActiveLobbyRecords();
    return records.some((record) => {
      if (excludeLobbyId && record.id === excludeLobbyId) {
        return false;
      }

      return getRegistryParticipantNames(record).some(
        (participantName) => normalizeNameForLookup(participantName) === normalizedName
      );
    });
  }

  private async listActiveLobbyRecords(): Promise<RegistryLobbyRecord[]> {
    const entries = await this.state.storage.list<RegistryLobbyRecord>({ prefix: REGISTRY_PREFIX });
    const now = Date.now();
    const lobbies: RegistryLobbyRecord[] = [];

    for (const [storageKey, rawSummary] of entries) {
      let summary = normalizeRegistryRecord(rawSummary, storageKey);
      if (!summary) {
        await this.state.storage.delete(storageKey);
        continue;
      }

      const normalizedStorageKey = `${REGISTRY_PREFIX}${summary.id}`;
      if (storageKey !== normalizedStorageKey) {
        await this.state.storage.put(normalizedStorageKey, summary);
        await this.state.storage.delete(storageKey);
      }

      if (summary.status === "closed") {
        await this.state.storage.delete(normalizedStorageKey);
        continue;
      }

      if (getSummaryAutoCloseAt(summary) <= now) {
        await this.closeLobbyById(summary.id);
        continue;
      }

      if (!summary.participantNames?.length) {
        const refreshedSummary = await this.refreshLobbyRecord(summary);
        if (!refreshedSummary || refreshedSummary.status === "closed") {
          await this.state.storage.delete(normalizedStorageKey);
          continue;
        }

        summary = refreshedSummary;
      }

      lobbies.push(summary);
    }

    return lobbies;
  }

  private async refreshLobbyRecord(summary: RegistryLobbyRecord): Promise<RegistryLobbyRecord | null> {
    const lobby = this.env.DRAFT_LOBBY.get(this.env.DRAFT_LOBBY.idFromName(summary.id));

    try {
      const response = await lobby.fetch("https://lobby/registry-record", { method: "GET" });
      if (!response.ok) {
        return null;
      }

      const refreshedSummary = normalizeRegistryRecord(await response.json());
      if (!refreshedSummary) {
        return null;
      }

      await this.state.storage.put(`${REGISTRY_PREFIX}${refreshedSummary.id}`, refreshedSummary);
      return refreshedSummary;
    } catch {
      return null;
    }
  }

  private async createLobbyId(): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const id = randomLobbyId();
      const existing = await this.state.storage.get(`${REGISTRY_PREFIX}${id}`);
      if (!existing) {
        return id;
      }
    }

    throw new Error("Could not generate unique lobby id.");
  }
}

export class DraftLobby {
  private lobby: InternalLobby | null = null;
  private readonly sockets = new Map<WebSocket, string>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      return this.init(request);
    }

    if (url.pathname === "/join" && request.method === "POST") {
      return this.join(request);
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const lobby = await this.requireLobby();
      const sessionId = url.searchParams.get("sessionId") ?? "";
      return json(this.toPublicState(lobby, sessionId));
    }

    if (url.pathname === "/registry-record" && request.method === "GET") {
      return this.registryRecord();
    }

    if (url.pathname === "/player-result" && request.method === "GET") {
      return this.playerResult(url.searchParams.get("name"));
    }

    if (url.pathname === "/results" && request.method === "GET") {
      return this.results();
    }

    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      return this.openSocket(request);
    }

    if (url.pathname === "/admin-close" && request.method === "POST") {
      return this.adminClose();
    }

    return json({ error: "Not found" }, 404);
  }

  async alarm(): Promise<void> {
    const lobby = await this.loadLobby();

    if (!lobby) {
      return;
    }

    const now = Date.now();
    if (lobby.status !== "closed" && lobby.autoCloseAt <= now) {
      await this.autoCloseLobby(lobby, now);
      return;
    }

    const lastRoll = lobby.roll?.history.at(-1);
    if (
      lobby.status === "rolling" &&
      lobby.roll &&
      lobby.rollRevealAt &&
      lobby.rollRevealAt <= now &&
      lastRoll?.winnerId &&
      !lastRoll.tied
    ) {
      this.prepareRound(lobby, lobby.roll.roundIndex, lastRoll.winnerId);
      this.touchLobby(lobby, now);

      await this.persist();
      await this.syncSummary();
      this.broadcast(lobby);
      return;
    }

    if (lobby.rollRevealAt && lobby.rollRevealAt <= now) {
      lobby.rollRevealAt = null;
    }

    await this.persist();
  }

  private async init(request: Request): Promise<Response> {
    const existing = await this.loadLobby();
    if (existing) {
      const sessionId = Object.keys(existing.sessionIndex).find(
        (candidate) => existing.sessionIndex[candidate] === existing.hostParticipantId
      );

      return json({
        lobbyId: existing.id,
        sessionId,
        state: this.toPublicState(existing, sessionId ?? "")
      });
    }

    const body = await readJson<CreateLobbyRequest & { lobbyId: string }>(request);
    const creatorName = cleanName(body.creatorName);
    const creatorRole = body.creatorRole === "manager" ? "manager" : "player";
    const rounds = Math.floor(Number(body.rounds));
    const classCounts = normalizeClassCounts(body.classCounts ?? {});
    const validation = validateDraftConfig(classCounts, rounds);

    if (!creatorName) {
      return json({ error: "Нужно указать имя создателя." }, 400);
    }

    if (!validation.ok) {
      return json({ error: validation.blockers.join(" ") }, 400);
    }

    const now = Date.now();
    const sessionId = randomToken();
    const hostParticipantId = randomParticipantId();
    const settings: LobbySettings = {
      creatorRole,
      rounds,
      mirrorDraft: Boolean(body.mirrorDraft),
      classCounts
    };

    const host: Participant = {
      id: hostParticipantId,
      name: creatorName,
      role: creatorRole,
      slot: creatorRole === "player" ? 1 : null,
      isHost: true,
      connected: false,
      joinedAt: now,
      lastSeenAt: now
    };

    const lobby: InternalLobby = {
      id: body.lobbyId,
      password: typeof body.password === "string" && body.password.length > 0 ? body.password : null,
      settings,
      status: "waiting",
      hostParticipantId,
      participants: { [hostParticipantId]: host },
      sessionIndex: { [sessionId]: hostParticipantId },
      playerOrder: creatorRole === "player" ? [hostParticipantId] : [],
      remainingCounts: classCounts,
      usedPairs: [],
      playerPools: creatorRole === "player" ? { [hostParticipantId]: [] } : {},
      completedRounds: [],
      currentRound: null,
      roll: null,
      rollRevealAt: null,
      lastRoundChooserId: null,
      createdAt: now,
      updatedAt: now,
      autoCloseAt: now + LOBBY_IDLE_AUTO_CLOSE_MS
    };

    this.lobby = lobby;
    await this.persist();
    await this.syncSummary();

    return json({ lobbyId: lobby.id, sessionId, state: this.toPublicState(lobby, sessionId) }, 201);
  }

  private async registryRecord(): Promise<Response> {
    const lobby = await this.loadLobby();

    if (!lobby || lobby.status === "closed") {
      return json({ error: "Not found" }, 404);
    }

    return json(toRegistryRecord(this.toPublicState(lobby, "")));
  }

  private async playerResult(rawName: unknown): Promise<Response> {
    const playerName = cleanName(rawName);
    const lobby = await this.loadLobby();

    if (!lobby) {
      return json({ error: "Лобби не найдено." }, 404);
    }

    const player = getPlayers(lobby).find(
      (candidate) => normalizeNameForLookup(candidate.name) === normalizeNameForLookup(playerName)
    );

    if (!player) {
      return json({ error: "Игрок не найден в этом лобби." }, 404);
    }

    if (!isDraftCompleted(lobby)) {
      return json({ error: "Драфт этого игрока ещё не завершён." }, 409);
    }

    return json(this.toStoredPlayerResult(lobby, player));
  }

  private async join(request: Request): Promise<Response> {
    const lobby = await this.requireLobby();
    const body = await readJson<JoinLobbyRequest>(request);
    const playerName = cleanName(body.playerName);

    if (lobby.status !== "waiting") {
      return json({ error: "Драфт уже начался." }, 409);
    }

    if (!playerName) {
      return json({ error: "Нужно указать имя игрока." }, 400);
    }

    if (lobby.password && body.password !== lobby.password) {
      return json({ error: "Неверный пароль лобби." }, 403);
    }

    if (lobby.playerOrder.length >= 2) {
      return json({ error: "Лобби уже заполнено." }, 409);
    }

    if (
      Object.values(lobby.participants).some(
        (participant) => normalizeNameForLookup(participant.name) === normalizeNameForLookup(playerName)
      )
    ) {
      return json({ error: `Имя "${playerName}" уже используется в этом лобби.` }, 409);
    }

    if (await this.isNameUsedInOtherLobby(playerName, lobby.id)) {
      return json({ error: `Имя "${playerName}" уже используется в другом лобби.` }, 409);
    }

    const now = Date.now();
    const sessionId = randomToken();
    const participantId = randomParticipantId();
    const slot = lobby.playerOrder.length === 0 ? 1 : 2;

    const participant: Participant = {
      id: participantId,
      name: playerName,
      role: "player",
      slot,
      isHost: false,
      connected: false,
      joinedAt: now,
      lastSeenAt: now
    };

    lobby.participants[participantId] = participant;
    lobby.sessionIndex[sessionId] = participantId;
    lobby.playerOrder.push(participantId);
    lobby.playerPools[participantId] = [];
    this.touchLobby(lobby, now);

    await this.persist();
    await this.syncSummary();
    this.broadcast(lobby);

    return json({ lobbyId: lobby.id, sessionId, state: this.toPublicState(lobby, sessionId) }, 201);
  }

  private async results(): Promise<Response> {
    const lobby = await this.loadLobby();

    if (!lobby) {
      return json({ error: "Лобби не найдено." }, 404);
    }

    if (lobby.status !== "closed" && lobby.autoCloseAt <= Date.now()) {
      await this.autoCloseLobby(lobby);
    }

    if (!isDraftCompleted(lobby)) {
      return json({ error: "Результаты доступны только после завершения драфта." }, 409);
    }

    return json(this.toPublicResults(lobby));
  }

  private async openSocket(request: Request): Promise<Response> {
    const lobby = await this.requireLobby();
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const participant = this.getParticipantBySession(lobby, sessionId);

    if (!participant) {
      return json({ error: "Unknown lobby session." }, 401);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();
    this.sockets.set(server, sessionId);

    participant.connected = true;
    participant.lastSeenAt = Date.now();
    this.touchLobby(lobby, participant.lastSeenAt);
    await this.persist();
    await this.syncSummary();

    server.addEventListener("message", (event) => {
      void this.handleSocketMessage(server, event.data);
    });
    server.addEventListener("close", () => {
      void this.handleSocketClose(server);
    });
    server.addEventListener("error", () => {
      void this.handleSocketClose(server);
    });

    this.send(server, { type: "state", state: this.toPublicState(lobby, sessionId) });
    this.broadcast(lobby);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleSocketMessage(socket: WebSocket, data: unknown): Promise<void> {
    const sessionId = this.sockets.get(socket);
    if (!sessionId) {
      return;
    }

    const lobby = await this.requireLobby();
    const participant = this.getParticipantBySession(lobby, sessionId);
    if (!participant) {
      this.send(socket, { type: "error", message: "Сессия больше не действительна." });
      return;
    }

    participant.lastSeenAt = Date.now();

    let message: ClientMessage;
    try {
      message = JSON.parse(String(data)) as ClientMessage;
    } catch {
      this.send(socket, { type: "error", message: "Некорректное сообщение." });
      return;
    }

    try {
      if (message.type === "startDraft") {
        await this.startDraft(lobby, sessionId);
      } else if (message.type === "chooseClass") {
        await this.chooseClass(lobby, sessionId, message.classId);
      } else if (message.type === "rollDie") {
        await this.rollDie(lobby, sessionId);
      } else if (message.type === "closeLobby") {
        await this.closeLobby(lobby, sessionId);
      }
    } catch (error) {
      this.send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Action failed."
      });
    }
  }

  private async handleSocketClose(socket: WebSocket): Promise<void> {
    const sessionId = this.sockets.get(socket);
    this.sockets.delete(socket);

    if (!sessionId) {
      return;
    }

    const lobby = await this.loadLobby();
    if (!lobby) {
      return;
    }

    const participant = this.getParticipantBySession(lobby, sessionId);
    if (!participant) {
      return;
    }

    if (!this.hasActiveSocketForParticipant(lobby, participant.id)) {
      participant.connected = false;
      participant.lastSeenAt = Date.now();
      this.touchLobby(lobby, participant.lastSeenAt);
      await this.persist();
      await this.syncSummary();
      this.broadcast(lobby);
    }
  }

  private async startDraft(lobby: InternalLobby, sessionId: string): Promise<void> {
    const participant = this.getParticipantBySession(lobby, sessionId);

    if (!participant?.isHost) {
      throw new Error("Начать драфт может только создатель лобби.");
    }

    if (lobby.status !== "waiting") {
      throw new Error("Драфт уже начался.");
    }

    const blockers = getStartBlockers(lobby);
    if (blockers.length > 0) {
      throw new Error(blockers.join(" "));
    }

    lobby.remainingCounts = normalizeClassCounts(lobby.settings.classCounts);
    lobby.usedPairs = [];
    lobby.completedRounds = [];
    lobby.currentRound = null;
    lobby.roll = null;
    lobby.lastRoundChooserId = null;
    lobby.playerPools = Object.fromEntries(lobby.playerOrder.map((playerId) => [playerId, []]));

    if (lobby.settings.rounds === 1) {
      this.enterRollStage(lobby, 0);
    } else {
      this.prepareRound(lobby, 0);
    }

    this.touchLobby(lobby);
    await this.persist();
    await this.syncSummary();
    this.broadcast(lobby);
  }

  private async chooseClass(
    lobby: InternalLobby,
    sessionId: string,
    classId: ClassId
  ): Promise<void> {
    const participant = this.getParticipantBySession(lobby, sessionId);

    if (!participant || lobby.status !== "drafting" || !lobby.currentRound) {
      throw new Error("Сейчас нет активного выбора.");
    }

    if (participant.id !== lobby.currentRound.chooserId) {
      throw new Error("Сейчас выбирает другой игрок.");
    }

    const [firstClass, secondClass] = lobby.currentRound.pair;
    if (classId !== firstClass && classId !== secondClass) {
      throw new Error("Этого класса нет в текущем предложении.");
    }

    const otherClass = classId === firstClass ? secondClass : firstClass;
    const chooserId = participant.id;
    const otherPlayerId = lobby.playerOrder.find((playerId) => playerId !== chooserId);

    if (!otherPlayerId) {
      throw new Error("Не найден второй игрок.");
    }

    const assigned: Record<string, ClassId[]> = Object.fromEntries(
      lobby.playerOrder.map((playerId) => [playerId, []])
    );

    if (lobby.settings.mirrorDraft) {
      for (const playerId of lobby.playerOrder) {
        lobby.playerPools[playerId].push(classId);
        assigned[playerId].push(classId);
      }
    } else {
      lobby.playerPools[chooserId].push(classId);
      lobby.playerPools[otherPlayerId].push(otherClass);
      assigned[chooserId].push(classId);
      assigned[otherPlayerId].push(otherClass);
    }

    lobby.remainingCounts = consumePair(lobby.remainingCounts, [firstClass, secondClass]);
    lobby.usedPairs.push(pairKey(firstClass, secondClass));
    lobby.completedRounds.push({
      index: lobby.currentRound.index,
      pair: lobby.currentRound.pair,
      chooserId,
      chosenClassId: classId,
      assigned,
      completedAt: Date.now()
    });
    lobby.currentRound = null;

    const completedCount = lobby.completedRounds.length;
    if (completedCount >= lobby.settings.rounds) {
      lobby.status = "complete";
    } else if (lobby.settings.rounds % 2 === 1 && completedCount === lobby.settings.rounds - 1) {
      this.enterRollStage(lobby, completedCount);
    } else {
      this.prepareRound(lobby, completedCount);
    }

    this.touchLobby(lobby);
    await this.persist();
    await this.syncSummary();
    this.broadcast(lobby);
  }

  private async rollDie(lobby: InternalLobby, sessionId: string): Promise<void> {
    const participant = this.getParticipantBySession(lobby, sessionId);

    if (!participant || participant.role !== "player" || !lobby.playerOrder.includes(participant.id)) {
      throw new Error("Кубик могут бросать только игроки драфта.");
    }

    if (lobby.status !== "rolling" || !lobby.roll) {
      throw new Error("Сейчас нет активного броска кубика.");
    }

    if (lobby.roll.currentRolls[participant.id] !== undefined) {
      throw new Error("Ты уже бросил кубик в этой попытке.");
    }

    lobby.roll.currentRolls[participant.id] = randomInt(1, 6);

    if (lobby.playerOrder.every((playerId) => lobby.roll?.currentRolls[playerId] !== undefined)) {
      const [firstPlayerId, secondPlayerId] = lobby.playerOrder;
      const firstRoll = lobby.roll.currentRolls[firstPlayerId];
      const secondRoll = lobby.roll.currentRolls[secondPlayerId];
      const tied = firstRoll === secondRoll;
      const winnerId = tied ? null : firstRoll > secondRoll ? firstPlayerId : secondPlayerId;
      const attempt: RollAttempt = {
        attempt: lobby.roll.attempt,
        rolls: { ...lobby.roll.currentRolls },
        winnerId,
        tied,
        completedAt: Date.now()
      };

      lobby.roll.history.push(attempt);

      if (tied) {
        lobby.roll.currentRolls = {};
        lobby.roll.attempt += 1;
      } else if (winnerId) {
        lobby.lastRoundChooserId = winnerId;
        lobby.rollRevealAt = Date.now() + ROLL_REVEAL_DELAY_MS;
      }
    }

    this.touchLobby(lobby);
    await this.persist();
    await this.syncSummary();
    this.broadcast(lobby);
  }

  private async closeLobby(lobby: InternalLobby, sessionId: string): Promise<void> {
    const participant = this.getParticipantBySession(lobby, sessionId);

    if (!participant?.isHost) {
      throw new Error("Закрыть лобби может только создатель.");
    }

    if (lobby.status !== "waiting" && lobby.status !== "complete") {
      throw new Error("Лобби можно закрыть во время ожидания игроков или после завершения драфта.");
    }

    if (isDraftCompleted(lobby)) {
      await this.syncPlayerResults(lobby);
    }

    this.markLobbyClosed(lobby);

    await this.persist();
    await this.removeSummary();
    this.broadcast(lobby);
  }

  private async adminClose(): Promise<Response> {
    const lobby = await this.loadLobby();
    if (!lobby) {
      return json({ ok: true });
    }

    if (isDraftCompleted(lobby)) {
      await this.syncPlayerResults(lobby);
    }

    this.markLobbyClosed(lobby);

    await this.persist();
    this.broadcast(lobby);

    return json({ ok: true });
  }

  private enterRollStage(lobby: InternalLobby, roundIndex: number): void {
    lobby.status = "rolling";
    lobby.currentRound = null;
    lobby.rollRevealAt = null;
    lobby.roll = {
      roundIndex,
      attempt: 1,
      currentRolls: {},
      history: []
    };
  }

  private prepareRound(lobby: InternalLobby, roundIndex: number, forcedChooserId?: string): void {
    const chooserId = forcedChooserId ?? lobby.playerOrder[roundIndex % 2];
    const pair = selectDraftPair(
      lobby.remainingCounts,
      lobby.usedPairs,
      lobby.settings.rounds - roundIndex - 1
    );

    if (!pair) {
      throw new Error("Не удалось собрать корректную пару классов из оставшегося пула.");
    }

    lobby.status = "drafting";
    lobby.roll = null;
    lobby.rollRevealAt = null;
    lobby.currentRound = {
      index: roundIndex,
      pair,
      chooserId,
      startedAt: Date.now()
    };
  }

  private toPublicState(lobby: InternalLobby, sessionId: string): PublicLobbyState {
    const viewerParticipantId = lobby.sessionIndex[sessionId] ?? null;
    const startBlockers = getStartBlockers(lobby);

    return {
      id: lobby.id,
      hasPassword: Boolean(lobby.password),
      settings: lobby.settings,
      status: lobby.status,
      hostParticipantId: lobby.hostParticipantId,
      viewerParticipantId,
      participants: Object.values(lobby.participants),
      players: getPlayers(lobby),
      requiredPlayers: 2,
      canStart:
        lobby.status === "waiting" &&
        viewerParticipantId === lobby.hostParticipantId &&
        startBlockers.length === 0,
      startBlockers: lobby.status === "waiting" ? startBlockers : [],
      remainingCounts: lobby.remainingCounts,
      playerPools: lobby.playerPools,
      completedRounds: lobby.completedRounds,
      currentRound: lobby.currentRound,
      roll: lobby.roll,
      lastRoundChooserId: lobby.lastRoundChooserId,
      createdAt: lobby.createdAt,
      updatedAt: lobby.updatedAt,
      autoCloseAt: lobby.autoCloseAt
    };
  }

  private toPublicResults(lobby: InternalLobby): PublicLobbyResults {
    const players = getPlayers(lobby);

    return {
      players: players.map((player) => ({
        name: player.name,
        classes: (lobby.playerPools[player.id] ?? []).map((classId) => CLASS_BY_ID[classId].name)
      }))
    };
  }

  private toStoredPlayerResult(lobby: InternalLobby, player: Participant): StoredPlayerResult {
    return {
      name: player.name,
      classes: (lobby.playerPools[player.id] ?? []).map((classId) => CLASS_BY_ID[classId].name),
      lobbyId: lobby.id,
      completedAt: getLobbyCompletedAt(lobby)
    };
  }

  private broadcast(lobby: InternalLobby): void {
    for (const [socket, sessionId] of this.sockets) {
      this.send(socket, { type: "state", state: this.toPublicState(lobby, sessionId) });
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.sockets.delete(socket);
    }
  }

  private getParticipantBySession(lobby: InternalLobby, sessionId: string): Participant | null {
    const participantId = lobby.sessionIndex[sessionId];
    return participantId ? lobby.participants[participantId] ?? null : null;
  }

  private async isNameUsedInOtherLobby(name: string, lobbyId: string): Promise<boolean> {
    const registry = this.env.LOBBY_REGISTRY.get(this.env.LOBBY_REGISTRY.idFromName("global"));
    const response = await registry.fetch("https://registry/name-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, excludeLobbyId: lobbyId })
    });

    if (!response.ok) {
      throw new Error("Не удалось проверить имя игрока.");
    }

    const payload = (await response.json()) as { used: boolean };
    return Boolean(payload.used);
  }

  private hasActiveSocketForParticipant(lobby: InternalLobby, participantId: string): boolean {
    for (const sessionId of this.sockets.values()) {
      if (lobby.sessionIndex[sessionId] === participantId) {
        return true;
      }
    }

    return false;
  }

  private touchLobby(lobby: InternalLobby, now = Date.now()): void {
    lobby.updatedAt = now;
    lobby.autoCloseAt = now + LOBBY_IDLE_AUTO_CLOSE_MS;
  }

  private markLobbyClosed(lobby: InternalLobby, now = Date.now()): void {
    lobby.status = "closed";
    lobby.currentRound = null;
    lobby.roll = null;
    lobby.rollRevealAt = null;
    lobby.updatedAt = now;
    lobby.autoCloseAt = now;
  }

  private async autoCloseLobby(lobby: InternalLobby, now = Date.now()): Promise<void> {
    if (isDraftCompleted(lobby)) {
      await this.syncPlayerResults(lobby);
    }

    this.markLobbyClosed(lobby, now);
    await this.persist();
    await this.removeSummary();
    this.broadcast(lobby);
  }

  private async loadLobby(): Promise<InternalLobby | null> {
    if (!this.lobby) {
      this.lobby = (await this.state.storage.get<InternalLobby>(LOBBY_STORAGE_KEY)) ?? null;
      if (this.lobby && this.normalizeLobbyTimers(this.lobby)) {
        await this.persist();
      }
    }

    return this.lobby;
  }

  private async requireLobby(): Promise<InternalLobby> {
    const lobby = await this.loadLobby();

    if (!lobby) {
      throw new Error("Lobby does not exist.");
    }

    if (lobby.status !== "closed" && lobby.autoCloseAt <= Date.now()) {
      await this.autoCloseLobby(lobby);
    }

    return lobby;
  }

  private async persist(): Promise<void> {
    if (this.lobby) {
      await this.state.storage.put(LOBBY_STORAGE_KEY, this.lobby);
      await this.scheduleNextAlarm();
    }
  }

  private normalizeLobbyTimers(lobby: InternalLobby): boolean {
    let changed = false;
    const timerFields = lobby as Partial<InternalLobby>;

    if (!Number.isFinite(timerFields.autoCloseAt)) {
      lobby.autoCloseAt = (Number.isFinite(lobby.updatedAt) ? lobby.updatedAt : Date.now()) + LOBBY_IDLE_AUTO_CLOSE_MS;
      changed = true;
    }

    if (timerFields.rollRevealAt === undefined) {
      lobby.rollRevealAt = null;
      changed = true;
    }

    return changed;
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (!this.lobby || this.lobby.status === "closed") {
      await this.state.storage.deleteAlarm();
      return;
    }

    const candidates = [this.lobby.autoCloseAt];
    if (this.lobby.rollRevealAt) {
      candidates.push(this.lobby.rollRevealAt);
    }

    await this.state.storage.setAlarm(Math.min(...candidates));
  }

  private async syncSummary(): Promise<void> {
    if (!this.lobby) {
      return;
    }

    if (isDraftCompleted(this.lobby)) {
      await this.syncPlayerResults(this.lobby);
    }

    if (this.lobby.status === "closed") {
      await this.removeSummary();
      return;
    }

    const registry = this.env.LOBBY_REGISTRY.get(this.env.LOBBY_REGISTRY.idFromName("global"));
    try {
      await registry.fetch("https://registry/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRegistryRecord(this.toPublicState(this.lobby, "")))
      });
    } catch {
      // Registry sync is best-effort; the lobby itself remains authoritative.
    }
  }

  private async syncPlayerResults(lobby: InternalLobby): Promise<void> {
    const results = getPlayers(lobby).map((player) => this.toStoredPlayerResult(lobby, player));
    const registry = this.env.LOBBY_REGISTRY.get(this.env.LOBBY_REGISTRY.idFromName("global"));

    try {
      await registry.fetch("https://registry/player-results/upsert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results })
      });
    } catch {
      // Result sync is best-effort; lobby results by ID remain authoritative.
    }
  }

  private async removeSummary(): Promise<void> {
    if (!this.lobby) {
      return;
    }

    const registry = this.env.LOBBY_REGISTRY.get(this.env.LOBBY_REGISTRY.idFromName("global"));
    try {
      await registry.fetch("https://registry/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: this.lobby.id })
      });
    } catch {
      // Registry sync is best-effort; the lobby itself remains authoritative.
    }
  }
}

function getStartBlockers(lobby: InternalLobby): string[] {
  const blockers: string[] = [];
  const players = getPlayers(lobby);

  if (players.length < 2) {
    blockers.push(`Нужно еще игроков: ${2 - players.length}.`);
  }

  if (players.length === 2 && players.some((player) => !player.connected)) {
    blockers.push("Оба игрока должны быть подключены.");
  }

  const validation = validateDraftConfig(
    lobby.settings.classCounts,
    lobby.settings.rounds,
    lobby.usedPairs
  );
  blockers.push(...validation.blockers);

  return blockers;
}

function getPlayers(lobby: InternalLobby): Participant[] {
  return lobby.playerOrder.map((playerId) => lobby.participants[playerId]).filter(Boolean);
}

function isDraftCompleted(lobby: InternalLobby): boolean {
  return (
    (lobby.status === "complete" || lobby.status === "closed") &&
    lobby.completedRounds.length >= lobby.settings.rounds
  );
}

function getLobbyCompletedAt(lobby: InternalLobby): number {
  return lobby.completedRounds.at(-1)?.completedAt ?? lobby.updatedAt;
}

function toSummary(state: PublicLobbyState): LobbySummary {
  const host = state.participants.find((participant) => participant.id === state.hostParticipantId);

  return {
    id: state.id,
    hostName: host?.name ?? "Unknown",
    creatorRole: state.settings.creatorRole,
    hasPassword: state.hasPassword,
    status: state.status,
    playerCount: state.players.length,
    requiredPlayers: state.requiredPlayers,
    rounds: state.settings.rounds,
    mirrorDraft: state.settings.mirrorDraft,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    autoCloseAt: state.autoCloseAt
  };
}

function toRegistryRecord(state: PublicLobbyState): RegistryLobbyRecord {
  return {
    ...toSummary(state),
    participantNames: state.participants.map((participant) => participant.name)
  };
}

function normalizeRegistryRecord(value: unknown, storageKey?: string): RegistryLobbyRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeLobbyId(value.id) ?? normalizeLobbyId(storageKey?.slice(REGISTRY_PREFIX.length));
  if (!id) {
    return null;
  }

  const participantNames = Array.isArray(value.participantNames)
    ? value.participantNames.map(cleanName).filter(Boolean)
    : [];
  const createdAt = finiteNumber(value.createdAt, Date.now());
  const updatedAt = finiteNumber(value.updatedAt, createdAt);
  const autoCloseAt = finiteNumber(value.autoCloseAt, updatedAt + LOBBY_IDLE_AUTO_CLOSE_MS);
  const status: LobbyStatus = isLobbyStatus(value.status) ? value.status : "waiting";
  const creatorRole: CreatorRole = value.creatorRole === "manager" ? "manager" : "player";

  return {
    id,
    hostName: cleanName(value.hostName) || participantNames[0] || "Unknown",
    creatorRole,
    hasPassword: value.hasPassword === true,
    status,
    playerCount: Math.max(0, Math.floor(finiteNumber(value.playerCount, 0))),
    requiredPlayers: Math.max(2, Math.floor(finiteNumber(value.requiredPlayers, 2))),
    rounds: Math.max(1, Math.floor(finiteNumber(value.rounds, 1))),
    mirrorDraft: value.mirrorDraft === true,
    createdAt,
    updatedAt,
    autoCloseAt,
    participantNames
  };
}

function normalizeLobbyId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const lobbyId = value.trim().toUpperCase();
  return LOBBY_ID_PATTERN.test(lobbyId) ? lobbyId : null;
}

function isLobbyStatus(value: unknown): value is LobbyStatus {
  return typeof value === "string" && LOBBY_STATUSES.has(value as LobbyStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toPublicSummary(record: RegistryLobbyRecord): LobbySummary {
  const { participantNames: _participantNames, ...summary } = record;
  return summary;
}

function getRegistryParticipantNames(record: RegistryLobbyRecord): string[] {
  return record.participantNames?.length ? record.participantNames : [record.hostName];
}

function toPublicPlayerResult(result: StoredPlayerResult): PublicResultsPlayer {
  return {
    name: result.name,
    classes: result.classes
  };
}

function getPlayerResultKey(name: string): string | null {
  const normalizedName = normalizeNameForLookup(name);
  return normalizedName ? `${PLAYER_RESULT_PREFIX}${normalizedName}` : null;
}

function getSummaryAutoCloseAt(summary: LobbySummary): number {
  return Number.isFinite(summary.autoCloseAt)
    ? summary.autoCloseAt
    : summary.updatedAt + LOBBY_IDLE_AUTO_CLOSE_MS;
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const expectedToken = env.ADMIN_TOKEN?.trim();
  if (!expectedToken) {
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const headerToken = request.headers.get("x-admin-token") ?? "";
  return bearerToken === expectedToken || headerToken === expectedToken;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Тело запроса должно быть валидным JSON.");
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

function normalizeNameForLookup(value: unknown): string {
  return cleanName(value).toLowerCase();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function randomLobbyId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";

  for (let i = 0; i < 6; i += 1) {
    id += alphabet[randomInt(0, alphabet.length - 1)];
  }

  return id;
}

function randomParticipantId(): string {
  return `p_${randomToken().slice(0, 16)}`;
}

function randomToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  const range = maxInclusive - minInclusive + 1;
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return minInclusive + (value[0] % range);
}
