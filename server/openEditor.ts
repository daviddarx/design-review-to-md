import { spawn } from "node:child_process"
import path from "node:path"

export class EditorTargetError extends Error {}

// "<abs file>:<line>" for `code -g`, refusing anything outside the repo.
export function resolveEditorTarget(repoRoot: string, file: unknown, line: unknown): string {
  if (typeof file !== "string" || !file || file.includes("\0")) {
    throw new EditorTargetError("Invalid file")
  }
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw new EditorTargetError("Invalid line")
  }
  const rootAbs = path.resolve(repoRoot)
  const abs = path.resolve(rootAbs, file)
  if (!abs.startsWith(rootAbs + path.sep)) {
    throw new EditorTargetError("File is outside the repository")
  }
  return `${abs}:${line}`
}

export function openEditor(repoRoot: string, file: unknown, line: unknown) {
  const target = resolveEditorTarget(repoRoot, file, line)
  const child = spawn("code", ["-g", target], { stdio: "ignore", detached: true })
  child.on("error", (err) => console.error(`[design-review] could not run code: ${err.message}`))
  child.unref()
}
