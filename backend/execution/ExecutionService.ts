import { DockerSandbox } from "./dockerSandbox";
import type { ExecutionJobData, ExecutionResult } from "./types";

export class ExecutionService {
  private static activeSandboxes = new Map<string, DockerSandbox>();

  /**
   * Run user code inside isolated Docker container
   */
  static async execute(jobData: ExecutionJobData): Promise<ExecutionResult> {
    const sandbox = new DockerSandbox(jobData.executionId);
    this.activeSandboxes.set(jobData.executionId, sandbox);

    try {
      const result = await sandbox.execute(
        jobData.language,
        jobData.sourceCode,
        jobData.stdin
      );
      return result;
    } finally {
      this.activeSandboxes.delete(jobData.executionId);
    }
  }

  /**
   * Terminate active execution container immediately
   */
  static async cancel(executionId: string): Promise<boolean> {
    const sandbox = this.activeSandboxes.get(executionId);
    if (sandbox) {
      await sandbox.kill();
      this.activeSandboxes.delete(executionId);
      return true;
    }
    // Also attempt cleanup by container name directly in case of distributed node
    const fallbackSandbox = new DockerSandbox(executionId);
    await fallbackSandbox.kill();
    return true;
  }
}
