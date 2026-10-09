/**
 * CodeCollab URL & Callback Utilities
 *
 * Centralized resolution of backend/socket endpoints and strict validation
 * of internal redirect / callback URLs to eliminate hardcoded 'localhost'
 * and prevent open redirect vulnerabilities.
 */

export function getBackendUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, "");
  // If a production or custom URL is configured in env (not localhost), strictly prioritize it
  if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")) {
    return envUrl;
  }
  // In browser, if accessed via LAN IP or custom host during local/testing development, bind to that host's port 3000
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    !window.location.hostname.endsWith(".vercel.app")
  ) {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  if (envUrl) {
    return envUrl;
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  return (process.env.BACKEND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

export function getSocketUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim().replace(/\/+$/, "");
  // If a production or custom URL is configured in env (not localhost), strictly prioritize it
  if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")) {
    return envUrl;
  }
  // In browser, if accessed via LAN IP or custom host during local/testing development, bind to that host's port 3001
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    !window.location.hostname.endsWith(".vercel.app")
  ) {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  if (envUrl) {
    return envUrl;
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return "http://127.0.0.1:3001";
}

/**
 * Validates and normalizes callback URLs to ensure they are safe internal paths.
 * Prevents open redirects, protocol-relative attacks (`//evil.com`), and backslash escapes.
 */
export function getSafeCallbackUrl(
  rawUrl: string | null | undefined,
  defaultUrl: string = "/"
): string {
  if (!rawUrl) return defaultUrl;
  let trimmed = rawUrl.trim();
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch {
    // Keep trimmed as-is if decoding fails
  }

  // Allow standard relative paths starting with single '/'
  // Strictly disallow '//' and '/\'
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\")
  ) {
    return trimmed;
  }

  // If absolute URL, only permit if it shares origin with the current window/environment
  try {
    const base = typeof window !== "undefined" ? window.location.origin : (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3003");
    const parsed = new URL(trimmed, base);
    const baseParsed = new URL(base);
    if (parsed.origin === baseParsed.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Malformed URL
  }

  return defaultUrl;
}
