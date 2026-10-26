// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { readConfig } from "./config.ts"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("readConfig", () => {
  it("reads the markers the server wrote into the document", () => {
    document.body.innerHTML = `<script id="dr-config" type="application/json">{"markers":["data-tour-id"]}</script>`
    expect(readConfig()).toEqual({ markers: ["data-tour-id"] })
  })

  it("falls back to no markers when the config is missing or junk", () => {
    expect(readConfig()).toEqual({ markers: [] })
    document.body.innerHTML = `<script id="dr-config" type="application/json">{"markers":[1,"x"]}</script>`
    expect(readConfig()).toEqual({ markers: ["x"] })
    document.body.innerHTML = `<script id="dr-config" type="application/json">nope</script>`
    expect(readConfig()).toEqual({ markers: [] })
  })
})
