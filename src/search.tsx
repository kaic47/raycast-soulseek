import { useEffect, useMemo, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  open,
  showToast,
} from "@raycast/api";
import {
  SearchResponse,
  SlskdFile,
  TransferState,
  checkConnection,
  createSearch,
  deleteSearch,
  getDownloadDir,
  getSearch,
  getSearchResponses,
  listDownloads,
  startDownload,
} from "./api/slskd";
import {
  QualityPrefs,
  SearchResult,
  flattenAndSort,
  formatDuration,
  formatQuality,
  formatSize,
  formatSpeed,
  getBasename,
} from "./utils/quality";

const TERMINAL: Set<TransferState> = new Set([
  "Completed", "Succeeded", "Cancelled", "TimedOut", "Errored", "Rejected", "Aborted",
]);

function progressBar(pct: number, width = 12): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function trackDownload(filename: string, toast: Toast): Promise<void> {
  const basename = getBasename(filename);
  const deadline = Date.now() + 15 * 60 * 1000; // give up after 15 min

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const transfers = await listDownloads();
      const t = transfers.find((x) => x.filename === filename || getBasename(x.filename) === basename);
      if (!t) continue;

      if (t.state === "InProgress") {
        const pct = Math.round(t.percentComplete);
        const speed = t.averageSpeed > 0 ? ` · ${formatSpeed(t.averageSpeed)}` : "";
        toast.message = `${progressBar(pct)} ${pct}%${speed}`;
      } else if (t.state === "Queued" || t.state === "Requested" || t.state === "Initializing") {
        toast.message = t.state === "Queued" ? "Waiting in peer's queue…" : "Connecting to peer…";
      } else if (t.state === "Completed" || t.state === "Succeeded") {
        toast.style = Toast.Style.Success;
        toast.title = "Download complete";
        toast.message = basename;
        return;
      } else if (TERMINAL.has(t.state)) {
        toast.style = Toast.Style.Failure;
        toast.title = "Download failed";
        toast.message = t.state;
        return;
      }
    } catch {
      // ignore transient polling errors
    }
  }
}

interface Preferences extends QualityPrefs {
  slskdUrl: string;
  apiKey: string;
}

function FileDetail({ result }: { result: SearchResult }) {
  const { file, username, uploadSpeed, freeUploadSlots, queueLength } = result;
  const markdown = `
# ${getBasename(file.filename)}

| Field | Value |
|---|---|
| Format | ${formatQuality(file)} |
| Size | ${formatSize(file.size)} |
| Duration | ${formatDuration(file.length) || "—"} |
| Path | \`${file.filename}\` |

## Source
| Field | Value |
|---|---|
| User | ${username} |
| Speed | ${formatSpeed(uploadSpeed)} |
| Free slots | ${freeUploadSlots} |
| Queue depth | ${queueLength} |
`;

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Download"
            icon={Icon.Download}
            onAction={async () => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Downloading…", message: getBasename(file.filename) });
              try {
                await startDownload(username, file);
                trackDownload(file.filename, toast);
              } catch (e) {
                toast.style = Toast.Style.Failure;
                toast.title = "Download failed";
                toast.message = String(e);
              }
            }}
          />
          <Action.CopyToClipboard title="Copy Filename" content={getBasename(file.filename)} shortcut={{ modifiers: ["cmd"], key: "c" }} />
          <Action.CopyToClipboard title="Copy Full Path" content={file.filename} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
          <Action
            title="Open Downloads Folder"
            icon={Icon.Folder}
            shortcut={{ modifiers: ["opt", "cmd"], key: "o" }}
            onAction={async () => { open(await getDownloadDir()); }}
          />
        </ActionPanel>
      }
    />
  );
}

export default function SearchCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [rawResponses, setRawResponses] = useState<SearchResponse[]>([]);

  const results: SearchResult[] = useMemo(
    () => flattenAndSort(rawResponses, prefs),
    [rawResponses, prefs.formatPreference, prefs.bestQuality, prefs.excludeFlac],
  );

  // Check connection on mount
  useEffect(() => {
    checkConnection().then(setConnected);
  }, []);

  // Search with cleanup on text change
  useEffect(() => {
    if (!searchText.trim()) {
      setRawResponses([]);
      setIsSearching(false);
      return;
    }
    if (!connected) return;

    // Set searching immediately so the UI doesn't flash "No results" during debounce
    setIsSearching(true);

    let cancelled = false;
    let searchId: string | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      setRawResponses([]);
      setIsSearching(true);

      try {
        const search = await createSearch(searchText);
        if (cancelled) {
          deleteSearch(search.id).catch(() => {});
          return;
        }
        searchId = search.id;

        poll = setInterval(async () => {
          if (cancelled || !searchId) return;
          try {
            const [state, responses] = await Promise.all([getSearch(searchId), getSearchResponses(searchId)]);
            if (!cancelled) setRawResponses(responses);
            if (state.state.includes("Completed") || state.state.includes("TimedOut") || state.state.includes("Cancelled")) {
              clearInterval(poll!);
              if (!cancelled) setIsSearching(false);
            }
          } catch {
            clearInterval(poll!);
            if (!cancelled) setIsSearching(false);
          }
        }, 500);
      } catch (e) {
        if (!cancelled) {
          setIsSearching(false);
          await showToast({ style: Toast.Style.Failure, title: "Search failed", message: String(e) });
        }
      }
    };

    const timer = setTimeout(run, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (searchId) deleteSearch(searchId).catch(() => {});
      // Don't reset isSearching here — new effect sets it to true immediately,
      // and the empty-text branch above handles the cleared-search case.
    };
  }, [searchText, connected]);

  if (connected === false) {
    return (
      <Detail
        markdown={`# Soulseek not connected\n\nThe **slskd** backend isn't running or isn't reachable.\n\nRun the **Setup Soulseek** command to install and configure it.`}
        actions={
          <ActionPanel>
            <Action
              title="Open Setup"
              icon={Icon.Gear}
              onAction={() => open("raycast://extensions/chmura/soulseek/setup")}
            />
          </ActionPanel>
        }
      />
    );
  }

  const displayedResults = results.slice(0, 300);

  return (
    <List
      isLoading={connected === null || isSearching}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search artist, album, or song…"
      throttle
    >
      {displayedResults.length === 0 && (
        isSearching ? (
          <List.EmptyView icon={Icon.Hourglass} title="Searching…" description="Results will appear as they arrive." />
        ) : searchText.trim() ? (
          <List.EmptyView icon={Icon.MagnifyingGlass} title="No results" description="Try different search terms or check your format preferences." />
        ) : (
          <List.EmptyView icon={Icon.Music} title="Search Soulseek" description="Type to search for artists, albums, or songs." />
        )
      )}

      {displayedResults.map((result, idx) => (
        <ResultItem key={`${result.username}-${result.file.filename}-${idx}`} result={result} />
      ))}
    </List>
  );
}

function ResultItem({ result }: { result: SearchResult }) {
  const { file, username, uploadSpeed } = result;

  const handleDownload = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Downloading…", message: getBasename(file.filename) });
    try {
      await startDownload(username, file);
      trackDownload(file.filename, toast);
    } catch (e) {
      toast.style = Toast.Style.Failure;
      toast.title = "Download failed";
      toast.message = String(e);
    }
  };

  return (
    <List.Item
      title={getBasename(file.filename)}
      subtitle={formatQuality(file)}
      accessories={[
        { text: formatSize(file.size), tooltip: "File size" },
        { text: username, tooltip: `${formatSpeed(uploadSpeed)} upload speed` },
      ]}
      actions={
        <ActionPanel>
          <Action title="Download" icon={Icon.Download} onAction={handleDownload} />
          <Action.Push
            title="Show Details"
            icon={Icon.Info}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
            target={<FileDetail result={result} />}
          />
          <Action.CopyToClipboard
            title="Copy Filename"
            content={getBasename(file.filename)}
            shortcut={{ modifiers: ["cmd"], key: "." }}
          />
          <Action
            title="Open Downloads Folder"
            icon={Icon.Folder}
            shortcut={{ modifiers: ["opt", "cmd"], key: "o" }}
            onAction={async () => { open(await getDownloadDir()); }}
          />
        </ActionPanel>
      }
    />
  );
}
