import { useState } from "react"
import { suggestTopicName } from "./listModel.ts"

const NEW = "\u0000new"

type TopicSelectProps = {
  topics: string[]
  topic: string | null
  onChange(topic: string): void
  onCreate(name: string): Promise<void>
  onOpen(): void // refresh the folder list before it is shown
}

// Topic folders in a native select; "New topic…" swaps it for an inline
// field holding a name suggested from the current URL.
export function TopicSelect({ topics, topic, onChange, onCreate, onOpen }: TopicSelectProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (draft !== null) {
    const submit = async () => {
      const name = draft.trim()
      if (!name || busy) return
      setBusy(true)
      try {
        await onCreate(name)
        setDraft(null)
      } catch {
        // The panel shows the error; the field stays open for a retry.
      } finally {
        setBusy(false)
      }
    }
    return (
      <input
        className="dr-input dr-topic"
        aria-label="New topic name"
        autoFocus
        value={draft}
        disabled={busy}
        placeholder="Topic name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => !busy && setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setDraft(null)
          }
        }}
      />
    )
  }

  return (
    <select
      className="dr-input dr-topic"
      aria-label="Topic"
      value={topic ?? ""}
      onPointerDown={onOpen}
      onFocus={onOpen}
      onChange={(e) => {
        if (e.target.value === NEW) setDraft(suggestTopicName(location.pathname))
        else if (e.target.value) onChange(e.target.value)
      }}
    >
      {!topic && (
        <option value="" disabled>
          Choose a topic
        </option>
      )}
      {topic && !topics.includes(topic) && <option value={topic}>{topic}</option>}
      {topics.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value={NEW}>New topic…</option>
    </select>
  )
}
