import { describe, it, expect } from "vitest"
import parseTranscript from "../parseTranscript"

describe("parseTranscript", () => {
  it("returns null for empty input", () => {
    expect(parseTranscript("")).toBeNull()
    expect(parseTranscript(null)).toBeNull()
    expect(parseTranscript(undefined)).toBeNull()
  })

  it("returns null for very short input", () => {
    expect(parseTranscript("Too short.")).toBeNull()
  })

  it("parses spoken markers correctly", () => {
    const input = `The room glows with an eerie light, shadows dancing on the walls.
Now for the camera. Slow dolly forward through the doorway.
Now for the lighting. Deep blue moonlight with amber practicals.
Now for the music. A single cello playing a minor key melody.`

    const result = parseTranscript(input)
    expect(result).not.toBeNull()
    expect(result.narration).toContain("eerie light")
    expect(result.camera).toContain("dolly")
    expect(result.lighting).toContain("blue moonlight")
    expect(result.music).toContain("cello")
  })

  it("handles case-insensitive markers", () => {
    const input = `A vast desert stretches endlessly under a scorching sun.
NOW FOR THE CAMERA. Wide aerial tracking shot.
NOW FOR THE LIGHTING. Harsh overhead sunlight.
NOW FOR THE MUSIC. Sparse acoustic guitar.`

    const result = parseTranscript(input)
    expect(result).not.toBeNull()
    expect(result.camera).toContain("aerial")
  })

  it("strips markdown bold/italic", () => {
    const input = `**The corridor** stretches *into darkness*, with *cold* fluorescent lights.
Now for the camera. Symmetrical wide shot.
Now for the lighting. Cold fluorescent overhead.
Now for the music. Industrial ambient drone.`

    const result = parseTranscript(input)
    expect(result.narration).not.toContain("**")
    expect(result.narration).not.toContain("*")
    expect(result.narration).toContain("The corridor")
  })

  it("falls back to keyword-based parsing when no markers", () => {
    const input =
      "A man walks through the rain. " +
      "The camera tracks him from behind in a steadicam shot. " +
      "Neon shadows paint the wet street in desaturated greens. " +
      "A synth score pulses underneath."

    const result = parseTranscript(input)
    expect(result).not.toBeNull()
    expect(result.narration).toContain("man walks")
    expect(result.camera).toContain("steadicam")
    expect(result.lighting).toContain("desaturated")
    expect(result.music).toContain("synth")
  })

  it("handles text with only narration (no cinematic keywords)", () => {
    const input =
      "She opened the door to find the room empty. " +
      "The table was set for two but no one had come. " +
      "A single rose lay wilting in a glass vase."

    const result = parseTranscript(input)
    expect(result).not.toBeNull()
    expect(result.narration.length).toBeGreaterThan(0)
  })

  it("returns all four section keys", () => {
    const input =
      "A long and detailed scene description that is definitely over thirty characters in length. " +
      "Now for the camera. Crane shot. " +
      "Now for the lighting. Golden hour. " +
      "Now for the music. Piano sonata."

    const result = parseTranscript(input)
    expect(result).toHaveProperty("narration")
    expect(result).toHaveProperty("camera")
    expect(result).toHaveProperty("lighting")
    expect(result).toHaveProperty("music")
  })
})
