import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl } from "@/lib/urlUtils";

const BACKEND_URL = (process.env.BACKEND_URL || getBackendUrl()).replace(/\/+$/, "");

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BACKEND_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ status: "error", error: `Backend status: ${res.status}` }, { status: 502 });
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
    const timeout = setTimeout(() => controller.abort(), (body.timeoutMs || 50000) + 20000);

    // 1. Dispatch execution to BullMQ via Backend REST API
    const runRes = await fetch(`${BACKEND_URL}/api/execution/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: body.language,
        sourceCode: body.code || body.sourceCode,
        stdin: body.input || body.stdin || "",
        roomId: body.roomId,
        fileId: body.fileId,
        userId: body.userId,
      }),
      signal: controller.signal,
    });

    if (!runRes.ok) {
      const err = await runRes.json().catch(() => ({}));
      clearTimeout(timeout);
      return NextResponse.json(
        { success: false, error: err.error || `Execution dispatch failed (${runRes.status})` },
        { status: runRes.status }
      );
    }

    const { executionId } = await runRes.json();

    // 2. Poll for execution completion from PostgreSQL
    const maxWaitMs = (body.timeoutMs || 50000) + 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 400));
      const pollRes = await fetch(`${BACKEND_URL}/api/execution/${executionId}`);
      if (pollRes.ok) {
        const { execution } = await pollRes.json();
        if (execution && execution.status !== "QUEUED" && execution.status !== "RUNNING") {
          clearTimeout(timeout);
          return NextResponse.json({
            success: execution.status === "COMPLETED",
            stdout: execution.stdout || "",
            stderr: execution.stderr || "",
            compilerLog: execution.compilerLog || "",
            exitCode: execution.exitCode ?? (execution.status === "COMPLETED" ? 0 : 1),
            executionTimeMs: execution.executionTimeMs || (Date.now() - startTime),
            status: execution.status,
          });
        }
      }
    }

    clearTimeout(timeout);
    return NextResponse.json({
      success: false,
      stdout: "",
      stderr: "Execution timed out waiting for worker",
      compilerLog: "",
      exitCode: 124,
      executionTimeMs: maxWaitMs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Execution error: ${err.message}` },
      { status: 500 }
    );
  }
}
