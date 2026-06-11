import { useEffect, useState } from "react";
import { Action, ActionPanel, Color, Icon, List, Toast, open, showToast } from "@raycast/api";
import { Transfer, TransferState, getDownloadDir, listDownloads } from "./api/slskd";
import { formatSize, formatSpeed, getBasename } from "./utils/quality";

const TERMINAL_STATES = new Set<TransferState>(["Completed", "Succeeded", "Cancelled", "TimedOut", "Errored", "Rejected", "Aborted"]);
const ACTIVE_STATES = new Set<TransferState>(["Requested", "Queued", "Initializing", "InProgress"]);

function stateColor(state: TransferState): Color {
  if (state === "InProgress" || state === "Initializing") return Color.Blue;
  if (state === "Completed" || state === "Succeeded") return Color.Green;
  if (state === "Queued" || state === "Requested") return Color.Yellow;
  return Color.Red;
}

function stateLabel(t: Transfer): string {
  if (t.state === "InProgress") return `${Math.round(t.percentComplete)}%`;
  if (t.state === "Queued") return "Queued";
  if (t.state === "Initializing") return "Connecting…";
  if (t.state === "Requested") return "Requested";
  if (t.state === "Completed" || t.state === "Succeeded") return "Done";
  return t.state;
}

export default function DownloadsCommand() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connected, setConnected] = useState(true);

  const refresh = async () => {
    try {
      const all = await listDownloads();
      setTransfers(all);
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    refresh();
  }, []);

  // Auto-refresh every 3s while there are active transfers
  useEffect(() => {
    const hasActive = transfers.some((t) => ACTIVE_STATES.has(t.state));
    if (!hasActive) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [transfers]);

  if (!connected && !isLoading) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Not connected to slskd"
          description="Run 'Setup Soulseek' to install and configure the backend."
          actions={
            <ActionPanel>
              <Action title="Open Setup" icon={Icon.Gear} onAction={() => open("raycast://extensions/chmura/soulseek/setup")} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const active = transfers.filter((t) => ACTIVE_STATES.has(t.state));
  const completed = transfers.filter((t) => t.state === "Completed" || t.state === "Succeeded");
  const failed = transfers.filter((t) => TERMINAL_STATES.has(t.state) && t.state !== "Completed" && t.state !== "Succeeded");

  const openFolderAction = (
    <Action
      title="Open Downloads Folder"
      icon={Icon.Folder}
      shortcut={{ modifiers: ["opt", "cmd"], key: "o" }}
      onAction={async () => { open(await getDownloadDir()); }}
    />
  );

  const refreshAction = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={{ modifiers: ["cmd"], key: "r" }}
      onAction={() => {
        setIsLoading(true);
        refresh();
      }}
    />
  );

  const renderItem = (t: Transfer) => (
    <List.Item
      key={t.id}
      title={getBasename(t.filename)}
      subtitle={
        t.state === "InProgress" && t.averageSpeed > 0
          ? `${formatSpeed(t.averageSpeed)} · ${t.username}`
          : t.username
      }
      accessories={[
        { tag: { value: stateLabel(t), color: stateColor(t.state) } },
        { text: formatSize(t.size), tooltip: "File size" },
      ]}
      actions={
        <ActionPanel>
          {refreshAction}
          {openFolderAction}
          <Action.CopyToClipboard title="Copy Filename" content={getBasename(t.filename)} />
          <Action.CopyToClipboard title="Copy Full Path" content={t.filename} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={isLoading} actions={<ActionPanel>{openFolderAction}{refreshAction}</ActionPanel>}>
      {active.length === 0 && completed.length === 0 && failed.length === 0 && !isLoading && (
        <List.EmptyView
          icon={Icon.Download}
          title="No downloads"
          description="Search for music and press Enter to download."
          actions={
            <ActionPanel>
              <Action title="Search Soulseek" icon={Icon.MagnifyingGlass} onAction={() => open("raycast://extensions/chmura/soulseek/search")} />
              {refreshAction}
            </ActionPanel>
          }
        />
      )}

      {active.length > 0 && <List.Section title="In Progress">{active.map(renderItem)}</List.Section>}
      {completed.length > 0 && <List.Section title="Completed">{completed.map(renderItem)}</List.Section>}
      {failed.length > 0 && <List.Section title="Failed / Cancelled">{failed.map(renderItem)}</List.Section>}
    </List>
  );
}
