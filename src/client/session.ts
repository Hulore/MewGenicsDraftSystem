const SESSION_PREFIX = "mewgenics-draft-session:";
const USER_NAME_KEY = "mewgenics-draft-user-name";

export function getStoredSession(lobbyId: string): string | null {
  return localStorage.getItem(`${SESSION_PREFIX}${lobbyId}`);
}

export function storeSession(lobbyId: string, sessionId: string): void {
  localStorage.setItem(`${SESSION_PREFIX}${lobbyId}`, sessionId);
}

export function clearStoredSession(lobbyId: string): void {
  localStorage.removeItem(`${SESSION_PREFIX}${lobbyId}`);
}

export function getStoredUserName(): string | null {
  const name = cleanUserName(sessionStorage.getItem(USER_NAME_KEY) ?? "");
  return name || null;
}

export function storeUserName(name: string): string {
  const cleaned = cleanUserName(name);

  if (cleaned) {
    sessionStorage.setItem(USER_NAME_KEY, cleaned);
  } else {
    sessionStorage.removeItem(USER_NAME_KEY);
  }

  return cleaned;
}

export function cleanUserName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}
