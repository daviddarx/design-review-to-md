import { useState } from "react"
import { oneLine, suggestReviewName } from "./listModel.ts"

const NEW = "\u0000new"

type ReviewSelectProps = {
  reviews: string[]
  review: string | null
  onChange(review: string): void
  onCreate(name: string): Promise<void>
  onOpen(): void // refresh the folder list before it is shown
}

// Review folders in a native select; "New review…" swaps it for an inline
// field holding a name suggested from the current URL.
export function ReviewSelect({ reviews, review, onChange, onCreate, onOpen }: ReviewSelectProps) {
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
      <textarea
        className="dr-input dr-grow dr-review-select"
        rows={1}
        aria-label="New review name"
        autoFocus
        value={draft}
        disabled={busy}
        placeholder="Review name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(oneLine(e.target.value))}
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
      className="dr-input dr-review-select"
      aria-label="Review"
      value={review ?? ""}
      onPointerDown={onOpen}
      onFocus={onOpen}
      onChange={(e) => {
        if (e.target.value === NEW) setDraft(suggestReviewName(location.pathname))
        else if (e.target.value) onChange(e.target.value)
      }}
    >
      {!review && (
        <option value="" disabled>
          {reviews.length ? "Choose a review" : "Create a review…"}
        </option>
      )}
      {review && !reviews.includes(review) && <option value={review}>{review}</option>}
      {reviews.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value={NEW}>New review…</option>
    </select>
  )
}
