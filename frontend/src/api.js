const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000"

/**
 * Open a bidi-streaming WebSocket to the ADK backend.
 * @param {string} userId
 * @param {string} sessionId
 * @param {{ onEvent: (event: object) => void, onOpen: (ws: WebSocket) => void, onClose: () => void }} callbacks
 * @returns {WebSocket}
 */
export function createSession(userId, sessionId, { onEvent, onOpen, onClose }) {
  const url = `${WS_BASE_URL}/ws/${userId}/${sessionId}`
  const ws = new WebSocket(url)

  ws.onopen = () => {
    onOpen?.(ws)
  }

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data)
      onEvent?.(event)
    } catch {}
  }

  ws.onclose = () => {
    onClose?.()
  }

  ws.onerror = () => {}

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
