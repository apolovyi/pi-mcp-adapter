import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { createRequestHeadersCommandFetch } from "../request-headers-command.ts";

const processMocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => processMocks);

it.skipIf(process.platform === "win32").each(["pending", "success", "failure"])("handles %s asynchronous discovery without blocking exit or losing buffered stdout", async (outcome) => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(process, "kill").mockReturnValue(true);
  const scan = { kill: vi.fn() };
  const child = Object.assign(new EventEmitter(), {
    pid: 1234567,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  processMocks.spawn.mockReturnValue(child);
  processMocks.spawnSync.mockReturnValue({ status: 0, signal: null, stdout: "" });
  processMocks.execFile.mockReturnValue(scan);
  const delegate = vi.fn(async (_input: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("x-derived")).toBe("retained");
    return new Response("ok");
  });
  const fetch = createRequestHeadersCommandFetch({ command: "synthetic-not-started" }, delegate);
  const response = fetch("https://mcp.example.test/mcp");
  try {
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledOnce());
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(50);
    expect(processMocks.execFile).toHaveBeenCalledOnce();
    expect(processMocks.spawnSync).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(processMocks.execFile).toHaveBeenCalledOnce();
    const callback = processMocks.execFile.mock.calls[0]![3];
    if (outcome === "success") callback(null, "1234568 1234567 synthetic helper\n");
    if (outcome === "failure") callback(Object.assign(new Error("synthetic discovery failure"), { code: 1 }), "");
    child.emit("exit", 0, null);
    expect(vi.getTimerCount()).toBe(0);
    expect(scan.kill).toHaveBeenCalledTimes(outcome === "pending" ? 1 : 0);
    if (outcome === "pending") callback(new Error("cancelled diagnostic scan"), "");
    expect(delegate).not.toHaveBeenCalled();
  } finally {
    try {
      child.stdout.write('{"x-derived":"retained"}');
      child.emit("close", 0);
      if (outcome === "failure") {
        await expect(response).rejects.toThrow("HTTP request headers command cleanup failed: ps exited with code 1");
        expect(delegate).not.toHaveBeenCalled();
      } else {
        await response;
        expect(delegate).toHaveBeenCalledOnce();
        if (outcome === "success") {
          expect(process.kill).toHaveBeenCalledWith(1234568, "SIGSTOP");
          expect(process.kill).toHaveBeenCalledWith(1234568, "SIGKILL");
        }
      }
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  }
});
