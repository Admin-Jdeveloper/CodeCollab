import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { LIMITS, type ExecutionResult } from "./types";

const WORKSPACES_BASE_DIR = path.join(os.tmpdir(), "codecollab_workspaces");

if (!fs.existsSync(WORKSPACES_BASE_DIR)) {
  try {
    fs.mkdirSync(WORKSPACES_BASE_DIR, { recursive: true });
    fs.chmodSync(WORKSPACES_BASE_DIR, 0o777);
  } catch {}
} else {
  try {
    fs.chmodSync(WORKSPACES_BASE_DIR, 0o777);
  } catch {}
}

function truncateOutput(str: string): string {
  if (Buffer.byteLength(str, "utf8") > LIMITS.MAX_OUTPUT_SIZE) {
    const truncated = str.slice(0, LIMITS.MAX_OUTPUT_SIZE);
    return truncated + "\n\n[Output truncated: exceeded 64 KB limit]";
  }
  return str;
}

function safeRemoveDir(dirPath: string) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    setTimeout(() => {
      try {
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      } catch {}
    }, 2000);
  }
}

/**
 * Execute a command inside Docker or on host with strict timeout
 */
function runSpawn(
  cmd: string,
  args: string[],
  options: { timeoutMs: number; stdin?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let isFinished = false;
    let timedOut = false;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(cmd, args, { windowsHide: true });
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
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve({
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr + `\n[Execution Terminated: Time Limit Exceeded (${options.timeoutMs}ms)]`),
          exitCode: 124,
          timedOut: true,
        });
      }
    }, options.timeoutMs);

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > LIMITS.MAX_OUTPUT_SIZE * 2) {
        try { proc.kill("SIGKILL"); } catch {}
      }
    });

    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.stdin !== undefined && options.stdin !== null) {
      try {
        proc.stdin?.write(options.stdin);
        proc.stdin?.end();
      } catch {}
    } else {
      try {
        proc.stdin?.end();
      } catch {}
    }

    proc.on("error", (err) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr + `\n${err.message}`),
          exitCode: 1,
          timedOut: false,
        });
      }
    });

    proc.on("close", (code) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          stdout: truncateOutput(stdout),
          stderr: truncateOutput(stderr),
          exitCode: code ?? 0,
          timedOut,
        });
      }
    });
  });
}

export class DockerSandbox {
  private containerName: string;
  private workspaceDir: string;

  constructor(private executionId: string) {
    this.containerName = `codecollab-exec-${executionId}`;
    this.workspaceDir = path.join(WORKSPACES_BASE_DIR, executionId);
  }

  /**
   * Terminate running container forcefully for this execution
   */
  async kill(): Promise<void> {
    try {
      const killer = spawn("docker", ["rm", "-f", this.containerName], { windowsHide: true });
      killer.on("error", () => {});
    } catch {}
  }

  /**
   * Execute source code securely inside container
   */
  async execute(language: string, sourceCode: string, stdin?: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    const normLang = (language || "").toLowerCase().trim();

    // 1. Create isolated temporary workspace directory with full write access for sandbox user
    try {
      fs.mkdirSync(this.workspaceDir, { recursive: true });
      try { fs.chmodSync(this.workspaceDir, 0o777); } catch {}
    } catch (e: any) {
      return {
        status: "FAILED",
        stdout: "",
        stderr: `Failed to create execution workspace: ${e.message}`,
        compilerLog: "",
        exitCode: 1,
        executionTimeMs: 0,
        errorMessage: e.message,
      };
    }

    try {
      // 2. Prepare file extensions & commands
      let sourceFileName = "main.cpp";
      let compileCommand: string[] | null = null;
      let runCommand: string[] = [];

      if (normLang === "c") {
        sourceFileName = "main.c";
        compileCommand = ["gcc", "-O2", "-Wall", "main.c", "-o", "main"];
        runCommand = ["./main"];
      } else if (normLang === "cpp" || normLang === "c++") {
        sourceFileName = "main.cpp";
        compileCommand = ["g++", "-O2", "-Wall", "main.cpp", "-o", "main"];
        runCommand = ["./main"];
      } else if (normLang === "python" || normLang === "py") {
        sourceFileName = "main.py";
        compileCommand = null;
        runCommand = ["python3", "-u", "main.py"];
      } else if (normLang === "javascript" || normLang === "js") {
        sourceFileName = "main.js";
        compileCommand = null;
        runCommand = ["node", "main.js"];
      } else if (normLang === "typescript" || normLang === "ts") {
        sourceFileName = "main.ts";
        compileCommand = null;
        runCommand = ["tsx", "main.ts"];
      } else {
        return {
          status: "FAILED",
          stdout: "",
          stderr: `Unsupported language: ${language}`,
          compilerLog: "",
          exitCode: 1,
          executionTimeMs: 0,
          errorMessage: `Unsupported language: ${language}`,
        };
      }

      // 3. Write source and stdin files to workspace
      const sourceFilePath = path.join(this.workspaceDir, sourceFileName);
      fs.writeFileSync(sourceFilePath, sourceCode, "utf8");
      try { fs.chmodSync(sourceFilePath, 0o666); } catch {}

      if (stdin) {
        const inputPath = path.join(this.workspaceDir, "input.txt");
        fs.writeFileSync(inputPath, stdin, "utf8");
        try { fs.chmodSync(inputPath, 0o666); } catch {}
      }

      // Base Docker arguments enforcing strict isolation
      const dockerSecurityArgs = [
        "run",
        "--name", this.containerName,
        "--rm",
        "--cap-drop", "ALL",
        "--network", "none",
        "--memory", LIMITS.MAX_MEMORY,
        "--memory-swap", LIMITS.MAX_MEMORY,
        "--cpus", LIMITS.MAX_CPUS,
        "--pids-limit", String(LIMITS.MAX_PIDS),
        "-v", `${path.resolve(this.workspaceDir)}:/workspace`,
        "-w", "/workspace",
        "codecollab-runner:latest",
      ];

      // 4. Compilation phase (C / C++)
      let compilerLog = "";
      if (compileCommand) {
        const compileRes = await runSpawn(
          "docker",
          [...dockerSecurityArgs, ...compileCommand],
          { timeoutMs: LIMITS.MAX_COMPILE_TIME_MS }
        );

        compilerLog = compileRes.stderr || compileRes.stdout;

        if (compileRes.timedOut) {
          await this.kill();
          return {
            status: "TIMEOUT",
            stdout: "",
            stderr: `Compilation timed out (${LIMITS.MAX_COMPILE_TIME_MS}ms)`,
            compilerLog,
            exitCode: 124,
            executionTimeMs: Date.now() - startTime,
            errorMessage: "Compilation timed out",
          };
        }

        if (compileRes.exitCode !== 0) {
          return {
            status: "COMPILE_ERROR",
            stdout: "",
            stderr: compileRes.stderr,
            compilerLog,
            exitCode: compileRes.exitCode,
            executionTimeMs: Date.now() - startTime,
            errorMessage: "Compilation error",
          };
        }
      }

      // 5. Execution phase
      const runShellCommand = stdin
        ? `sh -c "${runCommand.join(" ")} < input.txt"`
        : `sh -c "${runCommand.join(" ")}"`;

      const runRes = await runSpawn(
        "docker",
        [...dockerSecurityArgs, "sh", "-c", stdin ? `${runCommand.join(" ")} < input.txt` : runCommand.join(" ")],
        {
          timeoutMs: LIMITS.MAX_EXECUTION_TIME_MS,
          stdin: stdin || undefined,
        }
      );

      const executionTimeMs = Date.now() - startTime;

      if (runRes.timedOut) {
        await this.kill();
        return {
          status: "TIMEOUT",
          stdout: runRes.stdout,
          stderr: runRes.stderr || `Execution timed out (${LIMITS.MAX_EXECUTION_TIME_MS}ms)`,
          compilerLog,
          exitCode: 124,
          executionTimeMs,
          errorMessage: "Time Limit Exceeded",
        };
      }

      const isRuntimeError = runRes.exitCode !== 0;

      return {
        status: isRuntimeError ? "RUNTIME_ERROR" : "COMPLETED",
        stdout: runRes.stdout,
        stderr: runRes.stderr,
        compilerLog,
        exitCode: runRes.exitCode,
        executionTimeMs,
      };

    } catch (err: any) {
      await this.kill();
      return {
        status: "FAILED",
        stdout: "",
        stderr: `Sandbox execution failed: ${err.message}`,
        compilerLog: "",
        exitCode: 1,
        executionTimeMs: Date.now() - startTime,
        errorMessage: err.message,
      };
    } finally {
      // 6. Cleanup container and workspace directory
      await this.kill();
      safeRemoveDir(this.workspaceDir);
    }
  }
}
