// What the app's `review` script set on the command line, written into the
// shell document by the server (server/server.ts, shellHtml). `remote` is
// there when reviewing a deployed site (npm run review:remote).
export type ShellConfig = { markers: string[]; remote?: { url: string; round: string } }

export function readConfig(doc: Document = document): ShellConfig {
  try {
    const raw = JSON.parse(doc.getElementById("dr-config")?.textContent ?? "") as {
      markers?: unknown
      remote?: { url?: unknown; round?: unknown }
    } | null
    const markers = raw?.markers
    const config: ShellConfig = {
      markers: Array.isArray(markers) ? markers.filter((m) => typeof m === "string") : [],
    }
    const remote = raw?.remote
    if (remote && typeof remote.url === "string" && typeof remote.round === "string") {
      config.remote = { url: remote.url, round: remote.round }
    }
    return config
  } catch {
    return { markers: [] }
  }
}
