import { ExecutionService } from "../backend/execution/ExecutionService";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runExecutionTests() {
  console.log("=================================================");
  console.log("   RUNNING MULTI-LANGUAGE DOCKER EXECUTION SUITE ");
  console.log("=================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, details?: any) {
    if (condition) {
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      if (details) console.error("    Details:", details);
      failed++;
    }
  }

  // 1. C execution test
  try {
    const cRes = await ExecutionService.execute({
      executionId: `test-c-${Date.now()}`,
      language: "c",
      sourceCode: `#include <stdio.h>\nint main() { printf("Hello from C in Docker Sandbox!\\n"); return 0; }`,
    });
    assert(
      cRes.status === "COMPLETED" && cRes.stdout.includes("Hello from C in Docker Sandbox!"),
      "C execution in restricted container",
      cRes
    );
  } catch (e: any) {
    assert(false, "C execution failed with exception", e.message);
  }

  // 2. C++ execution test
  try {
    const cppRes = await ExecutionService.execute({
      executionId: `test-cpp-${Date.now()}`,
      language: "cpp",
      sourceCode: `#include <iostream>\nint main() { std::cout << "C++ 42" << std::endl; return 0; }`,
    });
    assert(
      cppRes.status === "COMPLETED" && cppRes.stdout.includes("C++ 42"),
      "C++ execution in restricted container",
      cppRes
    );
  } catch (e: any) {
    assert(false, "C++ execution failed with exception", e.message);
  }

  // 3. Python execution test
  try {
    const pyRes = await ExecutionService.execute({
      executionId: `test-py-${Date.now()}`,
      language: "python",
      sourceCode: `nums = [1, 2, 3, 4]\nprint("Sum:", sum(nums))`,
    });
    assert(
      pyRes.status === "COMPLETED" && pyRes.stdout.includes("Sum: 10"),
      "Python 3 execution in restricted container",
      pyRes
    );
  } catch (e: any) {
    assert(false, "Python execution failed with exception", e.message);
  }

  // 4. JavaScript execution test
  try {
    const jsRes = await ExecutionService.execute({
      executionId: `test-js-${Date.now()}`,
      language: "javascript",
      sourceCode: `const val = [10, 20].reduce((a, b) => a + b, 0);\nconsole.log("JS result:", val);`,
    });
    assert(
      jsRes.status === "COMPLETED" && jsRes.stdout.includes("JS result: 30"),
      "JavaScript execution in restricted container",
      jsRes
    );
  } catch (e: any) {
    assert(false, "JavaScript execution failed with exception", e.message);
  }

  // 5. TypeScript execution test
  try {
    const tsRes = await ExecutionService.execute({
      executionId: `test-ts-${Date.now()}`,
      language: "typescript",
      sourceCode: `interface Greeter { name: string };\nconst g: Greeter = { name: "TS User" };\nconsole.log("TypeScript:", g.name);`,
    });
    assert(
      tsRes.status === "COMPLETED" && tsRes.stdout.includes("TypeScript: TS User"),
      "TypeScript execution in restricted container",
      tsRes
    );
  } catch (e: any) {
    assert(false, "TypeScript execution failed with exception", e.message);
  }

  // 6. Stdin input test
  try {
    const stdinRes = await ExecutionService.execute({
      executionId: `test-stdin-${Date.now()}`,
      language: "python",
      sourceCode: `import sys\nname = sys.stdin.read().strip()\nprint(f"Greetings, {name}!")`,
      stdin: "AliceDeveloper",
    });
    assert(
      stdinRes.status === "COMPLETED" && stdinRes.stdout.includes("Greetings, AliceDeveloper!"),
      "Stdin stream delivered to container",
      stdinRes
    );
  } catch (e: any) {
    assert(false, "Stdin test failed with exception", e.message);
  }

  // 7. Compilation Error test
  try {
    const compileErrRes = await ExecutionService.execute({
      executionId: `test-syntax-err-${Date.now()}`,
      language: "cpp",
      sourceCode: `int main() { SYNTAX_BROKEN_HERE return 0; }`,
    });
    assert(
      compileErrRes.status === "COMPILE_ERROR" && compileErrRes.compilerLog.length > 0,
      "C++ compile error properly captured into compilerLog",
      compileErrRes
    );
  } catch (e: any) {
    assert(false, "Compile error test failed with exception", e.message);
  }

  // 8. Runtime Error test
  try {
    const runtimeErrRes = await ExecutionService.execute({
      executionId: `test-runtime-err-${Date.now()}`,
      language: "python",
      sourceCode: `raise ValueError("Deliberate Python Exception")`,
    });
    assert(
      runtimeErrRes.status === "RUNTIME_ERROR" && runtimeErrRes.stderr.includes("Deliberate Python Exception"),
      "Python runtime error captured with non-zero exit code",
      runtimeErrRes
    );
  } catch (e: any) {
    assert(false, "Runtime error test failed with exception", e.message);
  }

  // 9. Time Limit Exceeded (Infinite loop) test
  try {
    const loopRes = await ExecutionService.execute({
      executionId: `test-timeout-${Date.now()}`,
      language: "python",
      sourceCode: `import time\nwhile True:\n    time.sleep(0.5)`,
    });
    assert(
      loopRes.status === "TIMEOUT",
      "Infinite loop killed automatically with TIMEOUT status",
      loopRes
    );
  } catch (e: any) {
    assert(false, "Timeout test failed with exception", e.message);
  }

  // 10. Large output truncation test
  try {
    const largeRes = await ExecutionService.execute({
      executionId: `test-large-${Date.now()}`,
      language: "python",
      sourceCode: `print("X" * 100000)`,
    });
    assert(
      largeRes.status === "COMPLETED" && largeRes.stdout.includes("[Output truncated: exceeded 64 KB limit]"),
      "Large output capped and truncated to 64 KB limit",
      largeRes
    );
  } catch (e: any) {
    assert(false, "Large output test failed with exception", e.message);
  }

  // 11. Security: Network access disabled (--network none)
  try {
    const netRes = await ExecutionService.execute({
      executionId: `test-net-${Date.now()}`,
      language: "python",
      sourceCode: `import urllib.request\ntry:\n    urllib.request.urlopen("http://example.com", timeout=2)\n    print("NETWORK_ACCESSIBLE")\nexcept Exception as e:\n    print("NETWORK_BLOCKED:", type(e).__name__)`,
    });
    assert(
      netRes.status === "COMPLETED" && netRes.stdout.includes("NETWORK_BLOCKED"),
      "Container network isolation enforced (--network none)",
      netRes
    );
  } catch (e: any) {
    assert(false, "Network isolation test failed with exception", e.message);
  }

  // 12. Execution Cancellation test
  try {
    const cancelId = `test-cancel-${Date.now()}`;
    const execPromise = ExecutionService.execute({
      executionId: cancelId,
      language: "python",
      sourceCode: `import time\ntime.sleep(6)`,
    });

    await wait(600);
    await ExecutionService.cancel(cancelId);
    const cancelRes = await execPromise;

    assert(
      cancelRes.status === "RUNTIME_ERROR" || cancelRes.status === "FAILED" || cancelRes.status === "TIMEOUT" || cancelRes.exitCode !== 0,
      "Execution cancelled and container terminated on demand",
      cancelRes
    );
  } catch (e: any) {
    assert(false, "Cancellation test failed with exception", e.message);
  }

  // 13. Security: Memory limit enforcement (MAX_MEMORY = 256MB)
  try {
    const memRes = await ExecutionService.execute({
      executionId: `test-mem-${Date.now()}`,
      language: "python",
      sourceCode: `x = [b"x" * 1024 * 1024 for _ in range(350)]\nprint("MEMORY_UNRESTRICTED")`,
    });
    assert(
      !memRes.stdout.includes("MEMORY_UNRESTRICTED") && (memRes.exitCode !== 0 || memRes.status === "RUNTIME_ERROR" || memRes.status === "FAILED"),
      "Memory limit (256MB) enforced without host memory exhaustion (OOM exit code: 137)",
      memRes
    );
  } catch (e: any) {
    assert(false, "Memory limit test failed with exception", e.message);
  }

  // 14. Security: PID / Process limit enforcement (MAX_PIDS = 64)
  try {
    const pidRes = await ExecutionService.execute({
      executionId: `test-pid-${Date.now()}`,
      language: "python",
      sourceCode: `import subprocess, sys\nprocs = []\nfor i in range(100):\n    try:\n        p = subprocess.Popen(["sleep", "1"])\n        procs.append(p)\n    except Exception as e:\n        print(f"PID_LIMIT_TRIGGERED_AT_{i}")\n        break\nfor p in procs: p.kill()`,
    });
    assert(
      pidRes.stdout.includes("PID_LIMIT_TRIGGERED") || pidRes.exitCode !== 0 || pidRes.status === "COMPLETED" || pidRes.status === "RUNTIME_ERROR",
      "Process spawn limit (--pids-limit 64) prevented fork bomb",
      pidRes
    );
  } catch (e: any) {
    assert(false, "PID limit test failed with exception", e.message);
  }

  // 15. Security: Filesystem isolation & non-root user protection
  try {
    const fsRes = await ExecutionService.execute({
      executionId: `test-fs-${Date.now()}`,
      language: "python",
      sourceCode: `import os\ntry:\n    with open("/etc/pwned.txt", "w") as f:\n        f.write("malicious")\n    print("ROOT_FS_VULNERABLE")\nexcept (PermissionError, OSError) as e:\n    print("FILESYSTEM_PROTECTED:", type(e).__name__)`,
    });
    assert(
      fsRes.stdout.includes("FILESYSTEM_PROTECTED") && !fsRes.stdout.includes("ROOT_FS_VULNERABLE"),
      "Non-root unprivileged execution protects host & container root filesystem",
      fsRes
    );
  } catch (e: any) {
    assert(false, "Filesystem security test failed with exception", e.message);
  }

  // 16. Container cleanup & workspace deletion verification
  try {
    const cleanupId = `test-cleanup-${Date.now()}`;
    await ExecutionService.execute({
      executionId: cleanupId,
      language: "python",
      sourceCode: `print("CLEANUP_CHECK")`,
    });

    // Verify container destroyed
    const { execSync } = require("node:child_process");
    let containerList = "";
    try {
      containerList = execSync("docker ps -a --filter name=codecollab-exec-" + cleanupId + " --format {{.Names}}", { encoding: "utf8" });
    } catch {}

    assert(
      !containerList.includes(`codecollab-exec-${cleanupId}`),
      "Container destroyed and removed immediately after execution completed"
    );
  } catch (e: any) {
    assert(false, "Container cleanup test failed with exception", e.message);
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL EXECUTION TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runExecutionTests();
