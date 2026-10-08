export const LIMITS = {
  MAX_SOURCE_SIZE: 64 * 1024,      // 64 KB
  MAX_STDIN_SIZE: 32 * 1024,       // 32 KB
  MAX_OUTPUT_SIZE: 64 * 1024,      // 64 KB
  MAX_COMPILE_TIME_MS: Number(process.env.MAX_COMPILE_TIME_MS) || 200000,      // 200 seconds
  MAX_EXECUTION_TIME_MS: Number(process.env.MAX_EXECUTION_TIME_MS) || 200000,  // 200 seconds
  MAX_MEMORY: "256m",              // 256 MB
  MAX_CPUS: "1.0",                 // 1 CPU core
  MAX_PIDS: 64,                    // 64 processes
  MAX_CONCURRENT_PER_USER: 2,      // 2 concurrent executions
  MAX_EXECUTIONS_PER_MINUTE: 10,   // 10 executions/min
  // Batch 3 Centralized Names
  MAX_EXECUTION_TIME: 200000,
  MAX_COMPILE_TIME: 200000,
  MAX_CPU: "1.0",
  MAX_CONCURRENT_EXECUTIONS: 2,
};

export type ExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "COMPILE_ERROR"
  | "RUNTIME_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "FAILED";

export interface ExecutionJobData {
  executionId: string;
  userId?: string;
  projectId?: string;
  roomId?: string;
  fileId?: string;
  language: string;
  sourceCode: string;
  stdin?: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  compilerLog: string;
  exitCode: number;
  executionTimeMs: number;
  errorMessage?: string;
}
