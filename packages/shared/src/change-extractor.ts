/**
 * Parses AI agent responses into structured file changes.
 *
 * Supports two formats:
 *
 * 1. XML-style (preferred, instructed in workspace system prompt):
 *    <file path="src/foo.ts" action="modify">
 *    file content here
 *    </file>
 *
 * 2. Fenced code blocks with path metadata:
 *    ```ts path="src/foo.ts"
 *    file content here
 *    ```
 */

export type FileChange = {
  path: string;
  content: string | null; // null = delete
  action: "create" | "modify" | "delete";
};

export function extractFileChanges(text: string): FileChange[] {
  const changes: FileChange[] = [];
  const seen = new Set<string>();

  // 1. XML-style: <file path="..." action="...">...</file>
  const xmlRegex = /<file\s+path="([^"]+)"(?:\s+action="(create|modify|delete)")?\s*>([\s\S]*?)<\/file>/g;
  let match;
  while ((match = xmlRegex.exec(text)) !== null) {
    const path = match[1]!;
    const action = (match[2] as FileChange["action"]) ?? "modify";
    const content = action === "delete" ? null : trimFileContent(match[3]!);
    if (!seen.has(path)) {
      seen.add(path);
      changes.push({ path, content, action });
    }
  }

  // 2. Fenced blocks with path: ```lang path="..."
  const fencedRegex = /```\w*\s+path="([^"]+)"\s*\n([\s\S]*?)```/g;
  while ((match = fencedRegex.exec(text)) !== null) {
    const path = match[1]!;
    const content = trimFileContent(match[2]!);
    if (!seen.has(path)) {
      seen.add(path);
      changes.push({ path, content, action: "modify" });
    }
  }

  return changes;
}

function trimFileContent(content: string): string {
  // Remove leading/trailing blank line but preserve internal formatting
  return content.replace(/^\n/, "").replace(/\n$/, "");
}
