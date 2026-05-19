import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_API_BASE = "https://mewgenics-draft-system.hulore.workers.dev";
const CONFIG_PATH = resolve(process.cwd(), ".admin.local.json");

const config = loadConfig();
const apiBase = (process.env.MEWGENICS_ADMIN_API_BASE ?? config.apiBase ?? DEFAULT_API_BASE).replace(
  /\/$/,
  ""
);
const adminToken = process.env.MEWGENICS_ADMIN_TOKEN ?? config.adminToken;
const [, , command, rawLobbyId] = process.argv;

if (!adminToken) {
  fail(
    [
      "Не найден admin token.",
      "Создай .admin.local.json рядом с package.json:",
      '{ "adminToken": "TOKEN_FROM_CLOUDFLARE", "apiBase": "https://mewgenics-draft-system.hulore.workers.dev" }'
    ].join("\n")
  );
}

if (!command || !["list", "close", "close-all"].includes(command)) {
  fail("Команды: npm run admin:lobbies | npm run admin:close -- LOBBYID | npm run admin:close-all");
}

try {
  if (command === "list") {
    const payload = await request("/api/admin/lobbies");
    printLobbies(payload.lobbies ?? []);
  }

  if (command === "close") {
    const lobbyId = normalizeLobbyId(rawLobbyId);
    if (!lobbyId) {
      fail("Укажи ID лобби: npm run admin:close -- ABC123");
    }

    const payload = await request(`/api/admin/lobbies/${lobbyId}/close`, { method: "POST" });
    const closed = payload.closed ?? [];
    console.log(closed.length > 0 ? `Закрыто лобби: ${closed.join(", ")}` : `Лобби ${lobbyId} не найдено.`);
  }

  if (command === "close-all") {
    const payload = await request("/api/admin/lobbies/close-all", { method: "POST" });
    const closed = payload.closed ?? [];
    console.log(
      closed.length > 0 ? `Закрыты лобби: ${closed.join(", ")}` : "Открытых/видимых лобби не найдено."
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(".admin.local.json не читается как JSON.");
  }
}

async function request(path, init = {}) {
  try {
    return await requestWithFetch(path, init);
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }

    return requestWithPowerShell(path, init);
  }
}

async function requestWithFetch(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: getHeaders(init.headers)
  });
  const payload = await readResponseJson(response.status, () => response.text());

  return payload;
}

function requestWithPowerShell(path, init = {}) {
  const method = init.method ?? "GET";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$headers = @{ Authorization = ('Bearer ' + $env:MEWGENICS_ADMIN_TOKEN); 'Content-Type' = 'application/json' }",
    "$response = Invoke-RestMethod -Uri $env:MEWGENICS_ADMIN_URL -Method $env:MEWGENICS_ADMIN_METHOD -Headers $headers",
    "$response | ConvertTo-Json -Depth 20 -Compress"
  ].join("; ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      MEWGENICS_ADMIN_TOKEN: adminToken,
      MEWGENICS_ADMIN_URL: `${apiBase}${path}`,
      MEWGENICS_ADMIN_METHOD: method
    }
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "PowerShell request failed.").trim());
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

async function readResponseJson(status, readText) {
  const text = await readText();
  const payload = text ? JSON.parse(text) : {};

  if (status < 200 || status >= 300) {
    throw new Error(payload.error ?? `HTTP ${status}`);
  }

  return payload;
}

function getHeaders(extraHeaders = {}) {
  return {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
    ...extraHeaders
  };
}

function printLobbies(lobbies) {
  if (lobbies.length === 0) {
    console.log("Лобби не найдены.");
    return;
  }

  console.table(
    lobbies.map((lobby) => ({
      id: lobby.id,
      host: lobby.hostName,
      status: lobby.status,
      players: `${lobby.playerCount}/${lobby.requiredPlayers}`,
      rounds: lobby.rounds,
      mirror: lobby.mirrorDraft ? "yes" : "no",
      password: lobby.hasPassword ? "yes" : "no"
    }))
  );
}

function normalizeLobbyId(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
