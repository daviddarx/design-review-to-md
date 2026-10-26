// What the app's `review` script set on the command line, written into the
// shell document by the server (server/server.ts, shellHtml).
export type ShellConfig = { markers: string[] }

export function readConfig(doc: Document = document): ShellConfig {
  try {
    const raw: unknown = JSON.parse(doc.getElementById("dr-config")?.textContent ?? "")
    const markers = (raw as { markers?: unknown })?.markers
    return {
      markers: Array.isArray(markers) ? markers.filter((m) => typeof m === "string") : [],
    }
  } catch {
    return { markers: [] }
  }
}
