import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
// `lstatSync` is already imported below for the writer; the loader uses
// it too now to refuse pre-existing symlinks even on Windows.
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// Hardened JSON-on-disk primitive shared by `cache.ts` and `state.ts`.
//
// Reader: opens with `O_NOFOLLOW`, operates on the file descriptor
// (`fstatSync` + `readSync`) so an attacker cannot swap the file
// between freshness check and read (CWE-367 TOCTOU).
//
// Writer: creates the parent directory `0o700`, refuses any
// pre-existing symlink at the target path, writes via a sibling
// tempfile with `flag: "wx"` (`O_CREAT | O_EXCL`) and mode `0o600`,
// then `renameSync` atomically. A crash mid-write cannot leave a
// partial file at the target.

export interface LoadJsonOptions {
  // If set and the file is older than this, return undefined (cache
  // semantics). Omit for state files where the consumer enforces its
  // own staleness rules.
  maxAgeMs?: number;
}

export function loadJson<T = unknown>(
  filePath: string,
  options: LoadJsonOptions = {},
): T | undefined {
  let fd: number | undefined;
  try {
    // Reject symlinks before opening.
    //
    // POSIX path: `O_NOFOLLOW` is honoured atomically by the kernel —
    // no TOCTOU window. We rely on it exclusively.
    //
    // Windows path: `O_NOFOLLOW` is silently ignored. We fall back to
    // `lstatSync().isSymbolicLink()` which has a tiny TOCTOU window
    // (CodeQL `js/file-system-race`). The cache and state files live
    // in a per-uid directory created with mode `0o700`, so any
    // attacker capable of swapping the file between lstat and open
    // already shares the user's UID — at which point the cache is
    // not a meaningful trust boundary.
    if (process.platform === "win32") {
      try {
        if (lstatSync(filePath).isSymbolicLink()) return undefined;
      } catch {
        // not present → openSync below will return undefined too
      }
    }
    fd = openSync(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(fd);
    if (
      typeof options.maxAgeMs === "number" &&
      Date.now() - stat.mtimeMs > options.maxAgeMs
    ) {
      return undefined;
    }
    const buf = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const n = readSync(fd, buf, read, stat.size - read, null);
      if (n === 0) break;
      read += n;
    }
    return JSON.parse(buf.subarray(0, read).toString("utf-8")) as T;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export interface SaveJsonOptions {
  // Tempfile basename prefix. Must be safe filesystem chars only;
  // a pid + random suffix is appended internally.
  tmpPrefix?: string;
}

export function saveJson(
  filePath: string,
  data: unknown,
  options: SaveJsonOptions = {},
): void {
  const tmpPrefix = options.tmpPrefix ?? ".claudeline";
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    try {
      const ls = lstatSync(filePath);
      if (ls.isSymbolicLink()) unlinkSync(filePath);
    } catch {
      // not present, fine
    }

    const tmp = join(
      dir,
      `${tmpPrefix}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
    );
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    renameSync(tmp, filePath);
  } catch {
    // best-effort; ignore failures
  }
}
