import type {
  CreateLobbyRequest,
  CreateLobbyResponse,
  JoinLobbyRequest,
  JoinLobbyResponse,
  LobbySummary
} from "../shared/types";

interface LobbyListResponse {
  lobbies: LobbySummary[];
}

export async function fetchLobbies(): Promise<LobbySummary[]> {
  const payload = await api<LobbyListResponse>("/api/lobbies");
  return payload.lobbies;
}

export function createLobby(request: CreateLobbyRequest): Promise<CreateLobbyResponse> {
  return api<CreateLobbyResponse>("/api/lobbies", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function joinLobby(lobbyId: string, request: JoinLobbyRequest): Promise<JoinLobbyResponse> {
  return api<JoinLobbyResponse>(`/api/lobbies/${lobbyId}/join`, {
    method: "POST",
    body: JSON.stringify(request)
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

