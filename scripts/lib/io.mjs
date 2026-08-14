import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; TennisNationalsCollector/1.0)",
      ...options.headers
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
