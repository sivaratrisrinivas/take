import { describe, it, expect, vi, beforeEach } from "vitest"
import { sendText, sendImage, sendAudio } from "../api"

describe("sendText", () => {
  it("sends JSON with type text when socket is open", () => {
    const ws = { readyState: 1, send: vi.fn() }
    sendText(ws, "hello director")
    expect(ws.send).toHaveBeenCalledOnce()
    const payload = JSON.parse(ws.send.mock.calls[0][0])
    expect(payload.type).toBe("text")
    expect(payload.text).toBe("hello director")
  })

  it("does nothing when socket is not open", () => {
    const ws = { readyState: 0, send: vi.fn() }
    sendText(ws, "hello")
    expect(ws.send).not.toHaveBeenCalled()
  })

  it("does nothing when ws is null", () => {
    expect(() => sendText(null, "hello")).not.toThrow()
  })
})

describe("sendImage", () => {
  it("sends JSON with type image and strips data URI prefix", () => {
    const ws = { readyState: 1, send: vi.fn() }
    sendImage(ws, "data:image/jpeg;base64,abc123")
    const payload = JSON.parse(ws.send.mock.calls[0][0])
    expect(payload.type).toBe("image")
    expect(payload.data).toBe("abc123")
    expect(payload.mimeType).toBe("image/jpeg")
  })

  it("sends raw base64 as-is when no data URI prefix", () => {
    const ws = { readyState: 1, send: vi.fn() }
    sendImage(ws, "rawbase64data")
    const payload = JSON.parse(ws.send.mock.calls[0][0])
    expect(payload.data).toBe("rawbase64data")
  })

  it("does nothing when socket is closed", () => {
    const ws = { readyState: 3, send: vi.fn() }
    sendImage(ws, "abc")
    expect(ws.send).not.toHaveBeenCalled()
  })
})

describe("sendAudio", () => {
  it("sends binary ArrayBuffer directly", () => {
    const ws = { readyState: 1, send: vi.fn() }
    const buf = new ArrayBuffer(16)
    sendAudio(ws, buf)
    expect(ws.send).toHaveBeenCalledWith(buf)
  })

  it("does nothing when socket is not open", () => {
    const ws = { readyState: 2, send: vi.fn() }
    sendAudio(ws, new ArrayBuffer(8))
    expect(ws.send).not.toHaveBeenCalled()
  })
})
