import { NextRequest, NextResponse } from "next/server";

const DAEMON_PORT = process.env.LOCAL_RUNNER_PORT || 4000;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${DAEMON_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ status: "error", error: `Daemon status: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ status: "down", error: err.message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (body.timeoutMs || 10000) + 5000);

    const res = await fetch(`${DAEMON_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Proxy daemon error: ${err.message}` },
      { status: 500 }
    );
  }
}
