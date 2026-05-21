import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  Clipboard,
  Crown,
  Dice6,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  Unlock,
  User,
  Users,
  X
} from "lucide-react";
import { createLobby, fetchLobbies, joinLobby } from "./api";
import {
  cleanUserName,
  clearStoredSession,
  getStoredSession,
  getStoredUserName,
  storeSession,
  storeUserName
} from "./session";
import { DiceCanvas } from "./DiceCanvas";
import { CLASS_BY_ID, CLASS_DEFINITIONS, CLASS_IDS, type ClassId } from "../shared/classes";
import {
  MAX_CLASS_COUNT,
  MAX_ROUNDS,
  normalizeClassCounts,
  validateDraftConfig
} from "../shared/draftRules";
import type {
  ClassCounts,
  ClientMessage,
  CreatorRole,
  LobbySummary,
  Participant,
  PublicLobbyState,
  ServerMessage
} from "../shared/types";

const DEFAULT_COUNTS = Object.fromEntries(CLASS_IDS.map((classId) => [classId, 1])) as Record<
  ClassId,
  number
>;

export function App() {
  const [activeLobbyId, setActiveLobbyId] = useState(() => getLobbyIdFromUrl());
  const [userName, setUserName] = useState(() => getStoredUserName());
  const [editingUserName, setEditingUserName] = useState(false);

  useEffect(() => {
    const onPopState = () => setActiveLobbyId(getLobbyIdFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openLobby = useCallback((lobbyId: string) => {
    const normalized = lobbyId.trim().toUpperCase();
    window.history.pushState(null, "", `?lobby=${normalized}`);
    setActiveLobbyId(normalized);
  }, []);

  const closeLobby = useCallback(() => {
    window.history.pushState(null, "", window.location.pathname);
    setActiveLobbyId(null);
  }, []);

  const saveUserName = useCallback((nextName: string) => {
    const storedName = storeUserName(nextName);
    setUserName(storedName || null);
    setEditingUserName(false);
  }, []);

  if (!userName) {
    return <UserNameDialog onSave={saveUserName} />;
  }

  return (
    <>
      {activeLobbyId ? (
        <LobbyRoom
          lobbyId={activeLobbyId}
          userName={userName}
          onEditUserName={() => setEditingUserName(true)}
          onLeave={closeLobby}
        />
      ) : (
        <Dashboard
          userName={userName}
          onEditUserName={() => setEditingUserName(true)}
          onOpenLobby={openLobby}
        />
      )}

      {editingUserName && (
        <UserNameDialog
          initialName={userName}
          onCancel={() => setEditingUserName(false)}
          onSave={saveUserName}
        />
      )}
    </>
  );
}

function UserNameDialog({
  initialName = "",
  onCancel,
  onSave
}: {
  initialName?: string;
  onCancel?: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = cleanUserName(name);

    if (!cleaned) {
      setError("Укажи имя.");
      return;
    }

    onSave(cleaned);
  };

  return (
    <div
      className="modal-backdrop identity-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Имя пользователя"
      onMouseDown={onCancel}
    >
      <section className="panel identity-panel" onMouseDown={(event) => event.stopPropagation()}>
        {onCancel && (
          <button className="icon-button modal-close" onClick={onCancel} title="Закрыть">
            <X size={18} />
          </button>
        )}
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Игрок</p>
            <h2>Твоё имя</h2>
          </div>
          <User size={24} />
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Имя
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              placeholder="Player"
            />
          </label>
          {error && <div className="notice is-error">{error}</div>}
          <button className="primary-button">
            <User size={18} />
            Сохранить имя
          </button>
        </form>
      </section>
    </div>
  );
}

function Dashboard({
  userName,
  onEditUserName,
  onOpenLobby
}: {
  userName: string;
  onEditUserName: () => void;
  onOpenLobby: (lobbyId: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = useCallback(
    (lobbyId: string) => {
      setCreateOpen(false);
      onOpenLobby(lobbyId);
    },
    [onOpenLobby]
  );

  useEffect(() => {
    if (!createOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createOpen]);

  return (
    <main className="shell dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mewgenics</p>
          <h1>Draft System</h1>
        </div>
        <div className="topbar-actions">
          <UserBadge userName={userName} onEdit={onEditUserName} />
          <button className="primary-button create-toggle" onClick={() => setCreateOpen(true)}>
            <Plus size={18} />
            Создать лобби
          </button>
          <div className="brand-mark">
            <Swords size={28} />
          </div>
        </div>
      </header>

      <div className="dashboard-column">
        <LobbyBrowser onOpenLobby={onOpenLobby} />
      </div>

      {createOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Создание лобби"
          onMouseDown={() => setCreateOpen(false)}
        >
          <div className="create-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <button className="icon-button modal-close" onClick={() => setCreateOpen(false)} title="Закрыть">
              <X size={18} />
            </button>
            <CreateLobbyPanel userName={userName} onCreated={handleCreated} />
          </div>
        </div>
      )}
    </main>
  );
}

function UserBadge({ userName, onEdit }: { userName: string; onEdit: () => void }) {
  return (
    <button className="user-badge" onClick={onEdit} title="Изменить имя">
      <User size={16} />
      <span>Ты</span>
      <strong>{userName}</strong>
    </button>
  );
}

function CreateLobbyPanel({
  userName,
  onCreated
}: {
  userName: string;
  onCreated: (lobbyId: string) => void;
}) {
  const [creatorRole, setCreatorRole] = useState<CreatorRole>("player");
  const [password, setPassword] = useState("");
  const [rounds, setRounds] = useState(5);
  const [mirrorDraft, setMirrorDraft] = useState(false);
  const [classCounts, setClassCounts] = useState<Record<ClassId, number>>(DEFAULT_COUNTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(
    () => validateDraftConfig(classCounts, rounds),
    [classCounts, rounds]
  );
  const totalCopies = CLASS_IDS.reduce((sum, classId) => sum + classCounts[classId], 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!validation.ok) {
      setError(validation.blockers[0]);
      return;
    }

    setSubmitting(true);
    try {
      const response = await createLobby({
        creatorName: userName,
        creatorRole,
        password: password.trim() || undefined,
        rounds,
        mirrorDraft,
        classCounts
      });
      storeSession(response.lobbyId, response.sessionId);
      onCreated(response.lobbyId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать лобби.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel create-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Новое лобби</p>
          <h2>Настройка драфта</h2>
        </div>
        <div className="metric">
          <span>{totalCopies}</span>
          <small>копий</small>
        </div>
      </div>

      <form onSubmit={submit} className="form-stack">
        <div className="segmented" aria-label="Creator role">
          <button
            type="button"
            className={creatorRole === "player" ? "is-selected" : ""}
            onClick={() => setCreatorRole("player")}
          >
            <User size={18} />
            Игрок
          </button>
          <button
            type="button"
            className={creatorRole === "manager" ? "is-selected" : ""}
            onClick={() => setCreatorRole("manager")}
          >
            <ShieldCheck size={18} />
            Менеджер
          </button>
        </div>

        <div className="two-fields">
          <div className="identity-field">
            <span>{creatorRole === "manager" ? "Менеджер" : "Игрок"}</span>
            <strong>{userName}</strong>
          </div>
          <label>
            Пароль
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="необязательно"
              maxLength={32}
            />
          </label>
        </div>

        <div className="draft-options">
          <label>
            Раунды
            <input
              type="number"
              min={1}
              max={MAX_ROUNDS}
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
            />
          </label>

          <label className="toggle-row">
            <span>
              <strong>Mirror Draft</strong>
              <small>выбранный класс получает каждый игрок</small>
            </span>
            <input
              type="checkbox"
              checked={mirrorDraft}
              onChange={(event) => setMirrorDraft(event.target.checked)}
            />
          </label>
        </div>

        <ClassConfigurator counts={classCounts} onChange={setClassCounts} />

        {validation.blockers.length > 0 && (
          <div className="notice is-warning">{validation.blockers[0]}</div>
        )}
        {error && <div className="notice is-error">{error}</div>}

        <button className="primary-button" disabled={submitting || !validation.ok}>
          <Play size={18} />
          {submitting ? "Создание..." : "Создать лобби"}
        </button>
      </form>
    </section>
  );
}

function ClassConfigurator({
  counts,
  onChange
}: {
  counts: Record<ClassId, number>;
  onChange: (counts: Record<ClassId, number>) => void;
}) {
  const updateCount = (classId: ClassId, value: number) => {
    onChange({
      ...counts,
      [classId]: Math.max(0, Math.min(MAX_CLASS_COUNT, Math.floor(value) || 0))
    });
  };

  return (
    <div className="class-config-grid">
      {CLASS_DEFINITIONS.map((classInfo) => {
        const count = counts[classInfo.id];
        const enabled = count > 0;

        return (
          <div className={`class-config-item ${enabled ? "is-enabled" : ""}`} key={classInfo.id}>
            <button
              type="button"
              className="class-toggle"
              onClick={() => updateCount(classInfo.id, enabled ? 0 : 1)}
              title={enabled ? "Выключить класс" : "Включить класс"}
            >
              <img src={classInfo.icon} alt="" />
            </button>
            <span>{classInfo.name}</span>
            <input
              aria-label={`${classInfo.name} count`}
              type="number"
              min={0}
              max={MAX_CLASS_COUNT}
              value={count}
              onChange={(event) => updateCount(classInfo.id, Number(event.target.value))}
            />
          </div>
        );
      })}
    </div>
  );
}

function LobbyBrowser({ onOpenLobby }: { onOpenLobby: (lobbyId: string) => void }) {
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLobbies(await fetchLobbies());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить лобби.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return normalized ? lobbies.filter((lobby) => lobby.id.includes(normalized)) : lobbies;
  }, [lobbies, query]);

  return (
    <section className="panel browser-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Публичный список</p>
          <h2>Лобби</h2>
        </div>
        <button className="icon-button" onClick={() => void load()} title="Обновить">
          <RefreshCw size={18} className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      <label className="search-field">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по ID"
        />
      </label>

      {error && <div className="notice is-error">{error}</div>}

      <div className="lobby-list">
        {filtered.map((lobby) => (
          <button className="lobby-row" key={lobby.id} onClick={() => onOpenLobby(lobby.id)}>
            <div>
              <strong>{lobby.id}</strong>
              <span>{lobby.hostName}</span>
            </div>
            <div className="lobby-tags">
              <span>{statusLabel(lobby.status)}</span>
              <span>
                {lobby.playerCount}/{lobby.requiredPlayers}
              </span>
              <span>{lobby.mirrorDraft ? "Mirror" : "Split"}</span>
              {lobby.hasPassword ? <Lock size={15} /> : <Unlock size={15} />}
            </div>
          </button>
        ))}
        {!loading && filtered.length === 0 && <div className="empty-state">Лобби не найдены.</div>}
      </div>
    </section>
  );
}

function LobbyRoom({
  lobbyId,
  userName,
  onEditUserName,
  onLeave
}: {
  lobbyId: string;
  userName: string;
  onEditUserName: () => void;
  onLeave: () => void;
}) {
  const [sessionId, setSessionId] = useState(() => getStoredSession(lobbyId));

  const handleJoined = (nextSessionId: string) => {
    storeSession(lobbyId, nextSessionId);
    setSessionId(nextSessionId);
  };

  const resetSession = () => {
    clearStoredSession(lobbyId);
    setSessionId(null);
  };

  if (!sessionId) {
    return (
      <main className="shell room-shell">
        <RoomHeader
          lobbyId={lobbyId}
          userName={userName}
          onEditUserName={onEditUserName}
          onLeave={onLeave}
        />
        <JoinPanel lobbyId={lobbyId} userName={userName} onJoined={handleJoined} />
      </main>
    );
  }

  return (
    <ConnectedLobbyRoom
      lobbyId={lobbyId}
      sessionId={sessionId}
      userName={userName}
      onEditUserName={onEditUserName}
      onLeave={onLeave}
      onResetSession={resetSession}
    />
  );
}

function ConnectedLobbyRoom({
  lobbyId,
  sessionId,
  userName,
  onEditUserName,
  onLeave,
  onResetSession
}: {
  lobbyId: string;
  sessionId: string;
  userName: string;
  onEditUserName: () => void;
  onLeave: () => void;
  onResetSession: () => void;
}) {
  const { state, send, connected, error } = useLobbySocket(lobbyId, sessionId);
  const viewerName =
    state?.participants.find((participant) => participant.id === state.viewerParticipantId)?.name ?? userName;

  return (
    <main className="shell room-shell">
      <RoomHeader
        lobbyId={lobbyId}
        userName={viewerName}
        onEditUserName={onEditUserName}
        onLeave={onLeave}
        connected={connected}
      />

      {error && (
        <div className="notice is-error room-notice">
          {error}
          <button onClick={onResetSession}>Войти заново</button>
        </div>
      )}

      {!state && <div className="panel loading-panel">Подключение к лобби...</div>}

      {state?.status === "waiting" && <WaitingLobby state={state} send={send} />}
      {state?.status === "rolling" && <RollStage state={state} send={send} />}
      {state?.status === "drafting" && <DraftStage state={state} send={send} />}
      {state?.status === "complete" && <ResultsStage state={state} send={send} />}
      {state?.status === "closed" && <ClosedLobby state={state} onLeave={onLeave} />}
    </main>
  );
}

function RoomHeader({
  lobbyId,
  userName,
  onEditUserName,
  onLeave,
  connected
}: {
  lobbyId: string;
  userName: string;
  onEditUserName: () => void;
  onLeave: () => void;
  connected?: boolean;
}) {
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?lobby=${lobbyId}`);
  };

  return (
    <header className="topbar room-topbar">
      <button className="icon-button" onClick={onLeave} title="Назад">
        <ChevronLeft size={20} />
      </button>
      <div>
        <p className="eyebrow">Lobby ID</p>
        <h1>{lobbyId}</h1>
      </div>
      <button className="icon-button" onClick={() => void copyLink()} title="Скопировать ссылку">
        <Clipboard size={18} />
      </button>
      <UserBadge userName={userName} onEdit={onEditUserName} />
      {connected !== undefined && (
        <span className={`connection-dot ${connected ? "is-online" : ""}`}>
          {connected ? "online" : "offline"}
        </span>
      )}
    </header>
  );
}

function JoinPanel({
  lobbyId,
  userName,
  onJoined
}: {
  lobbyId: string;
  userName: string;
  onJoined: (sessionId: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setSubmitting(true);
    try {
      const response = await joinLobby(lobbyId, {
        playerName: userName,
        password: password.trim() || undefined
      });
      onJoined(response.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти в лобби.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel join-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Вход</p>
          <h2>Присоединиться к лобби</h2>
        </div>
        <Users size={24} />
      </div>

      <form onSubmit={submit} className="form-stack">
        <div className="identity-field">
          <span>Игрок</span>
          <strong>{userName}</strong>
        </div>
        <label>
          Пароль
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={32}
            placeholder="если есть"
          />
        </label>

        {error && <div className="notice is-error">{error}</div>}

        <button className="primary-button" disabled={submitting}>
          <Users size={18} />
          {submitting ? "Вход..." : "Войти"}
        </button>
      </form>
    </section>
  );
}

function WaitingLobby({
  state,
  send
}: {
  state: PublicLobbyState;
  send: (message: ClientMessage) => void;
}) {
  const host = state.participants.find((participant) => participant.id === state.hostParticipantId);
  const viewerIsHost = state.viewerParticipantId === state.hostParticipantId;

  return (
    <div className="room-grid">
      <section className="panel roster-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{state.settings.creatorRole === "manager" ? "Менеджер" : "Игрок-хост"}</p>
            <h2>{host?.name ?? "Host"}</h2>
          </div>
          <Crown size={24} />
        </div>

        <div className="players-grid">
          {[0, 1].map((index) => {
            const player = state.players[index];
            return (
              <div className="player-slot" key={index}>
                <span>Player {index + 1}</span>
                <strong>{player?.name ?? "Ожидание..."}</strong>
                {player && <small>{player.connected ? "online" : "offline"}</small>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel settings-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Draft</p>
            <h2>{state.settings.rounds} раундов</h2>
          </div>
          <span className="mode-pill">{state.settings.mirrorDraft ? "Mirror" : "Split"}</span>
        </div>

        <PoolPreview counts={state.settings.classCounts} />

        {state.startBlockers.length > 0 && (
          <div className="notice is-warning">{state.startBlockers[0]}</div>
        )}

        {viewerIsHost && (
          <div className="lobby-actions">
            <button
              className="primary-button"
              disabled={!state.canStart}
              onClick={() => send({ type: "startDraft" })}
            >
              <Play size={18} />
              Начать драфт
            </button>
            <button className="danger-button" onClick={() => send({ type: "closeLobby" })}>
              <X size={18} />
              Закрыть лобби
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function PoolPreview({ counts }: { counts: ClassCounts }) {
  const normalized = normalizeClassCounts(counts);

  return (
    <div className="pool-preview">
      {CLASS_DEFINITIONS.filter((classInfo) => normalized[classInfo.id] > 0).map((classInfo) => (
        <div className="mini-class" key={classInfo.id}>
          <img src={classInfo.icon} alt="" />
          <span>{normalized[classInfo.id]}</span>
        </div>
      ))}
    </div>
  );
}

function DraftStage({
  state,
  send
}: {
  state: PublicLobbyState;
  send: (message: ClientMessage) => void;
}) {
  const currentRound = state.currentRound;
  const chooser = state.players.find((player) => player.id === currentRound?.chooserId);
  const viewerIsChooser = state.viewerParticipantId === currentRound?.chooserId;

  if (!currentRound) {
    return <div className="panel loading-panel">Подготовка раунда...</div>;
  }

  return (
    <div className="draft-layout">
      <PlayerPools state={state} />

      <section className="draft-stage">
        <div className="round-meta">
          <span>
            Раунд {currentRound.index + 1}/{state.settings.rounds}
          </span>
          <strong>{viewerIsChooser ? "Твой выбор" : `Выбирает ${chooser?.name ?? "игрок"}`}</strong>
        </div>

        <div className="class-offer-row">
          {currentRound.pair.map((classId, index) => {
            const classInfo = CLASS_BY_ID[classId];
            return (
              <button
                className="offer-card"
                key={`${currentRound.index}-${classId}`}
                disabled={!viewerIsChooser}
                onClick={() => send({ type: "chooseClass", classId })}
                style={{ animationDelay: `${index * 110}ms` }}
              >
                <img src={classInfo.icon} alt="" />
                <span>{classInfo.name}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RollStage({
  state,
  send
}: {
  state: PublicLobbyState;
  send: (message: ClientMessage) => void;
}) {
  const roll = state.roll;
  if (!roll) {
    return <div className="panel loading-panel">Подготовка броска...</div>;
  }

  const viewerRoll = state.viewerParticipantId
    ? roll.currentRolls[state.viewerParticipantId]
    : undefined;
  const viewerCanRoll =
    Boolean(state.viewerParticipantId) &&
    state.players.some((player) => player.id === state.viewerParticipantId) &&
    viewerRoll === undefined;
  const latestAttempt = roll.history[roll.history.length - 1];
  const waitingForFinalRound = Boolean(latestAttempt?.winnerId && !latestAttempt.tied);

  return (
    <div className="roll-layout">
      <section className="panel roll-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Последний раунд</p>
            <h2>Бросок d6</h2>
          </div>
          <Dice6 size={26} />
        </div>

        <div className="dice-grid">
          {state.players.map((player) => {
            const value = roll.currentRolls[player.id] ?? null;
            return (
              <div className="dice-player" key={player.id}>
                <strong>{player.name}</strong>
                <DiceCanvas
                  value={value}
                  token={`${roll.attempt}-${player.id}-${value ?? "pending"}`}
                  active={value === null}
                />
                <span>{value === null ? "ожидает" : `выпало ${value}`}</span>
              </div>
            );
          })}
        </div>

        {viewerCanRoll && (
          <button className="primary-button" onClick={() => send({ type: "rollDie" })}>
            <Dice6 size={18} />
            Бросить кубик
          </button>
        )}

        {waitingForFinalRound && (
          <div className="notice is-info">
            Кубики упали. Последний раунд начнется через мгновение.
          </div>
        )}

        {roll.history.length > 0 && (
          <div className="roll-history">
            {roll.history.map((attempt) => (
              <span key={attempt.attempt}>
                Попытка {attempt.attempt}:{" "}
                {attempt.tied
                  ? "ничья"
                  : `победил ${
                      state.players.find((player) => player.id === attempt.winnerId)?.name ?? "игрок"
                    }`}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ResultsStage({
  state,
  send
}: {
  state: PublicLobbyState;
  send: (message: ClientMessage) => void;
}) {
  const viewerIsHost = state.viewerParticipantId === state.hostParticipantId;

  return (
    <div className="results-layout">
      <section className="panel results-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Итог</p>
            <h2>Пулы игроков</h2>
          </div>
          <Swords size={24} />
        </div>
        <PlayerPools state={state} expanded />
        {viewerIsHost && (
          <div className="results-actions">
            <button className="danger-button" onClick={() => send({ type: "closeLobby" })}>
              <X size={18} />
              Закрыть лобби
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ClosedLobby({
  state,
  onLeave
}: {
  state: PublicLobbyState;
  onLeave: () => void;
}) {
  const host = state.participants.find((participant) => participant.id === state.hostParticipantId);

  return (
    <div className="results-layout">
      <section className="panel closed-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Lobby closed</p>
            <h2>{state.id}</h2>
          </div>
          <X size={24} />
        </div>
        <p>{host?.name ?? "Создатель"} закрыл лобби.</p>
        <button className="primary-button" onClick={onLeave}>
          <ChevronLeft size={18} />
          К списку лобби
        </button>
      </section>
    </div>
  );
}

function PlayerPools({ state, expanded = false }: { state: PublicLobbyState; expanded?: boolean }) {
  return (
    <aside className={`pool-board ${expanded ? "is-expanded" : ""}`}>
      {state.players.map((player) => (
        <section className="pool-column" key={player.id}>
          <div>
            <span>Player {player.slot}</span>
            <strong>{player.name}</strong>
          </div>
          <div className="pool-icons">
            {(state.playerPools[player.id] ?? []).map((classId, index) => {
              const classInfo = CLASS_BY_ID[classId];
              return (
                <img
                  key={`${player.id}-${classId}-${index}`}
                  src={classInfo.icon}
                  alt={classInfo.name}
                  title={classInfo.name}
                />
              );
            })}
            {(state.playerPools[player.id] ?? []).length === 0 && <span>Пусто</span>}
          </div>
        </section>
      ))}
    </aside>
  );
}

function useLobbySocket(lobbyId: string, sessionId: string) {
  const [state, setState] = useState<PublicLobbyState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(
        `${protocol}://${window.location.host}/api/lobbies/${lobbyId}/ws?sessionId=${encodeURIComponent(
          sessionId
        )}`
      );
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnected(true);
        setError(null);
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "state") {
          setState(message.state);
        } else {
          setError(message.message);
        }
      });

      socket.addEventListener("close", () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer.current = window.setTimeout(connect, 1500);
        }
      });

      socket.addEventListener("error", () => {
        setConnected(false);
        setError("Соединение потеряно.");
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current);
      }
      socketRef.current?.close();
    };
  }, [lobbyId, sessionId]);

  const send = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { state, connected, error, send };
}

function statusLabel(status: PublicLobbyState["status"] | LobbySummary["status"]): string {
  if (status === "waiting") return "Ожидание";
  if (status === "rolling") return "Кубик";
  if (status === "drafting") return "Драфт";
  if (status === "closed") return "Закрыто";
  return "Итог";
}

function getLobbyIdFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get("lobby");
  return value ? value.toUpperCase() : null;
}
