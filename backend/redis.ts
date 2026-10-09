import Redis, { type RedisOptions } from "ioredis";

const rawRedisUrl = process.env.REDIS_URL?.trim();

function resolveRedisConfig(): {
  connectionOptions: RedisOptions;
  connectionString?: string;
} {
  if (rawRedisUrl) {
    const isTls = rawRedisUrl.startsWith("rediss://");
    try {
      const parsed = new URL(rawRedisUrl);
      return {
        connectionString: rawRedisUrl,
        connectionOptions: {
          host: parsed.hostname,
          port: Number(parsed.port) || (isTls ? 6380 : 6379),
          username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
          password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
          tls: isTls ? { rejectUnauthorized: false } : undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy(times: number) {
            return Math.min(times * 100, 3000);
          },
        },
      };
    } catch {
      // Fallback for custom formatted url
      return {
        connectionString: rawRedisUrl,
        connectionOptions: {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          tls: isTls ? { rejectUnauthorized: false } : undefined,
          retryStrategy(times: number) {
            return Math.min(times * 100, 3000);
          },
        },
      };
    }
  }

  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = Number(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;
  const isTls = process.env.REDIS_TLS === "true";

  return {
    connectionOptions: {
      host,
      port,
      password,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times: number) {
        return Math.min(times * 100, 3000);
      },
    },
  };
}

const resolved = resolveRedisConfig();

import type { ConnectionOptions } from "bullmq";

export const redisConnectionOptions: ConnectionOptions = resolved.connectionOptions as unknown as ConnectionOptions;

/** Create a standalone ioredis client */
export function createRedisClient(name = "default"): Redis {
  const { connectionString, connectionOptions } = resolveRedisConfig();
  const client = connectionString
    ? new Redis(connectionString, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        tls: connectionString.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
        retryStrategy(times: number) {
          return Math.min(times * 100, 3000);
        },
      })
    : new Redis(connectionOptions);

  client.on("connect", () => {
    // Connected to Redis
  });

  client.on("error", (err) => {
    console.error(`[Redis:${name}] Error:`, err.message);
  });

  return client;
}
