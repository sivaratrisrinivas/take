const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000"

/**
 * Open a bidi-streaming WebSocket to the ADK backend.
 * @param {string} userId
 * @param {string} sessionId
 * @param {(event: object) => void} onEvent  - fired for every ADK event
 * @param {() => void}            onOpen
 * @param {() => void}            onClose
 * @returns {WebSocket}
 */
export function createSession(userId, sessionId, { onEvent, onOpen, onClose }) {
  const url = `${WS_BASE_URL}/ws/${userId}/${sessionId}`
  const ws = new WebSocket(url)

  ws.onopen = () => {
    console.log("[ws] connected", url)
    onOpen?.()
  }

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data)
      onEvent?.(event)
    } catch {
      console.warn("[ws] non-JSON message", msg.data)
    }
  }

  ws.onclose = () => {
    console.log("[ws] disconnected")
    onClose?.()
  }

  ws.onerror = (err) => {
    console.error("[ws] error", err)
  }

  return ws
}

/**
 * Send a text command through the WebSocket (e.g. style selection).
 */
export function sendText(ws, text) {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: "text", text }))
}

/**
 * Send a camera frame as a base64 image blob.
 */
export function sendImage(ws, base64Data, mimeType = "image/jpeg") {
  if (ws?.readyState !== WebSocket.OPEN) return
  // Strip data URI prefix if present
  const raw = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data
  ws.send(JSON.stringify({ type: "image", data: raw, mimeType }))
}

/**
 * Send raw PCM16 audio as a binary frame.
 */
export function sendAudio(ws, pcmArrayBuffer) {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(pcmArrayBuffer)
}
