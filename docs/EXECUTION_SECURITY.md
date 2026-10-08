# CodeCollab — Execution Security & Container Isolation Specification

## 1. Security Architecture Principles

CodeCollab enforces a **Zero Trust Host Environment** model for user code execution. Code submitted by clients is treated as untrusted and potentially adversarial. It is **never** compiled or executed directly on the production host system.

```text
Untrusted User Code
       │
       ▼
BullMQ Worker
       │
       ▼
Unique Workspace: /tmp/codecollab_workspaces/<executionId>/
       │
       ▼
Restricted Docker Sandbox
  ├── Image: alpine:3.20 (pinned)
  ├── User: sandbox:sandbox (uid 1001, gid 1001)
  ├── Capabilities: --cap-drop ALL
  ├── Network: --network none
  ├── Memory Cap: --memory 256m --memory-swap 256m
  ├── CPU Cap: --cpus 1.0
  ├── Process Cap: --pids-limit 64
  ├── Timeouts: Compile (10s), Run (8s)
  └── Mount: Only isolated workspace mounted to /workspace
       │
       ▼
Execution Output (stdout / stderr)
       │
       ├── Truncated to 64 KB limit
       │
       ▼
Guaranteed Container Destruction & Workspace Wipe
```

---

## 2. Centralized Security Limits

Security parameters are centralized in `backend/execution/types.ts` and strictly enforced by the server and worker:

| Parameter | Limit | Enforcement Mechanism | Attack Mitigated |
|---|---|---|---|
| `MAX_SOURCE_SIZE` | 64 KB | HTTP Request Validator | Disk exhaustion, compiler DoS |
| `MAX_STDIN_SIZE` | 32 KB | HTTP Request Validator | Memory overflow, I/O buffer bloat |
| `MAX_OUTPUT_SIZE` | 64 KB | Output Stream Truncator | Terminal freezing, bandwidth exhaustion |
| `MAX_COMPILE_TIME` | 10 seconds | ChildProcess Timeout Timer | Infinite template recursion, compile hangs |
| `MAX_EXECUTION_TIME`| 8 seconds | ChildProcess Timeout Timer | Infinite loops, halting problem |
| `MAX_MEMORY` | 256 MB | Docker `--memory 256m --memory-swap 256m` | Host memory exhaustion, OOM crashes |
| `MAX_CPU` | 1.0 core | Docker `--cpus 1.0` | CPU starvation, core hogging |
| `MAX_PIDS` | 64 processes | Docker `--pids-limit 64` | Fork bombs (`:(){ :\|:& };:`) |
| `MAX_CONCURRENT_EXECUTIONS` | 2 per user | Redis Rate Limiter | Worker pool monopolization |

---

## 3. Defense-in-Depth Measures

### 3.1 Non-Root User Execution
The execution container runs exclusively as unprivileged user `sandbox` (`uid: 1001`, `gid: 1001`). Even if an exploit triggers inside an interpreter, root escalation within the container is prevented.

### 3.2 Linux Capability Dropping
Every container runs with `--cap-drop ALL`. This removes all kernel capabilities, including raw sockets (`CAP_NET_RAW`), chrooting, mount operations, and administrative syscalls.

### 3.3 Network Isolation
Every sandbox container runs with `--network none`. User code cannot:
- Connect to the internet.
- Connect to the local Docker bridge or internal services (PostgreSQL, Redis).
- Exfiltrate data or download external payloads.

### 3.4 Filesystem Isolation & Ephemeral Workspaces
- Containers do not share filesystems.
- Each run receives a distinct folder: `codecollab_workspaces/<executionId>/`.
- The Docker socket (`/var/run/docker.sock`) is **never** mounted or exposed to containers.
- Workspaces and containers are destroyed in guaranteed `finally` cleanup handlers.

---

## 4. Validated Threat Scenarios

| Attack Vector | Simulated Test | System Behavior |
|---|---|---|
| **Infinite Loop** | `while True: sleep(0.5)` | Terminated after 8s with status `TIMEOUT`. Container destroyed. |
| **Huge Output Loop** | `print("X" * 100000)` | Output intercepted and truncated at 64 KB with clear notice. |
| **Memory Exhaustion** | Allocate > 256 MB | Cgroup kills container (exit code 137). Host memory untouched. |
| **Fork Bomb** | Spawn 100+ processes | Capped at 64 PIDs. Additional `fork()` calls return `EAGAIN`. |
| **Network Probing** | `urllib.request.urlopen("http://example.com")` | Network unreachable. Connection refused immediately. |
| **Filesystem Write** | Write to `/etc/pwned.txt` | Denied with `PermissionError`. Host filesystem completely protected. |
| **Process Cancellation** | Active running job cancelled | `docker rm -f` invoked on target container name immediately. |
