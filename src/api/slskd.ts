import { LocalStorage, getPreferenceValues } from "@raycast/api";

interface Preferences {
  slskdUrl: string;
  apiKey: string;
  formatPreference: string;
  bestQuality: boolean;
  excludeFlac: boolean;
}

export interface SlskdFile {
  filename: string;
  size: number;
  extension: string;
  bitRate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  length: number | null;
  isLocked?: boolean;
}

export interface SearchResponse {
  username: string;
  uploadSpeed: number;
  freeUploadSlots: number;
  queueLength: number;
  files: SlskdFile[];
}

export interface SearchState {
  id: string;
  state: string; // compound flags e.g. "Completed, ResponseLimitReached"
  searchText: string;
  fileCount: number;
  responseCount: number;
}

export type TransferState =
  | "Requested"
  | "Queued"
  | "Initializing"
  | "InProgress"
  | "Completed"
  | "Succeeded"
  | "Cancelled"
  | "TimedOut"
  | "Errored"
  | "Rejected"
  | "Aborted";

export interface Transfer {
  id: string;
  username: string;
  filename: string;
  state: TransferState;
  size: number;
  bytesTransferred: number;
  percentComplete: number;
  averageSpeed: number;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

async function getConfig(): Promise<{ url: string; apiKey: string }> {
  const prefs = getPreferenceValues<Preferences>();
  const storedKey = await LocalStorage.getItem<string>("slskd_api_key");
  const storedUrl = await LocalStorage.getItem<string>("slskd_url");
  return {
    url: storedUrl || prefs.slskdUrl || "http://localhost:5030",
    apiKey: storedKey || prefs.apiKey || "",
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, apiKey } = await getConfig();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`slskd ${method} ${path} → ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type ConnectionStatus = "connected" | "wrong_key" | "not_running";

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const { url, apiKey } = await getConfig();
  try {
    const res = await fetch(`${url}/api/v0/application`, {
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    });
    if (res.ok) return "connected";
    // 401 means slskd IS running but the key is wrong (or missing)
    if (res.status === 401) return "wrong_key";
    return "not_running";
  } catch {
    return "not_running";
  }
}

export async function checkConnection(): Promise<boolean> {
  return (await getConnectionStatus()) === "connected";
}

export async function createSearch(searchText: string): Promise<SearchState> {
  return request("POST", "/api/v0/searches", {
    searchText,
    fileLimit: 5000,
    responseLimit: 100,
    searchTimeout: 5000,
    filterResponses: true,
    minimumPeerUploadSpeed: 0,
    maximumPeerQueueLength: 1000000,
  });
}

export async function getSearch(id: string): Promise<SearchState> {
  return request("GET", `/api/v0/searches/${id}`);
}

export async function getSearchResponses(id: string): Promise<SearchResponse[]> {
  return request("GET", `/api/v0/searches/${id}/responses`);
}

export async function deleteSearch(id: string): Promise<void> {
  return request("DELETE", `/api/v0/searches/${id}`);
}

export async function startDownload(username: string, file: SlskdFile): Promise<void> {
  return request("POST", `/api/v0/transfers/downloads/${encodeURIComponent(username)}`, [
    { filename: file.filename, size: file.size },
  ]);
}

// slskd state is a flags enum serialized as "Flag1, Flag2" (e.g. "Completed, Succeeded")
function normalizeTransferState(raw: string): TransferState {
  const flags = raw.split(/,\s*/);
  const priority: TransferState[] = [
    "InProgress", "Initializing", "Queued", "Requested",
    "Succeeded", "Errored", "Cancelled", "TimedOut", "Rejected", "Aborted", "Completed",
  ];
  for (const flag of priority) {
    if (flags.includes(flag)) return flag;
  }
  return raw as TransferState;
}

interface RawTransfer extends Omit<Transfer, "state"> { state: string; }
interface SlskdDownloadEntry { username: string; directories: Array<{ files: RawTransfer[] }>; }

export async function listDownloads(): Promise<Transfer[]> {
  // API returns Array<{username, directories:[{files:[Transfer]}]}> — flatten it
  const result = await request<SlskdDownloadEntry[] | RawTransfer[] | Record<string, RawTransfer[]>>(
    "GET", "/api/v0/transfers/downloads?includeRemoved=true"
  );
  let raw: RawTransfer[];
  if (Array.isArray(result)) {
    raw = result.length > 0 && "directories" in result[0]
      ? (result as SlskdDownloadEntry[]).flatMap((e) => e.directories.flatMap((d) => d.files))
      : (result as RawTransfer[]);
  } else {
    raw = Object.values(result).flat();
  }
  return raw.map((t) => ({ ...t, state: normalizeTransferState(t.state) }));
}

export async function saveConnectionSettings(url: string, apiKey: string): Promise<void> {
  await LocalStorage.setItem("slskd_url", url);
  await LocalStorage.setItem("slskd_api_key", apiKey);
}

export async function clearConnectionSettings(): Promise<void> {
  await LocalStorage.removeItem("slskd_url");
  await LocalStorage.removeItem("slskd_api_key");
}

export async function getDownloadDir(): Promise<string> {
  const opts = await request<{ directories?: { downloads?: string } }>("GET", "/api/v0/options");
  return opts?.directories?.downloads ?? "~/Downloads";
}
