import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

// shell.css is not imported here: the shell document links
// /__review/shell.css, which the server reads straight from shell/shell.css.
createRoot(document.getElementById("root")!).render(<App />)
