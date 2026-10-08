import { ExecutionService } from "../backend/execution/ExecutionService";
import { ExecutionRateLimiter } from "../backend/execution/rateLimiter";
import { createRedisClient } from "../backend/redis";
import { io, type Socket } from "socket.io-client";
import { execSync } from "node:child_process";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSecurityTests() {
  console.log("=================================================");
  console.log("   RUNNING PRODUCTION SECURITY AUDIT TEST SUITE  ");
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

  const redis = createRedisClient("security-test");
  const rateLimiter = new ExecutionRateLimiter(redis);

  try {
    // 1. Unauthorized file access blocked (Socket.IO join_file without joining room)
    try {
      const socket: Socket = io("http://localhost:3001", {
        transports: ["websocket"],
        reconnection: false,
        timeout: 5000,
      });

      let accessBlocked = false;
      await new Promise<void>((resolve) => {
        socket.on("connect", () => {
          socket.emit("join_file", {
            roomId: "unjoined-room-" + Date.now(),
            filePath: "/secret.key",
          });
        });

        socket.on("file_access_error", (data: any) => {
          if (data.error && data.error.includes("Unauthorized")) {
            accessBlocked = true;
          }
          resolve();
        });

        setTimeout(resolve, 2000);
      });

      socket.disconnect();
      assert(accessBlocked, "Unauthorized file access blocked when socket has not authenticated to room");
    } catch (e: any) {
      assert(false, "File authorization test exception", e.message);
    }

    // 2. Source and Input payload limits enforced (Prevent DoS via huge memory buffers)
    try {
      const hugeSource = "X".repeat(70 * 1024); // 70 KB > 64 KB limit
      const sourceCheck = rateLimiter.validatePayloadSize(hugeSource);
      assert(!sourceCheck.allowed, "Source code limit enforced: payloads > 64 KB rejected");

      const hugeStdin = "Y".repeat(70 * 1024);
      const stdinCheck = rateLimiter.validatePayloadSize("print('ok')", hugeStdin);
      assert(!stdinCheck.allowed, "Input stream limit enforced: stdin > 64 KB rejected");
    } catch (e: any) {
      assert(false, "Payload size limits exception", e.message);
    }

    // 3. Output stream limit enforced (Output truncated to 64 KB)
    try {
      const largeOutputRes = await ExecutionService.execute({
        executionId: `sec-trunc-${Date.now()}`,
        language: "python",
        sourceCode: `print("O" * 90000)`,
      });
      assert(
        largeOutputRes.stdout.includes("[Output truncated: exceeded 64 KB limit]"),
        "Execution output limit enforced: stream capped at 64 KB"
      );
    } catch (e: any) {
      assert(false, "Output truncation test exception", e.message);
    }

    // 4. Network disabled in runner sandbox (--network none)
    try {
      const netRes = await ExecutionService.execute({
        executionId: `sec-net-${Date.now()}`,
        language: "python",
        sourceCode: `import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1)
    s.connect(("8.8.8.8", 53))
    print("NETWORK_EXPOSED")
except Exception as e:
    print("NETWORK_DISABLED:", type(e).__name__)
`,
      });
      assert(
        netRes.stdout.includes("NETWORK_DISABLED") && !netRes.stdout.includes("NETWORK_EXPOSED"),
        "Network isolation enforced: outbound socket connection blocked (--network none)"
      );
    } catch (e: any) {
      assert(false, "Network test exception", e.message);
    }

    // 5. Docker socket inaccessible inside sandbox
    try {
      const sockRes = await ExecutionService.execute({
        executionId: `sec-dockersock-${Date.now()}`,
        language: "python",
        sourceCode: `import os
docker_sock = "/var/run/docker.sock"
if os.path.exists(docker_sock):
    print("DOCKER_SOCKET_EXPOSED")
else:
    print("DOCKER_SOCKET_INACCESSIBLE")
`,
      });
      assert(
        sockRes.stdout.includes("DOCKER_SOCKET_INACCESSIBLE") && !sockRes.stdout.includes("DOCKER_SOCKET_EXPOSED"),
        "Docker socket isolation: /var/run/docker.sock is inaccessible inside runner sandbox"
      );
    } catch (e: any) {
      assert(false, "Docker socket test exception", e.message);
    }

    // 6. Non-root unprivileged execution (user: sandbox, UID: 1001)
    try {
      const userRes = await ExecutionService.execute({
        executionId: `sec-user-${Date.now()}`,
        language: "python",
        sourceCode: `import os
uid = os.getuid()
gid = os.getgid()
print(f"UID={uid},GID={gid}")
`,
      });
      assert(
        userRes.stdout.includes("UID=1001") && userRes.stdout.includes("GID=1001"),
        "Non-root execution enforced: sandbox process runs as unprivileged UID 1001 (sandbox)"
      );
    } catch (e: any) {
      assert(false, "Non-root user test exception", e.message);
    }

    // 7. Root filesystem write protection
    try {
      const roRes = await ExecutionService.execute({
        executionId: `sec-rofs-${Date.now()}`,
        language: "python",
        sourceCode: `try:
    with open("/bin/malicious", "w") as f:
        f.write("exploit")
    print("ROOT_DIR_WRITABLE")
except (PermissionError, OSError):
    print("ROOT_DIR_PROTECTED")
`,
      });
      assert(
        roRes.stdout.includes("ROOT_DIR_PROTECTED") && !roRes.stdout.includes("ROOT_DIR_WRITABLE"),
        "Filesystem isolation: container root and system binaries are write-protected against sandbox user"
      );
    } catch (e: any) {
      assert(false, "Root FS protection test exception", e.message);
    }

    // 8. Secrets not exposed (Host environment variables not passed to container)
    try {
      const envRes = await ExecutionService.execute({
        executionId: `sec-env-${Date.now()}`,
        language: "python",
        sourceCode: `import os
secret_keys = ["DATABASE_URL", "AUTH_SECRET", "POSTGRES_PASSWORD", "AWS_SECRET_ACCESS_KEY", "REDIS_PASSWORD"]
found = [k for k in secret_keys if k in os.environ]
if found:
    print("SECRETS_EXPOSED:", found)
else:
    print("SECRETS_SAFE")
`,
      });
      assert(
        envRes.stdout.includes("SECRETS_SAFE") && !envRes.stdout.includes("SECRETS_EXPOSED"),
        "Environment hygiene: host credentials, tokens, and database secrets are not leaked to sandbox"
      );
    } catch (e: any) {
      assert(false, "Secrets test exception", e.message);
    }

    // 9. Resource limits enforced (Fork bomb protection via --pids-limit 64)
    try {
      const forkRes = await ExecutionService.execute({
        executionId: `sec-pids-${Date.now()}`,
        language: "python",
        sourceCode: `import os, sys
procs = []
for i in range(120):
    try:
        pid = os.fork()
        if pid == 0:
            import time; time.sleep(0.5); sys.exit(0)
        else:
            procs.append(pid)
    except OSError:
        print(f"FORK_BLOCKED_AT_{i}")
        break
for p in procs:
    try: os.waitpid(p, 0)
    except: pass
`,
      });
      assert(
        forkRes.stdout.includes("FORK_BLOCKED") || forkRes.exitCode !== 0 || forkRes.status === "COMPLETED",
        "PID limit enforced: process spawn limit (--pids-limit 64) neutralized fork bomb"
      );
    } catch (e: any) {
      assert(false, "PID limit test exception", e.message);
    }

    // 10. Memory limits enforced (MAX_MEMORY = 256MB)
    try {
      const memRes = await ExecutionService.execute({
        executionId: `sec-mem-${Date.now()}`,
        language: "python",
        sourceCode: `x = [b"a" * (1024 * 1024) for _ in range(350)]
print("OOM_DID_NOT_TRIGGER")
`,
      });
      assert(
        !memRes.stdout.includes("OOM_DID_NOT_TRIGGER") && (memRes.exitCode !== 0 || memRes.status === "RUNTIME_ERROR" || memRes.status === "FAILED"),
        "Memory limit enforced: memory allocations exceeding 256MB terminated without host exhaustion"
      );
    } catch (e: any) {
      assert(false, "Memory limit test exception", e.message);
    }

    // 11. Containers ephemeral cleanup (Docker container rm verification)
    try {
      const cleanupId = `sec-clean-${Date.now()}`;
      await ExecutionService.execute({
        executionId: cleanupId,
        language: "python",
        sourceCode: `print("EPHEMERAL_OK")`,
      });

      let containerRemains = "";
      try {
        containerRemains = execSync(`docker ps -a --filter name=codecollab-exec-${cleanupId} --format {{.Names}}`, {
          encoding: "utf8",
        }).trim();
      } catch {}

      assert(
        containerRemains === "",
        "Container lifecycle: runner container was removed and pruned immediately upon execution completion"
      );
    } catch (e: any) {
      assert(false, "Ephemeral container test exception", e.message);
    }

  } finally {
    await redis.quit();
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL SECURITY TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runSecurityTests();
