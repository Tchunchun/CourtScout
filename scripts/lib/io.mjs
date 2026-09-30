import { request as httpsRequest } from "node:https";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TENNIS_RECORD_HOSTS = new Set([
  "tennisrecord.com",
  "www.tennisrecord.com"
]);
const TENNIS_RECORD_ROOT_CA = new URL(
  "../certs/godaddy-tls-root-ca-r1.pem",
  import.meta.url
);

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function requestHttpsText(url, options) {
  return new Promise((resolveRequest, reject) => {
    const request = httpsRequest(url, {
      headers: options.headers,
      ca: options.ca
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        if (
          response.statusCode == null ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          reject(new Error(
            `GET ${url} failed: ${response.statusCode ?? "unknown"} ${response.statusMessage ?? ""}`.trim()
          ));
          return;
        }
        resolveRequest(Buffer.concat(chunks).toString("utf8"));
      });
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(
        `GET ${url} timed out after ${options.timeoutMs}ms`
      ));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchText(url, options = {}) {
  const parsedUrl = new URL(url);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers = {
    "user-agent": "Mozilla/5.0 (compatible; TennisNationalsCollector/1.0)",
    ...options.headers
  };
  try {
    if (
      parsedUrl.protocol === "https:" &&
      TENNIS_RECORD_HOSTS.has(parsedUrl.hostname.toLowerCase())
    ) {
      return await requestHttpsText(parsedUrl, {
        headers,
        timeoutMs,
        ca: await readFile(TENNIS_RECORD_ROOT_CA, "utf8")
      });
    }
    const response = await fetch(parsedUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      throw new Error(
        `GET ${parsedUrl.href} failed: ${response.status} ${response.statusText}`
      );
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Could not retrieve ${parsedUrl.hostname}: ${error.message}`,
      { cause: error }
    );
  }
}

export const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
