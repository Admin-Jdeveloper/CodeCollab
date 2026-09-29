/**
 * CodeCollab Diagnostic & Error Parser
 * Parses compiler logs, stderr, and stack traces for C++, Python, and JavaScript
 * into structured diagnostics with line numbers, column numbers, and severity.
 */

export interface DiagnosticItem {
  id: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  rawText: string;
}

export interface ParsedExecutionResult {
  stdout: string;
  stderr: string;
  compilerLog: string;
  exitCode: number;
  executionTimeMs: number;
  diagnostics: DiagnosticItem[];
  runtimeType: "local-daemon" | "wasm-client" | "js-worker";
}

/**
 * Parses C++ compiler diagnostics (GCC / Clang).
 * Example lines:
 *   main.cpp:14:5: error: 'x' was not declared in this scope
 *   main.cpp:21:10: warning: unused variable 'i' [-Wunused-variable]
 *   /usr/bin/ld: undefined reference to 'main'
 */
export function parseCppErrors(rawText: string): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const lines = rawText.split("\n");

  // Regex matching: filename:line:col: severity: message (supports Windows drive letters C:\)
  const gccClangRegex = /^(?:[a-zA-Z]:)?[^:\r\n]+:(\d+):(?:(\d+):)?\s*(error|fatal error|warning|note):\s*(.+)$/i;
  // Regex matching linker error
  const linkerRegex = /undefined reference to `?([^']+)'?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(gccClangRegex);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      const colNum = match[2] ? parseInt(match[2], 10) : undefined;
      const rawSeverity = match[3].toLowerCase();
      const message = match[4].trim();

      let severity: "error" | "warning" | "info" = "error";
      if (rawSeverity.includes("warning")) severity = "warning";
      if (rawSeverity.includes("note")) severity = "info";

      // Lookahead for code excerpt on next lines (often GCC shows snippet and ^)
      let sourceSnippet: string | undefined;
      if (i + 1 < lines.length && !lines[i + 1].match(gccClangRegex)) {
        sourceSnippet = lines[i + 1];
        if (i + 2 < lines.length && lines[i + 2].includes("^")) {
          sourceSnippet += "\n" + lines[i + 2];
        }
      }

      diagnostics.push({
        id: `cpp-diag-${i}-${lineNum}`,
        line: lineNum,
        column: colNum,
        severity,
        message,
        source: sourceSnippet,
        rawText: line,
      });
      continue;
    }

    // Linker errors
    const linkerMatch = line.match(linkerRegex);
    if (linkerMatch) {
      diagnostics.push({
        id: `cpp-linker-${i}`,
        line: 1,
        severity: "error",
        message: `Linker Error: Undefined reference to '${linkerMatch[1]}'. Did you include the main() function?`,
        rawText: line,
      });
    }
  }

  return diagnostics;
}

/**
 * Parses Python tracebacks and syntax errors.
 * Example:
 *   File "<exec>", line 12, in <module>
 *     x = 10 / 0
 *   ZeroDivisionError: division by zero
 *
 *   File "<string>", line 4
 *     if x == 5
 *             ^
 *   SyntaxError: expected ':'
 */
export function parsePythonErrors(rawText: string): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const lines = rawText.split("\n");

  // Regex for "File ... line X"
  const fileLineRegex = /File\s+["'].*?["'],\s+line\s+(\d+)(?:,\s+in\s+(.+))?/i;
  // Regex for Python exception header
  const errorTypeRegex = /^([A-Z][a-zA-Z0-9_]*Error|[A-Z][a-zA-Z0-9_]*Exception):\s*(.*)$/;

  let lastLineNum: number | null = null;
  let lastSnippet: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fileMatch = line.match(fileLineRegex);
    if (fileMatch) {
      lastLineNum = parseInt(fileMatch[1], 10);
      // Next line is often the snippet
      if (i + 1 < lines.length && lines[i + 1].startsWith("    ")) {
        lastSnippet = lines[i + 1].trim();
        if (i + 2 < lines.length && lines[i + 2].includes("^")) {
          lastSnippet += "\n" + lines[i + 2].trim();
        }
      }
      continue;
    }

    const errMatch = trimmed.match(errorTypeRegex);
    if (errMatch) {
      const errName = errMatch[1];
      const errDesc = errMatch[2] || "Error occurred during execution";
      const targetLine = lastLineNum ?? 1;

      diagnostics.push({
        id: `py-diag-${i}-${targetLine}`,
        line: targetLine,
        severity: "error",
        message: `${errName}: ${errDesc}`,
        source: lastSnippet ?? undefined,
        rawText: trimmed,
      });
      lastLineNum = null;
      lastSnippet = null;
    }
  }

  // Fallback for simple "SyntaxError: ..." without "File" header
  if (diagnostics.length === 0 && rawText.includes("Error")) {
    const lineMatch = rawText.match(/line\s+(\d+)/i);
    const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : 1;
    const msgMatch = rawText.match(/([a-zA-Z]+Error:[^\n]+)/);
    if (msgMatch) {
      diagnostics.push({
        id: `py-fallback-0`,
        line: lineNum,
        severity: "error",
        message: msgMatch[1],
        rawText: msgMatch[1],
      });
    }
  }

  return diagnostics;
}

/**
 * Parses JavaScript runtime errors and stack traces.
 * Example:
 *   ReferenceError: counter is not defined
 *       at main (eval at executeJS (<anonymous>:15:5), <anonymous>:4:13)
 *   SyntaxError: Unexpected token ';'
 */
export function parseJavaScriptErrors(rawText: string, errorObj?: any): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  const textToParse = errorObj?.stack || rawText;
  const lines = textToParse.split("\n");

  // V8 stack line regex: at functionName (<anonymous>:line:col) or at eval (<anonymous>:line:col)
  const v8StackRegex = /(?:eval at [^,]+,\s+)?(?:<anonymous>|eval|at)\s*:?(\d+):(\d+)/i;
  // Generic line number regex: line 12: col 5 or :12:5
  const genericLineRegex = /:(\d+):(\d+)/;

  const firstLine = lines[0]?.trim() || "Error";
  let targetLine = 1;
  let targetCol: number | undefined;

  for (const line of lines) {
    const v8Match = line.match(v8StackRegex);
    if (v8Match) {
      targetLine = parseInt(v8Match[1], 10);
      targetCol = parseInt(v8Match[2], 10);
      break;
    }
    const genericMatch = line.match(genericLineRegex);
    if (genericMatch) {
      targetLine = parseInt(genericMatch[1], 10);
      targetCol = parseInt(genericMatch[2], 10);
      break;
    }
  }

  diagnostics.push({
    id: `js-diag-0`,
    line: targetLine,
    column: targetCol,
    severity: "error",
    message: firstLine,
    rawText: textToParse,
  });

  return diagnostics;
}

/**
 * Master parser that dispatches to the language-specific diagnostic parser
 */
export function parseDiagnostics(
  language: string, // widened — supports any workspace file language
  output: string,
  stderr: string
): DiagnosticItem[] {
  const combined = `${stderr}\n${output}`.trim();
  if (!combined) return [];

  switch (language) {
    case "cpp":
      return parseCppErrors(combined);
    case "python":
      return parsePythonErrors(combined);
    case "javascript":
      return parseJavaScriptErrors(combined);
    default:
      return [];
  }
}
