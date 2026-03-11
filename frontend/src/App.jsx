import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { createSession, sendText, sendImage } from "./api"
import OutputPanel from "./components/OutputPanel"
import StyleSelector from "./components/StyleSelector"
import parseTranscript from "./parseTranscript"

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

function uid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

const SCREEN = {
  IDLE: "idle",
  PICK_STYLE: "pickStyle",
  DIRECTING: "directing",
  REVIEW: "review",
}

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
      let b64 = base64Data.replace(/-/g, "+").replace(/_/g, "/")
      while (b64.length % 4 !== 0) b64 += "="
      const raw = atob(b64)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)

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
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const frameIntervalRef = useRef(null)
  const streamRef = useRef(null)
  const audioPlayerRef = useRef(new AudioPlayer())
  const storyboardGeneratedRef = useRef(false)

  const [screen, setScreen] = useState(SCREEN.IDLE)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [selectedStyle, setSelectedStyle] = useState("")
  const [selectedMovies, setSelectedMovies] = useState("")
  const [selectedScene, setSelectedScene] = useState("")
  const [events, setEvents] = useState([])
  const [storyboard, setStoryboard] = useState(null)
  const [video, setVideo] = useState(null)

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
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setCameraReady(true)
      } catch {
        setCameraError("Camera access denied.")
      }
    }
    startCamera()
    return () => { active = false; streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const captureFrame = useCallback(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return null
    const w = v.videoWidth || 640
    const h = v.videoHeight || 480
    c.width = w
    c.height = h
    const ctx = c.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    return c.toDataURL("image/jpeg", 0.7).split(",")[1]
  }, [])

  const processAudioFromEvent = useCallback((event) => {
    const tryParts = (parts) => {
      if (!parts) return false
      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data
        if (inlineData?.data) {
          const mime = inlineData.mimeType || inlineData.mime_type || ""
          if (mime.startsWith("audio/") || mime.includes("pcm") || mime.includes("raw")) {
            audioPlayerRef.current.playPcm16(inlineData.data)
            return true
          }
        }
      }
      return false
    }
    return tryParts(event?.content?.parts) || tryParts(event?.serverContent?.modelTurn?.parts)
  }, [])

  const transcriptText = useMemo(
    () =>
      events
        .map((e) => {
          const parts = e?.content?.parts
          if (parts) return parts.map((p) => p.text || "").join("")
          if (e?.serverContent?.outputTranscription?.text) return e.serverContent.outputTranscription.text
          if (e?.transcript) return e.transcript
          return ""
        })
        .filter(Boolean)
        .join(""),
    [events],
  )

  const parsedSections = useMemo(() => parseTranscript(transcriptText), [transcriptText])

  /* ── Connect ── */
  const handleStart = useCallback(() => {
    setEvents([])
    setStoryboard(null)
    setVideo(null)
    storyboardGeneratedRef.current = false

    const userId = "user-" + uid()
    const sessionId = "session-" + uid()

    const ws = createSession(userId, sessionId, {
      onOpen: () => {
        setScreen(SCREEN.PICK_STYLE)
        frameIntervalRef.current = setInterval(() => {
          const frame = captureFrame()
          if (frame) sendImage(ws, frame)
        }, 1000)
      },
      onEvent: (event) => {
        setEvents((prev) => [...prev, event])
        processAudioFromEvent(event)
      },
      onClose: () => {
        clearInterval(frameIntervalRef.current)
        setScreen((prev) => (prev === SCREEN.DIRECTING ? SCREEN.REVIEW : prev))
      },
    })

    wsRef.current = ws
  }, [captureFrame, processAudioFromEvent])

  /* ── End session ── */
  const handleEnd = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    clearInterval(frameIntervalRef.current)
    audioPlayerRef.current.stop()
    audioPlayerRef.current = new AudioPlayer()
    setScreen(SCREEN.REVIEW)
  }, [])

  /* ── Style selection ── */
  const handleStyleSelect = useCallback(
    ({ director, movies, scene }) => {
      setSelectedStyle(director)
      setSelectedMovies(movies)
      setSelectedScene(scene)
      setScreen(SCREEN.DIRECTING)
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const movieRef = movies ? ` Reference films: ${movies}.` : ""
        const sceneRef = scene ? ` The user's creative brief: "${scene}".` : ""
        sendText(
          wsRef.current,
          `The user wants you to direct in the style of ${director}.${movieRef}${sceneRef} Channel this filmmaker's exact visual language, camera work, color palette, and storytelling. Start narrating now.`,
        )
      }
    },
    [],
  )

  /* ── New session ── */
  const handleNewSession = useCallback(() => {
    setScreen(SCREEN.IDLE)
    setSelectedStyle("")
    setSelectedMovies("")
    setSelectedScene("")
    setEvents([])
    setStoryboard(null)
    setVideo(null)
    storyboardGeneratedRef.current = false
  }, [])

  /* ── Storyboard (uses real parsed sections) ── */
  const generateStoryboard = useCallback(
    async (transcript) => {
      if (storyboardGeneratedRef.current || !selectedStyle || !transcript) return
      storyboardGeneratedRef.current = true
      setStoryboard({ loading: true })

      try {
        const frameB64 = captureFrame() || ""
        const cameraDir = parsedSections?.camera || "wide establishing shot"
        const lightingDir = parsedSections?.lighting || ""
        const third = Math.floor(transcript.length / 3)

        const prompts = [
          { narration: transcript.slice(0, third).trim(), label: "Opening shot" },
          { narration: transcript.slice(third, third * 2).trim(), label: "Development" },
          { narration: transcript.slice(third * 2).trim(), label: "Climax" },
        ]

        const results = await Promise.allSettled(
          prompts.map((p) =>
            fetch(`${API_BASE}/api/storyboard`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                style: selectedStyle,
                movies: selectedMovies,
                scene_prompt: selectedScene,
                narration: p.narration,
                camera: cameraDir,
                lighting: lightingDir,
                frame_base64: frameB64,
              }),
            }).then((r) => r.json()),
          ),
        )

        const images = results
          .filter((r) => r.status === "fulfilled" && r.value.image)
          .map((r) => ({ image: r.value.image, mime_type: r.value.mime_type }))

        setStoryboard(images.length > 0 ? { images } : { error: "Storyboard generation failed" })
      } catch {
        setStoryboard({ error: "Storyboard generation failed" })
      }
    },
    [selectedStyle, selectedMovies, selectedScene, captureFrame, parsedSections],
  )

  useEffect(() => {
    if (screen === SCREEN.REVIEW && transcriptText.length > 100 && selectedStyle && !storyboardGeneratedRef.current) {
      generateStoryboard(transcriptText)
    }
  }, [screen, transcriptText, selectedStyle, generateStoryboard])

  /* ── Video generation (uses real parsed sections) ── */
  const generateVideoClip = useCallback(async () => {
    if (!selectedStyle || !transcriptText || video?.loading) return
    setVideo({ loading: true })

    try {
      const narration = (parsedSections?.narration || transcriptText.slice(0, 600)).slice(0, 600)
      const camera = parsedSections?.camera || ""
      const lighting = parsedSections?.lighting || ""
      const music = parsedSections?.music || ""
      const firstImage = storyboard?.images?.[0]?.image || ""

      const res = await fetch(`${API_BASE}/api/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: selectedStyle,
          movies: selectedMovies,
          scene_prompt: selectedScene,
          narration,
          camera,
          lighting,
          music,
          storyboard_image_b64: firstImage,
        }),
      })

      const data = await res.json()
      if (data.video) {
        setVideo({ videoData: data.video, mimeType: data.mime_type || "video/mp4" })
      } else {
        setVideo({ error: data.error || "Video generation failed" })
      }
    } catch {
      setVideo({ error: "Video generation failed" })
    }
  }, [selectedStyle, selectedMovies, selectedScene, transcriptText, parsedSections, storyboard, video?.loading])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      clearInterval(frameIntervalRef.current)
      audioPlayerRef.current.stop()
    }
  }, [])

  const showCamera = screen !== SCREEN.REVIEW

  return (
    <main className="app">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div className="camera-layer" style={showCamera ? undefined : { visibility: "hidden", position: "absolute" }}>
        <video ref={videoRef} autoPlay playsInline muted className="camera-layer__video" />
        <div className="camera-layer__vignette" />
      </div>

      {screen === SCREEN.IDLE && (
        <div className="screen screen--idle" key="idle">
          <div className="screen__spacer" />
          <div className="idle__center">
            <h1 className="brand">take</h1>
            <p className="brand__tagline">point your camera at anything</p>
          </div>
          <div className="idle__bottom">
            {cameraError ? (
              <p className="idle__error">{cameraError}</p>
            ) : (
              <button
                className="btn-hero"
                onClick={handleStart}
                disabled={!cameraReady}
              >
                {cameraReady ? "Start Directing" : "Loading Camera…"}
              </button>
            )}
          </div>
        </div>
      )}

      {screen === SCREEN.PICK_STYLE && (
        <div className="screen screen--styles" key="styles">
          <StyleSelector onSelect={handleStyleSelect} />
        </div>
      )}

      {screen === SCREEN.DIRECTING && (
        <div className="screen screen--directing" key="directing">
          <div className="directing__top">
            <div className="directing__badge">
              <span className="directing__rec" />
              <span className="directing__style">
                {selectedStyle}{selectedMovies ? ` · ${selectedMovies}` : ""}
              </span>
            </div>
          </div>
          <div className="directing__bottom">
            <button className="btn-end" onClick={handleEnd}>
              End Session
            </button>
          </div>
        </div>
      )}

      {screen === SCREEN.REVIEW && (
        <OutputPanel
          key="review"
          sections={parsedSections}
          storyboard={storyboard}
          video={video}
          style={selectedStyle}
          onGenerateVideo={generateVideoClip}
          onNewSession={handleNewSession}
        />
      )}
    </main>
  )
}
