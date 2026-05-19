const SESSION_PREFIX = "mewgenics-draft-session:";

export function getStoredSession(lobbyId: string): string | null {
  return localStorage.getItem(`${SESSION_PREFIX}${lobbyId}`);
}

export function storeSession(lobbyId: string, sessionId: string): void {
  localStorage.setItem(`${SESSION_PREFIX}${lobbyId}`, sessionId);
}

export function clearStoredSession(lobbyId: string): void {
  localStorage.removeItem(`${SESSION_PREFIX}${lobbyId}`);
}

