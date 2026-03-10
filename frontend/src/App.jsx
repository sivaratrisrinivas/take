import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { createSession, sendText, sendImage } from "./api"
import OutputPanel from "./components/OutputPanel"
import StyleSelector from "./components/StyleSelector"

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

function uid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

/**
 * AudioPlayer — queued playback of PCM16 audio chunks from Gemini Live API.
 */
class AudioPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate
    this.ctx = null
    this.nextStartTime = 0
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate,
      })
    }
    if (this.ctx.state === "suspended") this.ctx.resume()
    return this.ctx
  }

  playPcm16(base64Data) {
    try {
      const ctx = this._ensureContext()

      // URL-safe base64 → standard base64
      let b64 = base64Data.replace(/-/g, "+").replace(/_/g, "/")
      while (b64.length % 4 !== 0) b64 += "="
      const raw = atob(b64)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)

      // PCM16 → Float32
      const int16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0

      const buffer = ctx.createBuffer(1, float32.length, this.sampleRate)
      buffer.getChannelData(0).set(float32)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)

      const now = ctx.currentTime
      const startAt = Math.max(now, this.nextStartTime)
      source.start(startAt)
      this.nextStartTime = startAt + buffer.duration
    } catch (err) {
      console.warn("Audio playback error:", err)
    }
  }

  stop() {
    this.nextStartTime = 0
    if (this.ctx) {
      this.ctx.close()
      this.ctx = null
    }
  }
}

export default function App() {
  /* ── refs ── */
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const frameIntervalRef = useRef(null)
  const streamRef = useRef(null)
  const audioPlayerRef = useRef(new AudioPlayer())

  /* ── state ── */
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [selectedStyle, setSelectedStyle] = useState("")
  const [events, setEvents] = useState([])
  const [storyboard, setStoryboard] = useState(null)
  const storyboardGeneratedRef = useRef(false)
  const [video, setVideo] = useState(null)

  /* ── camera setup ── */
  useEffect(() => {
    let active = true

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera not supported in this browser.")
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 1280, height: 720 },
          audio: false,
        })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setCameraReady(true)
      } catch {
        setCameraError("Camera access denied.")
      }
    }

    startCamera()
    return () => {
      active = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  /* ── capture frame ── */
  const captureFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null

    const w = video.videoWidth || 640
    const h = video.videoHeight || 480
    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1]
  }, [])

  /* ── extract audio from ADK events ── */
  const processAudioFromEvent = useCallback((event) => {
    const parts = event?.content?.parts
    if (parts) {
      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data
        if (inlineData?.data) {
          const mime = inlineData.mimeType || inlineData.mime_type || ""
          if (
            mime.startsWith("audio/") ||
            mime.includes("pcm") ||
            mime.includes("raw")
          ) {
            audioPlayerRef.current.playPcm16(inlineData.data)
            return true
          }
        }
      }
    }

    const serverContent = event?.serverContent
    if (serverContent?.modelTurn?.parts) {
      for (const part of serverContent.modelTurn.parts) {
        const inlineData = part.inlineData || part.inline_data
        if (inlineData?.data) {
          const mime = inlineData.mimeType || inlineData.mime_type || ""
          if (
            mime.startsWith("audio/") ||
            mime.includes("pcm") ||
            mime.includes("raw")
          ) {
            audioPlayerRef.current.playPcm16(inlineData.data)
            return true
          }
        }
      }
    }

    return false
  }, [])

  /* ── connect / disconnect ── */
  const handleConnect = useCallback(() => {
    if (isConnected) {
      wsRef.current?.close()
      wsRef.current = null
      clearInterval(frameIntervalRef.current)
      audioPlayerRef.current.stop()
      audioPlayerRef.current = new AudioPlayer()
      setIsConnected(false)
      setIsStreaming(false)
      return
    }

    const userId = "user-" + uid()
    const sessionId = "session-" + uid()

    const ws = createSession(userId, sessionId, {
      onOpen: () => {
        setIsConnected(true)
        frameIntervalRef.current = setInterval(() => {
          const frame = captureFrame()
          if (frame) sendImage(ws, frame)
        }, 1000)
        setIsStreaming(true)
      },
      onEvent: (event) => {
        setEvents((prev) => [...prev, event])
        processAudioFromEvent(event)
      },
      onClose: () => {
        setIsConnected(false)
        setIsStreaming(false)
        clearInterval(frameIntervalRef.current)
      },
    })

    wsRef.current = ws
  }, [isConnected, captureFrame, processAudioFromEvent])

  /* ── style selection ── */
  const handleStyleSelect = useCallback((styleId) => {
    setSelectedStyle(styleId)
    setEvents([])
    setStoryboard(null)
    storyboardGeneratedRef.current = false
    audioPlayerRef.current.nextStartTime = 0
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendText(
        wsRef.current,
        `The user has selected the "${styleId}" cinematic style. ` +
          `Direct everything you see in this style. Start narrating now.`
      )
    }
  }, [])

  /* ── storyboard generation (3 frames at session end) ── */
  const generateStoryboard = useCallback(async (transcript) => {
    if (storyboardGeneratedRef.current || !selectedStyle || !transcript) return
    storyboardGeneratedRef.current = true
    setStoryboard({ loading: true })


    try {
      const frameB64 = captureFrame() || ""
      const third = Math.floor(transcript.length / 3)

      // 3 prompts: beginning, middle, end of the transcript
      const prompts = [
        { narration: transcript.slice(0, third).trim(),         label: "Opening shot" },
        { narration: transcript.slice(third, third * 2).trim(), label: "Development" },
        { narration: transcript.slice(third * 2).trim(),        label: "Climax" },
      ]

      const results = await Promise.allSettled(
        prompts.map(p =>
          fetch(`${API_BASE}/api/storyboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              style: selectedStyle,
              narration: p.narration,
              camera: p.label,
              lighting: "",
              frame_base64: frameB64,
            }),
          }).then(r => r.json())
        )
      )

      const images = results
        .filter(r => r.status === "fulfilled" && r.value.image)
        .map(r => ({ image: r.value.image, mime_type: r.value.mime_type }))

      if (images.length > 0) {
        setStoryboard({ images })
      } else {
        setStoryboard({ error: "Storyboard generation failed" })
      }
    } catch (err) {
      setStoryboard({ error: "Storyboard generation failed" })
    }
  }, [selectedStyle, captureFrame])

  /* ── extract transcript text for storyboard ── */
  const transcriptText = useMemo(
    () => events.map(e => {
      const parts = e?.content?.parts
      if (parts) return parts.map(p => p.text || "").join("")
      if (e?.serverContent?.outputTranscription?.text) return e.serverContent.outputTranscription.text
      if (e?.transcript) return e.transcript
      return ""
    }).filter(Boolean).join(""),
    [events]
  )

  /* ── trigger storyboard when session ends ── */
  useEffect(() => {
    // Generate storyboard when session disconnects and we have transcript
    if (!isConnected && transcriptText.length > 100 && selectedStyle && !storyboardGeneratedRef.current) {
      generateStoryboard(transcriptText)
    }
  }, [isConnected, transcriptText, selectedStyle, generateStoryboard])

  /* ── video generation via Veo 3.1 ── */
  const generateVideoClip = useCallback(async () => {
    if (!selectedStyle || !transcriptText || video?.loading) return
    setVideo({ loading: true })

    try {
      // Extract card sections for the prompt
      const sections = { narration: "", camera: "", lighting: "", music: "" }
      const text = transcriptText.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\s+/g, " ").trim()
      sections.narration = text.slice(0, 600)

      // Get first storyboard image if available
      const firstImage = storyboard?.images?.[0]?.image || storyboard?.image || ""

      const res = await fetch(`${API_BASE}/api/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: selectedStyle,
          narration: sections.narration,
          camera: sections.camera,
          lighting: sections.lighting,
          music: sections.music,
          storyboard_image_b64: firstImage,
        }),
      })

      const data = await res.json()
      if (data.video) {
        setVideo({ videoData: data.video, mimeType: data.mime_type || "video/mp4" })
      } else {
        setVideo({ error: data.error || "Video generation failed" })
      }
    } catch (err) {
      setVideo({ error: "Video generation failed" })
    }
  }, [selectedStyle, transcriptText, storyboard, video?.loading])


  /* ── cleanup ── */
  useEffect(() => {
    return () => {
      wsRef.current?.close()
      clearInterval(frameIntervalRef.current)
      audioPlayerRef.current.stop()
    }
  }, [])

  return (
    <main className="app">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ── Header ── */}
      <header className="app__header">
        <span className="app__brand">take</span>
        <div className="app__status">
          <span
            className={`app__status-dot ${isConnected ? "app__status-dot--live" : ""}`}
          />
          {cameraError ||
            (cameraReady
              ? isConnected
                ? "Live session"
                : "Ready"
              : "Initialising…")}
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div className="app__main">
        {/* Camera — the hero */}
        <div className="camera">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera__video"
          />
          {isStreaming && (
            <div className="camera__badge">
              <span className="camera__rec-dot" />
              Live
            </div>
          )}
          <div className="camera__controls">
            <button
              type="button"
              onClick={handleConnect}
              disabled={!cameraReady}
              className={`btn-action ${isConnected ? "btn-action--stop" : "btn-action--start"}`}
            >
              {isConnected ? "End Session" : "Start Directing"}
            </button>
          </div>
        </div>

        {/* Style strip — below camera */}
        <StyleSelector
          selected={selectedStyle}
          onSelect={handleStyleSelect}
          disabled={!isConnected}
        />

        {/* Output panel — right column */}
        <OutputPanel
          events={events}
          isConnected={isConnected}
          storyboard={storyboard}
          video={video}
          onGenerateVideo={generateVideoClip}
        />
      </div>
    </main>
  )
}
