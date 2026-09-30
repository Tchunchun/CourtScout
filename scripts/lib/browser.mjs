import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CDP_TIMEOUT_MS = 120_000;

function cdpCommand(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} timed out.`));
    }, CDP_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(new Error(message.error.message));
        return;
      }
      resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Could not connect to the UTR browser page for ${method}.`));
    });
  });
}

async function cdpBrowser(pageUrl, ...args) {
  const [command, value] = args;
  if (command === "wait") {
    await new Promise(resolve => setTimeout(resolve, Number(value)));
    return "";
  }
  if (command === "open") {
    await cdpCommand(pageUrl, "Page.navigate", { url: value });
    const deadline = Date.now() + CDP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await cdpCommand(pageUrl, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true
      });
      if (result.result?.value === "complete") return "";
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("UTR page navigation timed out.");
  }
  if (command === "eval") {
    const result = await cdpCommand(pageUrl, "Runtime.evaluate", {
      expression: value,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "UTR browser evaluation failed."
      );
    }
    return JSON.stringify(result.result?.value);
  }
  throw new Error(`Unsupported direct browser command: ${command}`);
}

export async function browser(session, ...args) {
  if (process.env.COURT_SCOUT_CDP_PAGE_URL) {
    return cdpBrowser(process.env.COURT_SCOUT_CDP_PAGE_URL, ...args);
  }
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
