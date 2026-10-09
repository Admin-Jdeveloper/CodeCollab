import fs from "node:fs";
import path from "node:path";

/**
 * Universal environment loader
 * Ensures environment variables from backend/.env or .env are loaded
 * whether running from repository root, backend, local-runner, or tests.
 */
export function ensureEnvLoaded(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "../backend/.env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
        break;
      } catch {}
    }
  }
}

ensureEnvLoaded();
