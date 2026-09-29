/**
 * CodeCollab Antigravity & Editor Parser
 * 
 * Injects syntax and semantic analysis into Monaco editor inputs.
 * Detects the iconic "import antigravity" easter egg across languages
 * (Python, JavaScript/TypeScript, C++, and magic comments) and generates
 * structured telemetry, Monaco editor inline glyph decorations, and UI triggers.
 */

export interface AntigravityTriggerResult {
  isTriggered: boolean;
  line: number;
  column: number;
  statement: string;
  syntax: "python" | "javascript" | "cpp" | "comment" | "generic";
  mode: "zero-g" | "space" | "hyper";
  message: string;
  quote: string;
}

export const XKCD_ANTIGRAVITY_QUOTES = [
  "“You're flying! How?” — “Python!” — “How?” — “I just typed `import antigravity`!”",
  "“I wrote 20 lines of code using Python... and now gravity is completely optional.”",
  "“I found it: `import antigravity`! Everything is fun again!”",
  "“Sub-orbital trajectory locked. Zero-G physics field active.”",
  "“Warning: Anti-gravitational field active. Hold on to your Monaco editor panels!”",
];

/**
 * Regex patterns detecting antigravity import triggers in multiple language formats.
 */
const ANTIGRAVITY_PATTERNS = [
  // Python: import antigravity, from antigravity import ...
  {
    regex: /^\s*import\s+antigravity(?:\s+as\s+[a-zA-Z_]\w*)?/m,
    syntax: "python" as const,
  },
  {
    regex: /^\s*from\s+antigravity\s+import\s+/m,
    syntax: "python" as const,
  },
  // JS/TS: import "antigravity", import * as ag from 'antigravity', require('antigravity')
  {
    regex: /^\s*import\s+['"]antigravity['"]/m,
    syntax: "javascript" as const,
  },
  {
    regex: /^\s*import\s+(?:(?:\*\s+as\s+\w+)|(?:\w+)|(?:{[^}]+}))\s+from\s+['"]antigravity['"]/m,
    syntax: "javascript" as const,
  },
  {
    regex: /require\s*\(\s*['"]antigravity['"]\s*\)/m,
    syntax: "javascript" as const,
  },
  // C++: #include <antigravity> or #include "antigravity"
  {
    regex: /^\s*#\s*include\s*[<"]antigravity(?:.h)?[>"]/m,
    syntax: "cpp" as const,
  },
  // Magic comment: // antigravity, # antigravity, /* antigravity */
  {
    regex: /(?:\/\/|#|\/\*)\s*antigravity(?:\s*:\s*mode=(zero-g|space|hyper))?/i,
    syntax: "comment" as const,
  },
];

/**
 * Parses code for the antigravity easter egg trigger.
 * Examines line-by-line to extract precise line numbers, columns, and custom modes.
 */
export function parseAntigravityTrigger(code: string, language?: string): AntigravityTriggerResult {
  if (!code || !code.toLowerCase().includes("antigravity")) {
    return {
      isTriggered: false,
      line: 0,
      column: 0,
      statement: "",
      syntax: "generic",
      mode: "zero-g",
      message: "",
      quote: "",
    };
  }

  const lines = code.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? "";
    const lower = rawLine.toLowerCase();

    if (!lower.includes("antigravity")) continue;

    for (const pattern of ANTIGRAVITY_PATTERNS) {
      const match = rawLine.match(pattern.regex);
      if (match) {
        const colIdx = (match.index ?? 0) + 1;
        const matchedStr = match[0].trim();

        // Check if a mode was specified (e.g. mode=space or mode=hyper)
        let mode: "zero-g" | "space" | "hyper" = "zero-g";
        if (lower.includes("mode=hyper") || lower.includes("hyper")) {
          mode = "hyper";
        } else if (lower.includes("mode=space") || lower.includes("space")) {
          mode = "space";
        }

        const quote = XKCD_ANTIGRAVITY_QUOTES[lineIdx % XKCD_ANTIGRAVITY_QUOTES.length]!;

        return {
          isTriggered: true,
          line: lineIdx + 1,
          column: colIdx,
          statement: matchedStr,
          syntax: pattern.syntax,
          mode,
          message: `Zero-G Inversion Triggered on line ${lineIdx + 1}! (${matchedStr})`,
          quote,
        };
      }
    }
  }

  // Fallback if "antigravity" string is present as an isolated token
  const genericIndex = lines.findIndex((l) => /\bantigravity\b/i.test(l));
  if (genericIndex !== -1) {
    return {
      isTriggered: true,
      line: genericIndex + 1,
      column: lines[genericIndex]!.toLowerCase().indexOf("antigravity") + 1,
      statement: lines[genericIndex]!.trim(),
      syntax: "generic",
      mode: "zero-g",
      message: `Zero-G Inversion Triggered on line ${genericIndex + 1}!`,
      quote: XKCD_ANTIGRAVITY_QUOTES[0]!,
    };
  }

  return {
    isTriggered: false,
    line: 0,
    column: 0,
    statement: "",
    syntax: "generic",
    mode: "zero-g",
    message: "",
    quote: "",
  };
}

/**
 * Creates Monaco Editor inline decorations and glyph margin markers
 * to visually highlight the antigravity trigger right in the editor.
 */
export function getAntigravityEditorDecorations(
  parseResult: AntigravityTriggerResult,
  monaco: typeof import("monaco-editor")
): import("monaco-editor").editor.IModelDeltaDecoration[] {
  if (!parseResult.isTriggered || parseResult.line <= 0) {
    return [];
  }

  return [
    {
      range: new monaco.Range(
        parseResult.line,
        1,
        parseResult.line,
        parseResult.statement.length + 10
      ),
      options: {
        isWholeLine: true,
        className: "antigravity-code-highlight",
        glyphMarginClassName: "antigravity-glyph-margin",
        hoverMessage: [
          { value: "**🌌 Antigravity Zero-G Engine Active**" },
          { value: `*${parseResult.quote}*` },
          { value: "Panel physics unlocked • Gravitational pull: 0.00 m/s²" },
        ],
      },
    },
  ];
}
