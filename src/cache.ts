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
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// Open the file by name, then operate on the file descriptor — closes
// the TOCTOU window between checking mtime and reading the bytes
// (CWE-367). O_NOFOLLOW refuses to follow a symlink that an attacker
// might have planted in shared /tmp.
export function loadJsonCache<T = unknown>(
  filePath: string,
  maxAgeMs: number,
): T | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(fd);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return undefined;
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

export function saveJsonCache(filePath: string, data: unknown): void {
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Refuse to follow a pre-existing symlink (classic /tmp planting attack).
    try {
      const ls = lstatSync(filePath);
      if (ls.isSymbolicLink()) unlinkSync(filePath);
    } catch {
      // not present, fine
    }

    // Atomic write: tempfile + rename. Tempfile is created with O_EXCL
    // so we never reuse an attacker-planted path, and mode 0o600 is set
    // at create time (not retroactively).
    const tmp = join(
      dir,
      `.cache.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
    );
    writeFileSync(tmp, JSON.stringify(data), {
      mode: 0o600,
      flag: "wx", // O_CREAT | O_EXCL — fail if it already exists
    });
    renameSync(tmp, filePath);
  } catch {
    // best-effort cache; ignore failures
  }
}
