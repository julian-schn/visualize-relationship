/**
 * The section 12.2 gate. The build asserts these against its own output and fails regardless
 * of what esbuild reported, because a bundler exits zero for a page that cannot open offline.
 */
export interface Violation {
  rule: string;
  detail: string;
}

/** Strips // and block comments and JSON string bodies, leaving code that would really run. */
function executable(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** The inlined graph is data, not markup, and a person's links may legitimately hold a URL. */
function withoutInlinedData(html: string): string {
  return html.replace(
    /<script[^>]*type=["']application\/json["'][^>]*>[\s\S]*?<\/script>/gi,
    " ",
  );
}

/**
 * XML namespace names look like URLs and are not. They identify a vocabulary, nothing ever
 * requests them, and a page carrying them opens offline exactly as well as one without. SVG
 * export cannot be written without them, so they are named here rather than the rule being
 * loosened to "http is fine".
 */
const NAMESPACES = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/xmlns/",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/XML/1998/namespace",
]);

export function verifyOffline(html: string): Violation[] {
  const violations: Violation[] = [];
  const markup = withoutInlinedData(html);
  const code = executable(markup);

  if (code.includes("fetch(")) {
    violations.push({
      rule: "no-fetch",
      detail: "fetch( appears in the bundle; it is blocked by CORS on file:// and will fail",
    });
  }

  for (const pattern of [/\bXMLHttpRequest\b/, /\bimportScripts\s*\(/, /\bnew\s+WebSocket\b/]) {
    const found = pattern.exec(code);
    if (found) {
      violations.push({ rule: "no-network", detail: `${found[0]} appears in the bundle` });
    }
  }

  // Any src or href reaching outside the document, rather than a data: URI or a fragment.
  const external = /\b(?:src|href)\s*=\s*["']((?!data:|#)[^"']*)["']/gi;
  for (const match of markup.matchAll(external)) {
    violations.push({
      rule: "no-external-reference",
      detail: `${match[0].slice(0, 60)} points outside the file`,
    });
  }

  const url = /https?:\/\/[^\s"'`<>)]+/g;
  for (const match of code.matchAll(url)) {
    if (NAMESPACES.has(match[0])) continue;
    violations.push({ rule: "no-remote-url", detail: `${match[0].slice(0, 60)} is a remote URL` });
  }

  return violations;
}

export function assertOffline(html: string): void {
  const violations = verifyOffline(html);
  if (violations.length === 0) return;

  const lines = violations.map((violation) => `  ${violation.rule}: ${violation.detail}`);
  throw new Error(`the built page is not self-contained:\n${lines.join("\n")}`);
}
