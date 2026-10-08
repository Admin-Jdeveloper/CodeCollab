import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const redisConnectionOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    return Math.min(times * 100, 3000);
  },
};

/** Create a standalone ioredis client */
export function createRedisClient(name = "default"): Redis {
  const client = new Redis(redisConnectionOptions);

  client.on("connect", () => {
    // Connected to Redis
  });

  client.on("error", (err) => {
    console.error(`[Redis:${name}] Error:`, err.message);
  });

  return client;
}
