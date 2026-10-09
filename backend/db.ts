import "./env";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const rawConnectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/codeduo";

// Normalize connection string:
// 1. Ensure IPv4 on localhost to avoid Windows ::1 latency
// 2. Automatically detect if SSL is required (e.g. Supabase, Neon, AWS RDS)
const isLocalhost =
  rawConnectionString.includes("localhost") ||
  rawConnectionString.includes("127.0.0.1") ||
  rawConnectionString.includes("@postgres:");

const connectionString = rawConnectionString.includes("localhost")
  ? rawConnectionString.replace("localhost", "127.0.0.1")
  : rawConnectionString;

// Remote providers (like Supabase, AWS RDS, Neon) require SSL
const isSslRequired =
  !isLocalhost ||
  rawConnectionString.includes("supabase.co") ||
  rawConnectionString.includes("sslmode=require");

export const pool = new pg.Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: isSslRequired ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.warn("[PostgreSQL Pool] Warning: unexpected idle client error:", err.message);
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});