import { parentPort, workerData } from "node:worker_threads";
import { formatWithOptions } from "node:util";
import vm from "node:vm";

const TOOLS_ENUMERATION_ERROR = "tools is not enumerable — use tools.search({ query })";
const RESERVED_TOOL_PROPS = new Set(["then", "catch", "finally", "toJSON", "toString", "valueOf"]);

// Keep this formatting logic in sync with mcp-code.ts; the standalone worker cannot import the TypeScript host module.
function needsInspectableFormatting(value, stack = new WeakSet()) {
  if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return true;
  if (typeof value !== "object" || value === null) return false;
  if (stack.has(value)) return true;
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) return true;
  stack.add(value);
  try {
    return Object.values(value).some((entry) => needsInspectableFormatting(entry, stack));
  } finally {
    stack.delete(value);
  }
}

function formatValue(value) {
  if (typeof value === "string") return value;
  try {
    if (!needsInspectableFormatting(value)) {
      const json = JSON.stringify(value, null, 2);
      if (json !== undefined) return json;
    }
    return formatWithOptions({ colors: false, depth: 6 }, value);
  } catch {
    return "[unserializable value]";
  }
}

function toContentBlock(value) {
  if (typeof value === "object" && value !== null) {
    if (value.type === "text" && typeof value.text === "string") {
      return { type: "text", text: value.text };
    }
    if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
      return { type: "image", data: value.data, mimeType: value.mimeType };
    }
  }
  return { type: "text", text: formatValue(value) };
}

let nextRequestId = 0;
const pending = new Map();

parentPort.on("message", (message) => {
  if (message?.type !== "result" || typeof message.id !== "number") return;
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve("dataJson" in message
    ? { ok: true, data: JSON.parse(message.dataJson) }
    : message.envelope);
});

function request(type, payload) {
  return new Promise((resolve) => {
    const id = ++nextRequestId;
    pending.set(id, resolve);
    parentPort.postMessage({ type, id, ...payload });
  });
}

class McpCallError extends Error {
  constructor(failure) {
    super(failure.message);
    this.name = "McpCallError";
    this.code = failure.code;
    this.details = failure.details;
    this.failure = failure;
  }
}

async function callTool(path, args, capture = false) {
  const result = typeof path !== "string" || path.trim() === ""
    ? { ok: false, error: { code: "invalid_tool_path", message: "tools.call(path, args) requires a non-empty tool path." } }
    : await request("call", { path, args });
  if (!capture && !result.ok) throw new McpCallError(result.error);
  return result;
}

const tools = new Proxy(Object.create(null), {
  get(_target, property) {
    if (property === "search") {
      return async (input) => request("search", { input });
    }
    if (property === "call") return (path, args) => callTool(path, args);
    if (property === "capture") return (path, args) => callTool(path, args, true);
    if (property === "describe") {
      return async (input) => request("describe", { input });
    }
    if (typeof property !== "string" || RESERVED_TOOL_PROPS.has(property)) return undefined;
    return (args) => callTool(property, args);
  },
  ownKeys() {
    throw new Error(TOOLS_ENUMERATION_ERROR);
  },
});

const jev = Object.freeze({
  evaluate: (input) => request("evaluate", { input }),
});

const emit = (value) => {
  parentPort.postMessage({ type: "emit", block: toContentBlock(value) });
};

const capturedConsole = Object.freeze({
  log: (...args) => emit(`[console.log] ${formatWithOptions({ colors: false, depth: 4 }, ...args)}`),
  info: (...args) => emit(`[console.info] ${formatWithOptions({ colors: false, depth: 4 }, ...args)}`),
  warn: (...args) => emit(`[console.warn] ${formatWithOptions({ colors: false, depth: 4 }, ...args)}`),
  error: (...args) => emit(`[console.error] ${formatWithOptions({ colors: false, depth: 4 }, ...args)}`),
  debug: (...args) => emit(`[console.debug] ${formatWithOptions({ colors: false, depth: 4 }, ...args)}`),
});

void (async () => {
  try {
    const context = vm.createContext(Object.assign(Object.create(null), {
      tools,
      jev,
      emit,
      console: capturedConsole,
      URL,
      URLSearchParams,
    }), {
      codeGeneration: { strings: false, wasm: false },
      name: "mcpScript",
    });
    const script = new vm.Script(`(async () => {\n${workerData.code}\n})()`, { filename: "mcpScript.js" });
    const returnValue = await Promise.resolve(script.runInContext(context));
    parentPort.postMessage(returnValue === undefined
      ? { type: "done" }
      : { type: "done", returnBlock: toContentBlock(returnValue) });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof McpCallError ? { failure: error.failure } : {}),
    });
  }
})();
