import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import * as z from "zod/mini";
import { credentialsFileSchema } from "./schemas.js";

export interface CredentialSources {
  env: Record<string, string | undefined>;
  readKeychain(): string | undefined;
  readSecretTool(): string | undefined;
  readCredentialsFile(): string | undefined;
}

export function loadOAuthToken(sources: CredentialSources): string | undefined {
  const candidates = [
    sources.env["CLAUDE_CODE_OAUTH_TOKEN"],
    sources.readKeychain(),
    sources.readSecretTool(),
    sources.readCredentialsFile(),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "" && c !== "null") return c;
  }
  return undefined;
}

export function defaultCredentialSources(): CredentialSources {
  const home = homedir();
  const credsPath = join(home, ".claude", ".credentials.json");
  return {
    env: process.env,
    readKeychain: () => readKeychainMacOS(),
    readSecretTool: () => readSecretToolLinux(),
    readCredentialsFile: () => readCredentialsJson(credsPath),
  };
}

function readKeychainMacOS(): string | undefined {
  if (platform() !== "darwin") return undefined;
  try {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) return undefined;
    return parseTokenFromBlob((result.stdout ?? "").trim());
  } catch {
    return undefined;
  }
}

function readSecretToolLinux(): string | undefined {
  if (platform() !== "linux") return undefined;
  try {
    const result = spawnSync(
      "secret-tool",
      ["lookup", "service", "Claude Code-credentials"],
      { encoding: "utf-8", timeout: 2000 },
    );
    if (result.status !== 0) return undefined;
    return parseTokenFromBlob((result.stdout ?? "").trim());
  } catch {
    return undefined;
  }
}

function readCredentialsJson(path: string): string | undefined {
  try {
    const raw = readFileSync(path, "utf-8");
    return parseTokenFromBlob(raw);
  } catch {
    return undefined;
  }
}

function parseTokenFromBlob(blob: string): string | undefined {
  if (!blob) return undefined;
  try {
    const parsed = z.parse(credentialsFileSchema, JSON.parse(blob));
    return parsed.claudeAiOauth?.accessToken ?? undefined;
  } catch {
    return undefined;
  }
}
