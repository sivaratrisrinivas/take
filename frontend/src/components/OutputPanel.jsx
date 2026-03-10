import { useEffect, useRef, useMemo, useState, useCallback } from "react"

/**
 * Parse transcript into structured cinematic sections.
 */
function parseTranscript(rawText) {
  if (!rawText || rawText.trim().length < 30) return null

  const text = rawText
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

  const sections = { narration: "", camera: "", lighting: "", music: "" }

  // Strategy 1: exact spoken transition markers
  const spokenMarkers = [
    { type: "camera",   re: /\bnow for the camera\b/i },
    { type: "lighting", re: /\bnow for the lighting\b/i },
    { type: "music",    re: /\bnow for the music\b/i },
  ]

  const markers = []
  for (const def of spokenMarkers) {
    const match = text.match(def.re)
    if (match) {
      markers.push({ type: def.type, index: match.index, contentStart: match.index + match[0].length })
    }
  }

  if (markers.length > 0) {
    markers.sort((a, b) => a.index - b.index)
    sections.narration = text.slice(0, markers[0].index).trim()
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].contentStart
      const end = i + 1 < markers.length ? markers[i + 1].index : text.length
      const content = text.slice(start, end).trim()
      if (content) sections[markers[i].type] = content
    }
    return sections
  }

  // Strategy 2: classify sentences by keyword
  const sentences = text.split(/(?<=[.!?])\s+/)
  const camRe = /\b(?:shot|camera|dolly|tracking|panning?|tilt|zoom|close-?up|wide|overhead|rack focus|framing|lens|angle|crane|steadicam|handheld|symmetri)/i
  const litRe = /\b(?:lighting?|colors?|palette|grading|tungsten|neon|shadow|glow|hue|saturated?|desaturated?|warm|cool|pastel|contrast|tone|amber|golden)/i
  const musRe = /\b(?:music|soundtrack|score|melody|tempo|rhythm|cue|instrument|orchestra|guitar|piano|synth|bass|drum|strings|harpsichord|acoustic|sound)/i

  const narr = [], cam = [], lit = [], mus = []
  for (const s of sentences) {
    const t = s.trim()
    if (!t) continue
    const hasCam = camRe.test(t), hasLit = litRe.test(t), hasMus = musRe.test(t)
    const matched = hasCam || hasLit || hasMus
    if (!matched) { narr.push(t) }
    else {
      if (hasCam) cam.push(t)
      if (hasLit) lit.push(t)
      if (hasMus) mus.push(t)
    }
  }

  sections.narration = narr.join(" ") || text.slice(0, 300)
  sections.camera = cam.join(" ")
  sections.lighting = lit.join(" ")
  sections.music = mus.join(" ")
  return sections
}

function extractText(event) {
  const texts = []
  const parts = event?.content?.parts
  if (parts) { for (const p of parts) { if (p.text) texts.push(p.text) } }
  if (event?.serverContent?.outputTranscription?.text) texts.push(event.serverContent.outputTranscription.text)
  if (event?.transcript) texts.push(event.transcript)
  return texts.join("")
}

/* ── Card definitions ── */
const CARD_META = {
  narration: { label: "Narration", emoji: "🎬", accentVar: "--text" },
  camera:    { label: "Camera",    emoji: "📹", accentVar: "rgba(0,212,255,0.6)" },
  lighting:  { label: "Lighting & Color", emoji: "💡", accentVar: "rgba(255,183,77,0.6)" },
  music:     { label: "Music & Sound",    emoji: "🎵", accentVar: "rgba(168,85,247,0.6)" },
  storyboard:{ label: "Storyboard",       emoji: "🖼️", accentVar: "rgba(255,255,255,0.3)" },
  video:     { label: "Video",            emoji: "🎥", accentVar: "rgba(0,255,136,0.5)" },
}

/* ── Swipeable Card Stack ── */
function SwipeableCards({ cards }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [dragState, setDragState] = useState({ dragging: false, startX: 0, deltaX: 0 })
  const cardRef = useRef(null)

  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0) {
      setCurrentIndex(cards.length - 1)
    }
  }, [cards.length, currentIndex])

  const SWIPE_THRESHOLD = 80

  const handleStart = useCallback((clientX) => {
    setDragState({ dragging: true, startX: clientX, deltaX: 0 })
  }, [])

  const handleMove = useCallback((clientX) => {
    setDragState(prev => {
      if (!prev.dragging) return prev
      return { ...prev, deltaX: clientX - prev.startX }
    })
  }, [])

  const handleEnd = useCallback(() => {
    setDragState(prev => {
      if (!prev.dragging) return prev
      const { deltaX } = prev
      if (deltaX < -SWIPE_THRESHOLD && currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1)
      } else if (deltaX > SWIPE_THRESHOLD && currentIndex > 0) {
        setCurrentIndex(i => i - 1)
      }
      return { dragging: false, startX: 0, deltaX: 0 }
    })
  }, [currentIndex, cards.length])

  const onMouseDown = (e) => { e.preventDefault(); handleStart(e.clientX) }
  const onTouchStart = (e) => handleStart(e.touches[0].clientX)
  const onTouchMove = (e) => handleMove(e.touches[0].clientX)
  const onTouchEnd = () => handleEnd()

  useEffect(() => {
    if (!dragState.dragging) return
    const handleMouseMove = (e) => handleMove(e.clientX)
    const handleMouseUp = () => handleEnd()
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragState.dragging, handleMove, handleEnd])

  if (cards.length === 0) return null

  const card = cards[currentIndex]
  const { deltaX, dragging } = dragState
  const rotation = dragging ? deltaX * 0.04 : 0
  const opacity = dragging ? Math.max(0.5, 1 - Math.abs(deltaX) / 400) : 1

  return (
    <div className="swipe-container">
      <div
        ref={cardRef}
        className="swipe-card"
        style={{
          transform: `translateX(${dragging ? deltaX : 0}px) rotate(${rotation}deg)`,
          opacity,
          transition: dragging ? "none" : "transform 0.35s cubic-bezier(.4,0,.2,1), opacity 0.35s ease",
          cursor: dragging ? "grabbing" : "grab",
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="swipe-card__accent" style={{ background: card.accent }} />
        <div className="swipe-card__emoji">{card.emoji}</div>
        <div className="swipe-card__label">{card.label}</div>
        <div className="swipe-card__body">{card.content}</div>

        {dragging && deltaX < -30 && (
          <div className="swipe-hint swipe-hint--next">Next →</div>
        )}
        {dragging && deltaX > 30 && (
          <div className="swipe-hint swipe-hint--prev">← Back</div>
        )}
      </div>

      <div className="swipe-dots">
        {cards.map((c, i) => (
          <button
            key={c.type}
            className={`swipe-dot ${i === currentIndex ? "swipe-dot--active" : ""}`}
            onClick={() => setCurrentIndex(i)}
            aria-label={c.label}
          />
        ))}
      </div>

      <div className="swipe-nav-hint">
        {currentIndex > 0 && <span>← swipe right for previous</span>}
        {currentIndex > 0 && currentIndex < cards.length - 1 && <span> · </span>}
        {currentIndex < cards.length - 1 && <span>swipe left for next →</span>}
      </div>
    </div>
  )
}

export default function OutputPanel({ events, isConnected, storyboard, video, onGenerateVideo }) {
  const rawTranscript = useMemo(
    () => events.map(extractText).filter(Boolean).join(""),
    [events]
  )

  const sections = useMemo(
    () => parseTranscript(rawTranscript),
    [rawTranscript]
  )

  const isEmpty = !isConnected && events.length === 0
  const isWaiting = isConnected && events.length === 0

  // Build card array from available sections
  const cards = useMemo(() => {
    const arr = []

    if (sections?.narration) {
      arr.push({
        type: "narration",
        label: CARD_META.narration.label,
        emoji: CARD_META.narration.emoji,
        accent: CARD_META.narration.accentVar,
        content: <p className="card-text card-text--narration">{sections.narration}</p>,
      })
    }
    if (sections?.camera) {
      arr.push({
        type: "camera",
        label: CARD_META.camera.label,
        emoji: CARD_META.camera.emoji,
        accent: CARD_META.camera.accentVar,
        content: <p className="card-text card-text--direction">{sections.camera}</p>,
      })
    }
    if (sections?.lighting) {
      arr.push({
        type: "lighting",
        label: CARD_META.lighting.label,
        emoji: CARD_META.lighting.emoji,
        accent: CARD_META.lighting.accentVar,
        content: <p className="card-text card-text--direction">{sections.lighting}</p>,
      })
    }
    if (sections?.music) {
      arr.push({
        type: "music",
        label: CARD_META.music.label,
        emoji: CARD_META.music.emoji,
        accent: CARD_META.music.accentVar,
        content: <p className="card-text card-text--direction">{sections.music}</p>,
      })
    }

    // Storyboard card
    if (storyboard && (storyboard.loading || storyboard.images?.length > 0 || storyboard.image || storyboard.error)) {
      const storyboardContent = (
        <div className="storyboard-filmstrip">
          {storyboard.loading && (
            <div className="storyboard-loading">
              <div className="storyboard-shimmer" />
              <div className="storyboard-shimmer" />
              <div className="storyboard-shimmer" />
              <span className="storyboard-loading-text">Generating storyboard…</span>
            </div>
          )}
          {storyboard.images && storyboard.images.map((img, i) => (
            <div key={i} className="storyboard-frame">
              <span className="storyboard-frame-label">Frame {i + 1}</span>
              <img
                src={`data:${img.mime_type || "image/png"};base64,${img.image}`}
                alt={`Storyboard frame ${i + 1}`}
              />
            </div>
          ))}
          {!storyboard.images && storyboard.image && (
            <div className="storyboard-frame">
              <img
                src={`data:${storyboard.mime_type || "image/png"};base64,${storyboard.image}`}
                alt="Storyboard frame"
              />
            </div>
          )}
          {storyboard.error && (
            <span className="storyboard-error">{storyboard.error}</span>
          )}
          {/* Generate Video button */}
          {!storyboard.loading && (storyboard.images?.length > 0 || storyboard.image) && onGenerateVideo && (
            <button
              className="btn-generate-video"
              onClick={(e) => { e.stopPropagation(); onGenerateVideo(); }}
              disabled={video?.loading}
            >
              {video?.loading ? "Generating Video…" : "🎬 Generate Video"}
            </button>
          )}
        </div>
      )
      arr.push({
        type: "storyboard",
        label: CARD_META.storyboard.label,
        emoji: CARD_META.storyboard.emoji,
        accent: CARD_META.storyboard.accentVar,
        content: storyboardContent,
      })
    }

    // Video card
    if (video && (video.loading || video.videoData || video.error)) {
      const videoContent = (
        <div className="video-player-container">
          {video.loading && (
            <div className="video-loading">
              <div className="video-loading-pulse" />
              <span className="video-loading-text">Generating cinematic video…</span>
              <span className="video-loading-sub">This may take 1-3 minutes</span>
            </div>
          )}
          {video.videoData && (
            <video
              className="video-player"
              controls
              autoPlay
              playsInline
              src={`data:${video.mimeType || "video/mp4"};base64,${video.videoData}`}
            />
          )}
          {video.error && (
            <div className="video-error">
              <span>{video.error}</span>
              {onGenerateVideo && (
                <button
                  className="btn-generate-video"
                  onClick={(e) => { e.stopPropagation(); onGenerateVideo(); }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      )
      arr.push({
        type: "video",
        label: CARD_META.video.label,
        emoji: CARD_META.video.emoji,
        accent: CARD_META.video.accentVar,
        content: videoContent,
      })
    }

    return arr
  }, [sections, storyboard, video, onGenerateVideo])

  return (
    <div className="output">
      <div className="output__header">
        <span className="output__title">Director's Output</span>
        <span className={`output__live-dot ${isConnected ? "output__live-dot--active" : ""}`}>
          <span className={`app__status-dot ${isConnected ? "app__status-dot--live" : ""}`} />
          {isConnected ? "Live" : "Offline"}
        </span>
      </div>

      <div className="output__body">
        {isEmpty && (
          <div className="output__empty">
            <div className="output__empty-icon">🎬</div>
            <p className="output__empty-text">
              Connect and select a cinematic style to begin directing
            </p>
          </div>
        )}

        {isWaiting && (
          <div className="output__empty">
            <div className="waiting">
              <span className="waiting__dot" />
              <span className="waiting__dot" />
              <span className="waiting__dot" />
            </div>
          </div>
        )}

        {cards.length > 0 && <SwipeableCards cards={cards} />}
      </div>
    </div>
  )
}
