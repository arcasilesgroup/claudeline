import { describe, expect, test } from "bun:test";
import {
  loadOAuthToken,
  type CredentialSources,
} from "../src/credentials.js";

function sources(overrides: Partial<CredentialSources>): CredentialSources {
  return {
    env: {},
    readKeychain: () => undefined,
    readSecretTool: () => undefined,
    readCredentialsFile: () => undefined,
    ...overrides,
  };
}

describe("loadOAuthToken", () => {
  test("uses env var first when present", () => {
    const token = loadOAuthToken(
      sources({
        env: { CLAUDE_CODE_OAUTH_TOKEN: "tok-from-env" },
        readKeychain: () => "tok-from-keychain",
      }),
    );
    expect(token).toBe("tok-from-env");
  });

  test("falls back to macOS keychain", () => {
    const token = loadOAuthToken(
      sources({ readKeychain: () => "tok-from-keychain" }),
    );
    expect(token).toBe("tok-from-keychain");
  });

  test("falls back to Linux secret-tool", () => {
    const token = loadOAuthToken(
      sources({ readSecretTool: () => "tok-from-secret-tool" }),
    );
    expect(token).toBe("tok-from-secret-tool");
  });

  test("falls back to credentials file", () => {
    const token = loadOAuthToken(
      sources({ readCredentialsFile: () => "tok-from-file" }),
    );
    expect(token).toBe("tok-from-file");
  });

  test("returns undefined when nothing works", () => {
    expect(loadOAuthToken(sources({}))).toBeUndefined();
  });

  test("ignores empty strings as non-tokens", () => {
    expect(
      loadOAuthToken(
        sources({
          env: { CLAUDE_CODE_OAUTH_TOKEN: "" },
          readKeychain: () => "",
          readSecretTool: () => "",
          readCredentialsFile: () => "real-token",
        }),
      ),
    ).toBe("real-token");
  });
});
