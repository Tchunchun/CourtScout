import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function browser(session, ...args) {
  const { stdout } = await execFileAsync(
    "agent-browser",
    ["--session", session, ...args],
    { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }
  );
  return stdout.trim();
}

export async function browserJson(session, expression) {
  const output = await browser(session, "eval", expression);
  const outer = JSON.parse(output);
  return typeof outer === "string" ? JSON.parse(outer) : outer;
}
