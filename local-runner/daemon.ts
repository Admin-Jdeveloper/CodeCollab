/**
 * CodeCollab Local Execution Daemon
 * 
 * Runs directly on the developer's local machine to provide secure, native,
 * decentralized code execution for C++ (g++/clang++), C, Python, JavaScript, and TypeScript.
 * 
 * Usage:
 *   bun run daemon
 *   or:
 *   bun run local-runner/daemon.ts
 * 
 * Default port: 4000
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";

const PORT = Number(process.env.LOCAL_RUNNER_PORT) || 4000;
const TEMP_DIR = path.join(os.tmpdir(), "codecollab_local_runner");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ── Safe file deletion (handles Windows EBUSY / locks) ────────────────────────
function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }, 1500);
  }
}

// ── Check if a port is in use and terminate the stale process ─────────────────
function freePortIfOccupied(port: number): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const lines = out.split("\n").filter((l) => l.includes(`:${port}`) && l.includes("LISTENING"));
      const pids = new Set<string>();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && pid !== String(process.pid)) {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        console.log(`[Daemon] 🔄 Freeing port ${port} from PID ${pid}...`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {}
      }
      return pids.size > 0;
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      return true;
    }
  } catch {
    return false;
  }
}

// ── Check which toolchains exist on this machine ──────────────────────────────
function checkToolchain(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore", timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

let toolchains = {
  cpp: false,
  c: false,
  python: false,
  node: false,
  typescript: false,
};

let detectedCppCmd = "g++";
let detectedPyCmd = process.platform === "win32" ? "python" : "python3";
let detectedJsCmd = "node";

function detectToolchains() {
  const hasGpp = checkToolchain("g++");
  const hasGcc = checkToolchain("gcc");
  const hasPy = checkToolchain("python");
  const hasPy3 = checkToolchain("python3");
  const hasNode = checkToolchain("node");
  const hasBun = typeof (globalThis as any).Bun !== "undefined" || checkToolchain("bun");

  detectedCppCmd = hasGpp ? "g++" : (hasGcc ? "gcc" : "g++");
  detectedPyCmd = hasPy ? "python" : (hasPy3 ? "python3" : "python");
  detectedJsCmd = hasBun ? "bun" : (hasNode ? "node" : "node");

  toolchains = {
    cpp: hasGpp || hasGcc,
    c: hasGcc || hasGpp,
    python: hasPy || hasPy3,
    node: hasNode || hasBun,
    typescript: hasBun || hasNode,
  };
  console.log("🛠️  Detected local toolchains:", toolchains);
}

detectToolchains();

// ── Helper to run a command with timeout and stdin ───────────────────────────
function runProcess(
  cmd: string,
  args: string[],
  options: { cwd: string; stdin?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs || 8000;
    let stdout = "";
    let stderr = "";
    let isFinished = false;
    let timedOut = false;

    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(cmd, args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err: any) {
      return resolve({
        stdout: "",
        stderr: `Failed to spawn ${cmd}: ${err.message}`,
        exitCode: 1,
        timedOut: false,
      });
    }

    const timer = setTimeout(() => {
      if (!isFinished) {
        timedOut = true;
        isFinished = true;
        try { p.kill("SIGKILL"); } catch {}
        if (process.platform === "win32" && (p as any).pid) {
          try {
            execSync(`taskkill /PID ${(p as any).pid} /T /F`, { stdio: "ignore" });
          } catch {}
        }
        resolve({
          stdout,
          stderr: stderr + `\n[Process terminated: Time Limit Exceeded (${timeoutMs}ms)]`,
          exitCode: 124,
          timedOut: true,
        });
      }
    }, timeoutMs);

    p.stdout?.on("data", (d) => { stdout += d.toString(); });
    p.stderr?.on("data", (d) => { stderr += d.toString(); });

    // Write stdin then immediately close it so the process doesn't block waiting
    if (p.stdin) {
      try {
        if (options.stdin !== undefined && options.stdin !== null && options.stdin !== "") {
          const inputStr = options.stdin.endsWith("\n") ? options.stdin : options.stdin + "\n";
          p.stdin.write(inputStr);
        }
        p.stdin.end();
      } catch {}
    }

    p.on("error", (err) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + `\n${err.message}`,
          exitCode: 1,
          timedOut: false,
        });
      }
    });

    p.on("close", (code) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
          timedOut,
        });
      }
    });
  });
}

// ── Code Execution Handler ───────────────────────────────────────────────────
async function handleRunCode(payload: { language: string; code: string; input?: string; timeoutMs?: number }) {
  const { language, code, input, timeoutMs = 8000 } = payload;
  if (!code) {
    return { status: 400, body: { error: "Missing 'code' parameter" } };
  }

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startTime = Date.now();
  const normLang = (language || "").toLowerCase().trim();

  // ── C++ / C Execution ──────────────────────────────────────
  if (normLang === "cpp" || normLang === "c") {
    const isC = normLang === "c";
    const srcExt = isC ? ".c" : ".cpp";
    const srcFile = path.join(TEMP_DIR, `main_${id}${srcExt}`);
    const exeFile = path.join(TEMP_DIR, `main_${id}${process.platform === "win32" ? ".exe" : ""}`);
    fs.writeFileSync(srcFile, code, "utf8");

    const compiler = isC ? (toolchains.c ? "gcc" : detectedCppCmd) : detectedCppCmd;
    const compileArgs = isC
      ? ["-O2", "-Wall", srcFile, "-o", exeFile]
      : ["-O2", "-Wall", srcFile, "-o", exeFile];

    const compileRes = await runProcess(compiler, compileArgs, { cwd: TEMP_DIR, timeoutMs: 15000 });

    if (compileRes.exitCode !== 0) {
      safeUnlink(srcFile);
      const execTime = Date.now() - startTime;
      return {
        status: 200,
        body: {
          success: false,
          stdout: "",
          stderr: compileRes.stderr,
          compilerLog: compileRes.stderr,
          exitCode: compileRes.exitCode,
          executionTimeMs: execTime,
          isCompileError: true,
        },
      };
    }

    const runRes = await runProcess(exeFile, [], { cwd: TEMP_DIR, stdin: input, timeoutMs });
    safeUnlink(srcFile);
    safeUnlink(exeFile);

    const execTime = Date.now() - startTime;
    return {
      status: 200,
      body: {
        success: runRes.exitCode === 0,
        stdout: runRes.stdout,
        stderr: runRes.stderr,
        compilerLog: compileRes.stderr,
        exitCode: runRes.exitCode,
        executionTimeMs: execTime,
        isCompileError: false,
      },
    };
  }

  // ── Python Execution ───────────────────────────────────────
  if (normLang === "python" || normLang === "py") {
    const pyFile = path.join(TEMP_DIR, `main_${id}.py`);
    fs.writeFileSync(pyFile, code, "utf8");

    const runRes = await runProcess(detectedPyCmd, ["-u", pyFile], { cwd: TEMP_DIR, stdin: input, timeoutMs });
    safeUnlink(pyFile);

    const execTime = Date.now() - startTime;
    return {
      status: 200,
      body: {
        success: runRes.exitCode === 0,
        stdout: runRes.stdout,
        stderr: runRes.stderr,
        compilerLog: "",
        exitCode: runRes.exitCode,
        executionTimeMs: execTime,
        isCompileError: false,
      },
    };
  }

  // ── JavaScript Execution ───────────────────────────────────
  if (normLang === "javascript" || normLang === "js") {
    const jsFile = path.join(TEMP_DIR, `main_${id}.js`);
    fs.writeFileSync(jsFile, code, "utf8");

    const runRes = await runProcess(detectedJsCmd, [jsFile], { cwd: TEMP_DIR, stdin: input, timeoutMs });
    safeUnlink(jsFile);

    const execTime = Date.now() - startTime;
    return {
      status: 200,
      body: {
        success: runRes.exitCode === 0,
        stdout: runRes.stdout,
        stderr: runRes.stderr,
        compilerLog: "",
        exitCode: runRes.exitCode,
        executionTimeMs: execTime,
        isCompileError: false,
      },
    };
  }

  // ── TypeScript Execution ───────────────────────────────────
  if (normLang === "typescript" || normLang === "ts") {
    const tsFile = path.join(TEMP_DIR, `main_${id}.ts`);
    fs.writeFileSync(tsFile, code, "utf8");

    const tsRunner = toolchains.typescript ? (toolchains.node && detectedJsCmd === "bun" ? "bun" : "bun") : "bun";
    const runRes = await runProcess(tsRunner, ["run", tsFile], { cwd: TEMP_DIR, stdin: input, timeoutMs });
    safeUnlink(tsFile);

    const execTime = Date.now() - startTime;
    return {
      status: 200,
      body: {
        success: runRes.exitCode === 0,
        stdout: runRes.stdout,
        stderr: runRes.stderr,
        compilerLog: "",
        exitCode: runRes.exitCode,
        executionTimeMs: execTime,
        isCompileError: false,
      },
    };
  }

  return { status: 400, body: { error: `Unsupported language: ${language}` } };
}

// ── Launch Server (Native Bun.serve or Node.http) ─────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Access-Control-Request-Private-Network",
  "Access-Control-Allow-Private-Network": "true",
};

// Check and free port if an orphaned process is listening before binding
freePortIfOccupied(PORT);

if (typeof (globalThis as any).Bun !== "undefined") {
  // ── High-performance Bun.serve with reusePort ─────────────────────────────
  (globalThis as any).Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    reusePort: true,
    async fetch(req: Request) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            platform: os.platform(),
            arch: os.arch(),
            pid: process.pid,
            toolchains,
            daemon: "CodeCollab Local Runner v1.0",
          }),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      if (req.method === "POST" && url.pathname === "/run") {
        try {
          const payload = await req.json();
          const { status, body } = await handleRunCode(payload);
          return new Response(JSON.stringify(body), {
            status,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    },
  });

  // Permanent keep-alive interval to guarantee the daemon remains active
  setInterval(() => {}, 1 << 30);

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 CodeCollab Local Execution Daemon (Bun Native)            ║
║   Running at http://127.0.0.1:${PORT}                            ║
║   Decentralized, client-side native compilation & runner       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
} else {
  // ── Node.js fallback ──────────────────────────────────────────────────────
  const nodeServer = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", toolchains }));
    }
    if (req.method === "POST" && req.url === "/run") {
      let b = "";
      req.on("data", (c) => { b += c; });
      req.on("end", async () => {
        try {
          const { status, body } = await handleRunCode(JSON.parse(b));
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        } catch (e: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  nodeServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Running on port ${PORT}`);
  });
}
