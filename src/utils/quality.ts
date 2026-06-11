import { SearchResponse, SlskdFile } from "../api/slskd";

export interface SearchResult {
  username: string;
  uploadSpeed: number;
  freeUploadSlots: number;
  queueLength: number;
  file: SlskdFile;
}

export interface QualityPrefs {
  formatPreference: string;
  bestQuality: boolean;
  excludeFlac: boolean;
}

const LOSSLESS = new Set(["FLAC", "WAV", "AIFF", "APE", "ALAC", "WV", "TTA", "DSF", "DFF"]);
const BEST_QUALITY_ORDER = ["FLAC", "WAV", "AIFF", "APE", "ALAC", "MP3", "AAC", "OGG", "M4A", "OPUS", "WMA"];

export function getFormatOrder(prefs: QualityPrefs): string[] {
  const order = prefs.bestQuality
    ? BEST_QUALITY_ORDER
    : prefs.formatPreference
        .split(",")
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean);
  return prefs.excludeFlac ? order.filter((f) => !LOSSLESS.has(f)) : order;
}

function scoreResult(result: SearchResult, formatOrder: string[]): number {
  const ext = normalizeExt(result.file.extension);
  const rank = formatOrder.indexOf(ext);
  // Each rank step dominates all quality differences
  const formatScore = (rank === -1 ? 999 : rank) * -1e10;

  const qualityScore = LOSSLESS.has(ext)
    ? (result.file.sampleRate ?? 0) * 100 + (result.file.bitDepth ?? 0) * 10
    : (result.file.bitRate ?? 0);

  // Upload speed as tiebreaker (normalize to MB/s)
  const speedScore = result.uploadSpeed / 1e6;

  return formatScore + qualityScore + speedScore;
}

export function flattenAndSort(responses: SearchResponse[], prefs: QualityPrefs): SearchResult[] {
  const formatOrder = getFormatOrder(prefs);
  const flat: SearchResult[] = [];

  for (const resp of responses) {
    for (const file of resp.files ?? []) {
      if (file.isLocked) continue;
      if (prefs.excludeFlac && LOSSLESS.has(normalizeExt(file.extension))) continue;
      flat.push({
        username: resp.username,
        uploadSpeed: resp.uploadSpeed,
        freeUploadSlots: resp.freeUploadSlots,
        queueLength: resp.queueLength,
        file,
      });
    }
  }

  return flat.sort((a, b) => scoreResult(b, formatOrder) - scoreResult(a, formatOrder));
}

export function normalizeExt(ext: string | null | undefined): string {
  return (ext ?? "").toUpperCase().replace(/^\./, "");
}

export function getBasename(windowsPath: string): string {
  return windowsPath.split(/[\\/]/).filter(Boolean).pop() ?? windowsPath;
}

export function formatQuality(file: SlskdFile): string {
  const ext = normalizeExt(file.extension);
  if (LOSSLESS.has(ext)) {
    const parts: string[] = [ext];
    if (file.bitDepth) parts.push(`${file.bitDepth}-bit`);
    if (file.sampleRate) parts.push(`${(file.sampleRate / 1000).toFixed(1)}kHz`);
    return parts.join(" ");
  }
  const parts: string[] = [ext || "?"];
  if (file.bitRate) parts.push(`${file.bitRate}kbps`);
  return parts.join(" ");
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1e3)} KB/s`;
}
