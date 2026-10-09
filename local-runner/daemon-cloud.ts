/**
 * CodeCollab Cloud Daemon / Worker Entry Point
 * 
 * Runs locally on your machine with Docker, but connects to your
 * CLOUD Redis instance so that it processes execution jobs dispatched
 * from your DEPLOYED Render Web Services and Vercel frontend.
 * 
 * Usage:
 *   bun run daemon:deployed
 */

const CLOUD_REDIS_URL =
  process.env.CLOUD_REDIS_URL ||
  "redis://default:FD8mJTm7FM8K9QkRB0NLF5mgnYDPXmGx@touchable-simple-pest-36749.db.redis.io:14692";

process.env.REDIS_URL = CLOUD_REDIS_URL;

console.log(`[Daemon:CloudBridge] 🌐 Connecting to Cloud Redis to serve deployed web app...`);

import "./daemon";
