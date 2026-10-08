import type Redis from "ioredis";
import { LIMITS } from "./types";

export class ExecutionRateLimiter {
  constructor(private redis: Redis) {}

  /**
   * Validate source code and stdin sizes
   */
  validatePayloadSize(sourceCode: string, stdin?: string): { allowed: boolean; reason?: string } {
    const srcSize = Buffer.byteLength(sourceCode, "utf8");
    if (srcSize > LIMITS.MAX_SOURCE_SIZE) {
      return {
        allowed: false,
        reason: `Source code exceeds maximum size limit of ${LIMITS.MAX_SOURCE_SIZE / 1024} KB (${srcSize} bytes)`,
      };
    }

    if (stdin) {
      const stdinSize = Buffer.byteLength(stdin, "utf8");
      if (stdinSize > LIMITS.MAX_STDIN_SIZE) {
        return {
          allowed: false,
          reason: `Input exceeds maximum size limit of ${LIMITS.MAX_STDIN_SIZE / 1024} KB (${stdinSize} bytes)`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check rate limits per user/IP
   */
  async checkRateLimit(userOrIpKey: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const minKey = `ratelimit:exec:min:${userOrIpKey}`;
      const count = await this.redis.incr(minKey);
      if (count === 1) {
        await this.redis.expire(minKey, 60);
      }

      if (count > LIMITS.MAX_EXECUTIONS_PER_MINUTE) {
        return {
          allowed: false,
          reason: `Rate limit exceeded: maximum ${LIMITS.MAX_EXECUTIONS_PER_MINUTE} executions per minute. Please wait before running again.`,
        };
      }

      const concurrentKey = `ratelimit:exec:active:${userOrIpKey}`;
      const activeCount = Number(await this.redis.get(concurrentKey) || "0");
      if (activeCount >= LIMITS.MAX_CONCURRENT_PER_USER) {
        return {
          allowed: false,
          reason: `Concurrent execution limit reached: maximum ${LIMITS.MAX_CONCURRENT_PER_USER} simultaneous runs per user.`,
        };
      }

      return { allowed: true };
    } catch {
      // If Redis has a transient error, fail open safely
      return { allowed: true };
    }
  }

  async incrementActive(userOrIpKey: string): Promise<void> {
    try {
      const key = `ratelimit:exec:active:${userOrIpKey}`;
      await this.redis.incr(key);
      await this.redis.expire(key, 60);
    } catch {}
  }

  async decrementActive(userOrIpKey: string): Promise<void> {
    try {
      const key = `ratelimit:exec:active:${userOrIpKey}`;
      const val = await this.redis.decr(key);
      if (val < 0) await this.redis.set(key, 0);
    } catch {}
  }

  /**
   * Rate limit socket connections per IP
   */
  async checkSocketConnection(ipOrSocket: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const key = `ratelimit:socket:conn:${ipOrSocket}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 60);
      if (count > 60) {
        return { allowed: false, reason: "Too many socket connection attempts. Please wait." };
      }
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }

  /**
   * Rate limit room joins
   */
  async checkJoinRoom(userOrSocket: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const key = `ratelimit:room:join:${userOrSocket}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 60);
      if (count > 40) {
        return { allowed: false, reason: "Too many room join attempts. Please slow down." };
      }
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }

  /**
   * Rate limit project/room creations
   */
  async checkProjectCreation(ipOrUser: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const key = `ratelimit:project:create:${ipOrUser}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 60);
      if (count > 20) {
        return { allowed: false, reason: "Too many room creation requests. Maximum 20 per minute." };
      }
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }
}
