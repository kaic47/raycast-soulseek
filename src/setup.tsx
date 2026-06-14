import { exec } from "child_process";
import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { useEffect, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Toast,
  open,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import { checkConnection, getConnectionStatus, clearConnectionSettings, saveConnectionSettings } from "./api/slskd";
import { promisify } from "util";

const execAsync = promisify(exec);

type Screen = "checking" | "connected" | "wrong_key" | "not_connected" | "configure" | "installing" | "done" | "error";

interface InstallConfig {
  slskUser: string;
  slskPass: string;
  downloadDir: string;
}

// Escape a value for embedding in a YAML double-quoted string
function yamlStr(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

async function runInstall(config: InstallConfig, onStep: (msg: string) => void): Promise<string> {
  const home = homedir();
  const installDir = join(home, ".local", "share", "slskd");
  const configDir = join(home, ".config", "slskd");
  const launchAgentsDir = join(home, "Library", "LaunchAgents");
  const binary = join(installDir, "slskd");
  const configFile = join(configDir, "slskd.yml");
  const plistFile = join(launchAgentsDir, "com.slskd.slskd.plist");
  const logFile = join(configDir, "slskd.log");
  const errFile = join(configDir, "slskd.error.log");

  // Pre-check: if something is already on port 5030, don't try to install
  try {
    const probe = await fetch("http://127.0.0.1:5030/api/v0/application");
    if (probe.status === 401) {
      throw new Error(
        "slskd is already running on port 5030 but your API key doesn't match.\n\nClose this installer and use the 'Enter API Key' option instead.",
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("already running")) throw e;
    // connection refused = nothing on 5030, safe to proceed
  }

  // Step 1: detect arch
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  onStep(`✓ Architecture detected: ${arch}`);

  // Step 2: fetch latest version
  onStep("⏳ Fetching latest slskd version…");
  const versionRes = await fetch("https://api.github.com/repos/slskd/slskd/releases/latest");
  if (!versionRes.ok) throw new Error("Could not fetch slskd release info from GitHub");
  const versionData = (await versionRes.json()) as { tag_name: string };
  const version = versionData.tag_name;
  onStep(`✓ Latest version: ${version}`);

  // Step 3: download
  const zipUrl = `https://github.com/slskd/slskd/releases/download/${version}/slskd-${version}-osx-${arch}.zip`;
  const zipPath = join("/tmp", `slskd-${version}-osx-${arch}.zip`);
  onStep("⏳ Downloading slskd (~100 MB, this may take a minute)…");
  await execAsync(`curl -fsSL ${JSON.stringify(zipUrl)} -o ${JSON.stringify(zipPath)}`);
  onStep("✓ Download complete");

  // Step 4: extract
  onStep("⏳ Extracting binary…");
  await mkdir(installDir, { recursive: true });
  await execAsync(`unzip -o ${JSON.stringify(zipPath)} -d ${JSON.stringify(installDir)}`);
  onStep("✓ Binary extracted");

  // Step 5: permissions + quarantine
  await execAsync(`chmod +x ${JSON.stringify(binary)}`);
  await execAsync(`xattr -d com.apple.quarantine ${JSON.stringify(binary)}`).catch(() => {
    // quarantine attribute may not exist if already cleared
  });
  onStep("✓ Permissions set");

  // Step 6: generate API key
  const apiKey = randomBytes(16).toString("hex");

  // Step 7: create config dir and YAML
  onStep("⏳ Writing configuration…");
  await mkdir(configDir, { recursive: true });
  await mkdir(config.downloadDir, { recursive: true });

  const yaml = [
    "soulseek:",
    `  username: ${yamlStr(config.slskUser)}`,
    `  password: ${yamlStr(config.slskPass)}`,
    "directories:",
    `  downloads: ${yamlStr(config.downloadDir)}`,
    "web:",
    "  port: 5030",
    "  authentication:",
    "    apiKeys:",
    "      - name: raycast",
    `        key: ${yamlStr(apiKey)}`,
    '        cidr: "127.0.0.1/32"',
  ].join("\n");

  await writeFile(configFile, yaml + "\n", "utf-8");
  onStep("✓ Configuration written");

  // Step 8: create LaunchAgent
  onStep("⏳ Setting up auto-start…");
  await mkdir(launchAgentsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.slskd.slskd</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary}</string>
    <string>--config</string>
    <string>${configFile}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${errFile}</string>
</dict>
</plist>`;

  await writeFile(plistFile, plist, "utf-8");

  // Unload first in case a previous version is running
  await execAsync(`launchctl unload ${JSON.stringify(plistFile)}`).catch(() => {});
  await execAsync(`launchctl load -w ${JSON.stringify(plistFile)}`);
  onStep("✓ Auto-start configured (slskd will run on every login)");

  // Step 9: save credentials BEFORE the readiness check, so checkConnection()
  // authenticates with the key we just wrote into slskd.yml (otherwise the
  // check uses an empty key, slskd returns 401, and install wrongly fails).
  await saveConnectionSettings("http://127.0.0.1:5030", apiKey);

  // Step 10: wait for slskd to be ready
  onStep("⏳ Waiting for slskd to start…");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const up = await checkConnection();
    if (up) break;
  }
  const up = await checkConnection();
  if (!up) throw new Error("slskd started but isn't responding on http://127.0.0.1:5030. Check ~/.config/slskd/slskd.error.log for details.");

  onStep("✓ slskd is running");
  onStep("✓ Connected — you're all set!");

  return apiKey;
}

// ─── Sub-screens ───────────────────────────────────────────────────────────

function CheckingScreen() {
  return <Detail isLoading markdown="## Checking connection to slskd…" />;
}

function ConnectedScreen({ onReconfigure }: { onReconfigure: () => void }) {
  return (
    <Detail
      markdown={`# ✅ Soulseek is connected\n\nslskd is running and the Raycast extension is configured.\n\nYou can now use **Search Soulseek** to find and download music.\n\n---\n\n_To change your Soulseek credentials or download folder, click **Reconfigure**._`}
      actions={
        <ActionPanel>
          <Action
            title="Search Soulseek"
            icon={Icon.MagnifyingGlass}
            onAction={() => open("raycast://extensions/chmura/soulseek/search")}
          />
          <Action title="View Downloads" icon={Icon.Download} onAction={() => open("raycast://extensions/chmura/soulseek/downloads")} />
          <Action title="Reconfigure" icon={Icon.Gear} onAction={onReconfigure} />
          <Action title="Open Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} shortcut={{ modifiers: ["cmd"], key: "," }} />
        </ActionPanel>
      }
    />
  );
}

function NotConnectedScreen({ onInstall }: { onInstall: () => void }) {
  return (
    <Detail
      markdown={`# Soulseek Setup

This extension uses **slskd** — a lightweight background app that connects to the Soulseek network.

Click **Install slskd** below to automatically:
1. Download and install slskd (~100 MB)
2. Configure it with your Soulseek credentials
3. Set it to start automatically on login

---

**Don't have a Soulseek account?**
Create one free at [soulseek.org](https://www.soulseek.org) before continuing.`}
      actions={
        <ActionPanel>
          <Action title="Install slskd" icon={Icon.Download} onAction={onInstall} />
          <Action.OpenInBrowser title="Create Soulseek Account" url="https://www.soulseek.org" />
        </ActionPanel>
      }
    />
  );
}

interface ConfigureFormProps {
  onSubmit: (config: InstallConfig) => void;
}

function ConfigureForm({ onSubmit }: ConfigureFormProps) {
  const defaultDownload = join(homedir(), "Music", "Soulseek");
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Install slskd" icon={Icon.Download} onSubmit={(values) => onSubmit(values as InstallConfig)} />
          <Action.OpenInBrowser title="Create Soulseek Account" url="https://www.soulseek.org" />
        </ActionPanel>
      }
    >
      <Form.Description text="Enter your Soulseek credentials. slskd will be downloaded and configured automatically." />
      <Form.TextField id="slskUser" title="Soulseek Username" placeholder="your_username" />
      <Form.PasswordField id="slskPass" title="Soulseek Password" placeholder="••••••••" />
      <Form.FilePicker
        id="downloadDir"
        title="Download Folder"
        defaultValue={[defaultDownload]}
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
      />
      <Form.Separator />
      <Form.Description text="slskd will run quietly in the background and start automatically when you log in." />
    </Form>
  );
}

interface InstallingScreenProps {
  steps: string[];
  error: string | null;
  onRetry: () => void;
}

function InstallingScreen({ steps, error, onRetry }: InstallingScreenProps) {
  const stepsMarkdown = steps.map((s) => `- ${s}`).join("\n");
  const markdown = error
    ? `# ❌ Installation failed\n\n${stepsMarkdown}\n\n---\n\n**Error:** ${error}\n\nCheck your internet connection and Soulseek credentials, then try again.`
    : `# Installing slskd…\n\n${stepsMarkdown}`;

  return (
    <Detail
      isLoading={!error && !steps.some((s) => s.includes("you're all set"))}
      markdown={markdown}
      actions={
        error ? (
          <ActionPanel>
            <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={onRetry} />
            <Action
              title="Open Terminal"
              icon={Icon.Terminal}
              onAction={() => open("x-apple.systempreferences:")}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

interface WrongKeyScreenProps {
  onSubmit: (apiKey: string) => void;
}

function WrongKeyScreen({ onSubmit }: WrongKeyScreenProps) {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Connect"
            icon={Icon.Plug}
            onSubmit={(values: { apiKey: string }) => onSubmit(values.apiKey)}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="slskd is already running but the API key doesn't match. Enter the key from your slskd config (web.authentication.api_keys in slskd.yml)." />
      <Form.PasswordField id="apiKey" title="API Key" placeholder="paste your slskd API key here" />
    </Form>
  );
}

function DoneScreen() {
  return (
    <Detail
      markdown={`# 🎉 Setup complete!\n\nslskd is installed, running, and connected to Soulseek.\n\nYou're ready to search and download music.`}
      actions={
        <ActionPanel>
          <Action
            title="Search Soulseek"
            icon={Icon.MagnifyingGlass}
            onAction={() => open("raycast://extensions/chmura/soulseek/search")}
          />
          <Action title="View Downloads" icon={Icon.Download} onAction={() => open("raycast://extensions/chmura/soulseek/downloads")} />
        </ActionPanel>
      }
    />
  );
}

// ─── Main command ──────────────────────────────────────────────────────────

export default function SetupCommand() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<InstallConfig | null>(null);

  useEffect(() => {
    getConnectionStatus().then((status) => {
      if (status === "connected") setScreen("connected");
      else if (status === "wrong_key") setScreen("wrong_key");
      else setScreen("not_connected");
    });
  }, []);

  const addStep = (msg: string) => setSteps((prev) => [...prev, msg]);

  const startInstall = async (config: InstallConfig) => {
    setSteps([]);
    setError(null);
    setScreen("installing");

    try {
      await runInstall(config, addStep);
      setScreen("done");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSubmit = (config: InstallConfig) => {
    // FilePicker returns an array; unwrap the directory path
    const rawDir = config.downloadDir as unknown as string[];
    configRef.current = {
      ...config,
      downloadDir: Array.isArray(rawDir) ? rawDir[0] : config.downloadDir,
    };
    startInstall(configRef.current);
  };

  const handleReconfigure = async () => {
    await clearConnectionSettings();
    setScreen("not_connected");
  };

  const handleApiKeySubmit = async (apiKey: string) => {
    await saveConnectionSettings("http://127.0.0.1:5030", apiKey);
    const ok = await checkConnection();
    if (ok) setScreen("done");
    else {
      setError("That key didn't work. Double-check it in your slskd.yml under web.authentication.api_keys.");
      setScreen("error");
    }
  };

  const handleRetry = () => {
    if (configRef.current) {
      startInstall(configRef.current);
    } else {
      setScreen("not_connected");
    }
  };

  switch (screen) {
    case "checking":
      return <CheckingScreen />;
    case "connected":
      return <ConnectedScreen onReconfigure={handleReconfigure} />;
    case "wrong_key":
      return <WrongKeyScreen onSubmit={handleApiKeySubmit} />;
    case "not_connected":
      return <NotConnectedScreen onInstall={() => setScreen("configure")} />;
    case "configure":
      return <ConfigureForm onSubmit={handleSubmit} />;
    case "installing":
      return <InstallingScreen steps={steps} error={error} onRetry={handleRetry} />;
    case "done":
      return <DoneScreen />;
    case "error":
      return <InstallingScreen steps={steps} error={error} onRetry={handleRetry} />;
  }
}
