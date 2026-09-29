/**
 * CodeCollab Client-Side Local Execution Engine
 * 
 * Supports:
 * 1. Native Local Daemon execution (runs G++, Python, Node directly on developer's machine)
 * 2. In-browser JavaScript Web Worker sandbox with console interception and loop timeout
 * 3. In-browser Python WebAssembly engine via Pyodide
 * 4. Fallback client-side C++ static analyzer and compiler diagnostics
 */

import { parseDiagnostics, type DiagnosticItem } from "./errorParser";
import { parseAntigravityTrigger } from "./editorParser";

export interface ExecutionRequest {
  language: string; // widened — supports any workspace file language
  code: string;
  input?: string;
  timeoutMs?: number;
}


export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  compilerLog: string;
  exitCode: number;
  executionTimeMs: number;
  diagnostics: DiagnosticItem[];
  runtime: "local-daemon" | "browser-wasm" | "browser-worker";
  runtimeDetails: string;
}

const LOCAL_DAEMON_DIRECT_URL = "http://127.0.0.1:4000";
const LOCAL_DAEMON_PROXY_URL = "/api/daemon";

/**
 * Pings the local daemon to see if it's currently running.
 * Tries direct 127.0.0.1:4000 first, then falls back to /api/daemon proxy
 * to prevent any browser CORS or Private Network Access restrictions.
 */
export async function checkLocalDaemon(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  
  // 1. Try direct loopback connection
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${LOCAL_DAEMON_DIRECT_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok") return true;
    }
  } catch {}

  // 2. Try proxy through Next.js server
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(LOCAL_DAEMON_PROXY_URL, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return data.status === "ok";
    }
  } catch {}

  return false;
}

/**
 * Execute via local daemon (runs native local compiler/interpreter).
 * Tries direct port 4000 first, then Next.js server proxy.
 */
async function executeViaDaemon(req: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = performance.now();
  let res: Response | null = null;

  // 1. Try direct
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (req.timeoutMs || 6000) + 10000);
    res = await fetch(`${LOCAL_DAEMON_DIRECT_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: req.language,
        code: req.code,
        input: req.input || "",
        timeoutMs: req.timeoutMs || 8000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    res = null;
  }

  // 2. If direct fetch failed (e.g. CORS/PNA), try proxy
  if (!res || !res.ok) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), (req.timeoutMs || 6000) + 12000);
      res = await fetch(LOCAL_DAEMON_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: req.language,
          code: req.code,
          input: req.input || "",
          timeoutMs: req.timeoutMs || 8000,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch {}
  }

  if (!res || !res.ok) {
    const errData = res ? await res.json().catch(() => ({})) : {};
    throw new Error(errData.error || (res ? `Daemon returned HTTP ${res.status}` : "Daemon unreachable"));
  }

  const data = await res.json();
  const execTime = data.executionTimeMs || Math.round(performance.now() - startTime);

  const diagnostics = parseDiagnostics(
    req.language,
    data.stdout || "",
    `${data.compilerLog || ""}\n${data.stderr || ""}`
  );

  return {
    success: data.success,
    stdout: data.stdout || "",
    stderr: data.stderr || "",
    compilerLog: data.compilerLog || "",
    exitCode: data.exitCode,
    executionTimeMs: execTime,
    diagnostics,
    runtime: "local-daemon",
    runtimeDetails: `Local Machine Daemon • Native ${req.language.toUpperCase()}`,
  };
}

/**
 * In-browser JavaScript execution using a sandboxed Web Worker Blob
 */
async function executeJavaScriptWorker(req: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = performance.now();
  const timeoutMs = req.timeoutMs || 5000;

  return new Promise((resolve) => {
    // Construct worker code
    const workerScript = `
      self.onmessage = function(e) {
        const userCode = e.data.code;
        const logs = [];
        const errors = [];

        const customConsole = {
          log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
          warn: (...args) => logs.push('[WARN] ' + args.map(String).join(' ')),
          error: (...args) => errors.push(args.map(String).join(' ')),
          info: (...args) => logs.push('[INFO] ' + args.map(String).join(' ')),
          table: (data) => logs.push(JSON.stringify(data, null, 2)),
        };

        try {
          const fn = new Function('console', userCode);
          fn(customConsole);
          self.postMessage({
            success: errors.length === 0,
            stdout: logs.join('\\n'),
            stderr: errors.join('\\n'),
            exitCode: errors.length === 0 ? 0 : 1,
          });
        } catch (err) {
          self.postMessage({
            success: false,
            stdout: logs.join('\\n'),
            stderr: (err.stack || err.message || String(err)),
            exitCode: 1,
            isError: true,
          });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    let isDone = false;

    const timeout = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        const execTime = Math.round(performance.now() - startTime);
        const errMsg = `Time Limit Exceeded: JavaScript execution timed out after ${timeoutMs}ms.\nPotential infinite loop detected.`;
        resolve({
          success: false,
          stdout: "",
          stderr: errMsg,
          compilerLog: "",
          exitCode: 124,
          executionTimeMs: execTime,
          diagnostics: [{
            id: "js-tle",
            line: 1,
            severity: "error",
            message: "Time Limit Exceeded: Execution exceeded timeout limit.",
            rawText: errMsg,
          }],
          runtime: "browser-worker",
          runtimeDetails: "In-Browser Web Worker Sandbox (Isolated V8 Thread)",
        });
      }
    }, timeoutMs);

    worker.onmessage = (e) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);

      const execTime = Math.round(performance.now() - startTime);
      const data = e.data;
      const diagnostics = parseDiagnostics("javascript", data.stdout, data.stderr);

      resolve({
        success: data.success,
        stdout: data.stdout,
        stderr: data.stderr,
        compilerLog: "",
        exitCode: data.exitCode,
        executionTimeMs: execTime,
        diagnostics,
        runtime: "browser-worker",
        runtimeDetails: "In-Browser Web Worker Sandbox (Isolated V8 Thread)",
      });
    };

    worker.onerror = (err) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);

      const execTime = Math.round(performance.now() - startTime);
      const msg = err.message || "Worker Execution Error";
      const diagnostics = parseDiagnostics("javascript", "", msg);

      resolve({
        success: false,
        stdout: "",
        stderr: msg,
        compilerLog: "",
        exitCode: 1,
        executionTimeMs: execTime,
        diagnostics,
        runtime: "browser-worker",
        runtimeDetails: "In-Browser Web Worker Sandbox",
      });
    };

    worker.postMessage({ code: req.code });
  });
}

// Global Pyodide reference for caching
let pyodideInstance: any = null;
let pyodideLoadingPromise: Promise<any> | null = null;

async function getPyodide(): Promise<any> {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoadingPromise) return pyodideLoadingPromise;

  pyodideLoadingPromise = (async () => {
    // Check if pyodide script is in head
    if (!(window as any).loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Pyodide WebAssembly engine from CDN"));
        document.head.appendChild(script);
      });
    }
    const py = await (window as any).loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/",
    });
    pyodideInstance = py;
    return py;
  })();

  return pyodideLoadingPromise;
}

/**
 * In-browser Python execution using Pyodide (WebAssembly CPython 3)
 */
async function executePythonWasm(req: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = performance.now();

  try {
    const pyodide = await getPyodide();

    // Prepare Python IO capture wrapper
    const runnerCode = `
import sys
import io
import traceback

__stdout_buffer = io.StringIO()
__stderr_buffer = io.StringIO()
sys.stdout = __stdout_buffer
sys.stderr = __stderr_buffer

__error = None
try:
    code_obj = compile('''${req.code.replace(/\\/g, "\\\\").replace(/'''/g, "\\'\\'\\'")}''', '<string>', 'exec')
    exec(code_obj, {'__name__': '__main__'})
except Exception as e:
    __error = traceback.format_exc()
except SyntaxError as e:
    __error = traceback.format_exc()

sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__

__out = __stdout_buffer.getvalue()
__err = __stderr_buffer.getvalue()
if __error:
    __err = (__err + "\\n" + __error).strip()

(__out, __err, 0 if not __error else 1)
`;

    const result = await pyodide.runPythonAsync(runnerCode);
    const stdout = result.get(0) || "";
    const stderr = result.get(1) || "";
    const exitCode = result.get(2);
    result.destroy();

    const execTime = Math.round(performance.now() - startTime);
    const diagnostics = parseDiagnostics("python", stdout, stderr);

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      compilerLog: "",
      exitCode,
      executionTimeMs: execTime,
      diagnostics,
      runtime: "browser-wasm",
      runtimeDetails: "In-Browser Pyodide (WebAssembly CPython 3.12)",
    };
  } catch (err: any) {
    const execTime = Math.round(performance.now() - startTime);
    const errMsg = err.message || String(err);
    const diagnostics = parseDiagnostics("python", "", errMsg);

    return {
      success: false,
      stdout: "",
      stderr: errMsg,
      compilerLog: "",
      exitCode: 1,
      executionTimeMs: execTime,
      diagnostics,
      runtime: "browser-wasm",
      runtimeDetails: "In-Browser Pyodide (WebAssembly CPython)",
    };
  }
}

/**
 * Client-Side C++ Static Verification & Fast Wasm Simulation
 * Used when local daemon is not running.
 */
async function executeCppClientFallback(req: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = performance.now();
  const code = req.code;

  // Perform quick static syntax diagnostics on the client
  const diagnostics: DiagnosticItem[] = [];

  // Check for main function
  if (!code.includes("int main") && !code.includes("void main")) {
    diagnostics.push({
      id: "cpp-no-main",
      line: 1,
      severity: "error",
      message: "undefined reference to 'main': Every C++ program requires a main() entry point.",
      rawText: "/usr/bin/ld: undefined reference to 'main'",
    });
  }

  // Check for mismatched braces
  const openBraces = (code.match(/{/g) || []).length;
  const closeBraces = (code.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    diagnostics.push({
      id: "cpp-brace-mismatch",
      line: code.split("\n").length,
      severity: "error",
      message: `Syntax Error: Mismatched braces (found ${openBraces} '{' and ${closeBraces} '}').`,
      rawText: `error: expected '}' at end of input`,
    });
  }

  // Check for common missing semicolons (heuristic)
  const lines = code.split("\n");
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (
      trimmed.length > 3 &&
      !trimmed.endsWith(";") &&
      !trimmed.endsWith("{") &&
      !trimmed.endsWith("}") &&
      !trimmed.endsWith(">") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*") &&
      (trimmed.startsWith("cout") || trimmed.startsWith("int ") || trimmed.startsWith("return "))
    ) {
      diagnostics.push({
        id: `cpp-semicolon-${idx + 1}`,
        line: idx + 1,
        severity: "error",
        message: `error: expected ';' before end of line`,
        source: line,
        rawText: `main.cpp:${idx + 1}: error: expected ';' before end of line`,
      });
    }
  });

  const execTime = Math.round(performance.now() - startTime);

  if (diagnostics.length > 0) {
    const compilerLog = diagnostics.map((d) => d.rawText).join("\n");
    return {
      success: false,
      stdout: "",
      stderr: compilerLog,
      compilerLog,
      exitCode: 1,
      executionTimeMs: execTime,
      diagnostics,
      runtime: "browser-wasm",
      runtimeDetails: "Client-Side C++ Analyzer • (Start Local Daemon for native G++ compilation)",
    };
  }

  // If no syntax errors, inform user that daemon is needed for real compilation
  return {
    success: false,
    stdout: "",
    stderr: "⚠️ Native compilation requires the CodeCollab local daemon.\nPlease run the daemon in your terminal:\n    bun run daemon\nOnce running, your code will compile and execute with g++ natively.",
    compilerLog: "Notice: Browser static check passed, but native g++ is required for full binary execution.",
    exitCode: 1,
    executionTimeMs: execTime,
    diagnostics: [{
      id: "daemon-required",
      line: 1,
      severity: "warning",
      message: "Native compilation requires local runner daemon. Run: bun run daemon",
      rawText: "Notice: Local execution daemon required for C/C++ compilation",
    }],
    runtime: "browser-wasm",
    runtimeDetails: "Local Daemon Required",
  };
}

/**
 * Master Execution Dispatcher:
 * 1. Attempts local daemon first (direct port 4000 & Next.js proxy)
 * 2. If daemon not running, runs safe in-browser sandboxes for JS and Python
 */
export async function executeCodeLocally(req: ExecutionRequest): Promise<ExecutionResult> {
  const antigravityInfo = parseAntigravityTrigger(req.code, req.language);

  // If code includes antigravity, notify UI via custom event
  if (antigravityInfo.isTriggered && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("codecollab:antigravity", { detail: antigravityInfo }));
  }

  // 1. Try local daemon first (tries 127.0.0.1, localhost, and /api/daemon proxy)
  let result: ExecutionResult | null = null;
  try {
    result = await executeViaDaemon(req);
  } catch (err: any) {
    console.warn("Direct daemon execution failed, checking fallbacks:", err.message);
  }

  // 2. Browser-native fallbacks if daemon not available
  if (!result) {
    switch (req.language) {
      case "javascript":
      case "typescript":
        result = await executeJavaScriptWorker(req);
        break;
      case "python":
        result = await executePythonWasm(req);
        break;
      case "cpp":
      case "c":
        result = await executeCppClientFallback(req);
        break;
      default:
        throw new Error(`Unsupported language: ${req.language}`);
    }
  }

  // If antigravity was triggered, prepend the flight telemetry manifest to stdout
  if (antigravityInfo.isTriggered && result) {
    const flightManifest = [
      "🌌 [CODECOLLAB ANTIGRAVITY ENGINE ENGAGED]",
      "══════════════════════════════════════════════════════════════════",
      `XKCD #353: "${antigravityInfo.quote}"`,
      `Orbital Velocity: 7.66 km/s  •  Gravitational Pull (g): 0.00 m/s²`,
      `Trajectory: Sub-orbital anti-gravitational drift unlocked`,
      "══════════════════════════════════════════════════════════════════\n",
    ].join("\n");

    result = {
      ...result,
      stdout: `${flightManifest}${result.stdout || "Program completed in zero gravity."}`,
      runtimeDetails: `${result.runtimeDetails} • [🌌 Zero-G Active]`,
    };
  }

  return result;
}
