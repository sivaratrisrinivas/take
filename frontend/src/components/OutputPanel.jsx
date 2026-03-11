import { useEffect, useRef, useMemo, useState, useCallback } from "react"

const CARD_META = {
  narration:  { label: "Narration",       emoji: "🎬" },
  camera:     { label: "Camera",          emoji: "📹" },
  lighting:   { label: "Lighting & Color",emoji: "💡" },
  music:      { label: "Music & Sound",   emoji: "🎵" },
  storyboard: { label: "Storyboard",      emoji: "🖼️" },
  video:      { label: "Video",           emoji: "🎥" },
}

function StoryboardContent({ storyboard, video, onGenerateVideo }) {
  if (storyboard.loading) {
    return (
      <div className="sb-loading">
        <div className="sb-shimmer" />
        <div className="sb-shimmer" />
        <div className="sb-shimmer" />
        <span className="sb-loading__text">Generating storyboard…</span>
      </div>
    )
  }

  if (storyboard.error) {
    return <p className="card-error">{storyboard.error}</p>
  }

  return (
    <div className="sb-filmstrip">
      {storyboard.images?.map((img, i) => (
        <div key={i} className="sb-frame">
          <span className="sb-frame__label">Frame {i + 1}</span>
          <img
            src={`data:${img.mime_type || "image/png"};base64,${img.image}`}
            alt={`Storyboard frame ${i + 1}`}
          />
        </div>
      ))}
      {onGenerateVideo && storyboard.images?.length > 0 && (
        <button
          className="btn-generate"
          onClick={(e) => { e.stopPropagation(); onGenerateVideo() }}
          disabled={video?.loading}
        >
          {video?.loading ? "Generating Video…" : "Generate Video"}
        </button>
      )}
    </div>
  )
}

function VideoContent({ video, onGenerateVideo }) {
  if (video.loading) {
    return (
      <div className="vid-loading">
        <div className="vid-pulse" />
        <span className="vid-loading__text">Generating cinematic video…</span>
        <span className="vid-loading__sub">This may take 1–3 minutes</span>
      </div>
    )
  }

  if (video.error) {
    return (
      <div className="vid-error">
        <p>{video.error}</p>
        {onGenerateVideo && (
          <button className="btn-generate" onClick={onGenerateVideo}>Retry</button>
        )}
      </div>
    )
  }

  if (video.videoData) {
    return (
      <video
        className="vid-player"
        controls
        autoPlay
        playsInline
        src={`data:${video.mimeType || "video/mp4"};base64,${video.videoData}`}
      />
    )
  }

  return null
}

export default function OutputPanel({ sections, storyboard, video, style, onGenerateVideo, onNewSession }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [drag, setDrag] = useState({ active: false, startX: 0, dx: 0 })

  const cards = useMemo(() => {
    const arr = []
    if (sections?.narration)
      arr.push({ type: "narration", ...CARD_META.narration, text: sections.narration })
    if (sections?.camera)
      arr.push({ type: "camera", ...CARD_META.camera, text: sections.camera })
    if (sections?.lighting)
      arr.push({ type: "lighting", ...CARD_META.lighting, text: sections.lighting })
    if (sections?.music)
      arr.push({ type: "music", ...CARD_META.music, text: sections.music })

    if (storyboard && (storyboard.loading || storyboard.images?.length || storyboard.error))
      arr.push({ type: "storyboard", ...CARD_META.storyboard })
    if (video && (video.loading || video.videoData || video.error))
      arr.push({ type: "video", ...CARD_META.video })

    return arr
  }, [sections, storyboard, video])

  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0) setCurrentIndex(cards.length - 1)
  }, [cards.length, currentIndex])

  const THRESHOLD = 80

  const onStart = useCallback((x) => setDrag({ active: true, startX: x, dx: 0 }), [])
  const onMove = useCallback((x) => {
    setDrag((p) => (p.active ? { ...p, dx: x - p.startX } : p))
  }, [])
  const onEnd = useCallback(() => {
    setDrag((p) => {
      if (!p.active) return p
      if (p.dx < -THRESHOLD && currentIndex < cards.length - 1) setCurrentIndex((i) => i + 1)
      else if (p.dx > THRESHOLD && currentIndex > 0) setCurrentIndex((i) => i - 1)
      return { active: false, startX: 0, dx: 0 }
    })
  }, [currentIndex, cards.length])

  useEffect(() => {
    if (!drag.active) return
    const move = (e) => onMove(e.clientX)
    const up = () => onEnd()
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up) }
  }, [drag.active, onMove, onEnd])

  const card = cards[currentIndex]
  const hasCards = cards.length > 0

  const rotation = drag.active ? drag.dx * 0.03 : 0
  const opacity = drag.active ? Math.max(0.5, 1 - Math.abs(drag.dx) / 400) : 1

  return (
    <div className="review">
      <header className="review__header">
        <button className="review__back" onClick={onNewSession}>
          ← New
        </button>
        {style && <span className="review__style">{style}</span>}
      </header>

      {!hasCards && (
        <div className="review__empty">
          <p>Waiting for director's output…</p>
          <div className="waiting">
            <span className="waiting__dot" />
            <span className="waiting__dot" />
            <span className="waiting__dot" />
          </div>
        </div>
      )}

      {hasCards && card && (
        <>
          <div
            className="review__card"
            style={{
              transform: `translateX(${drag.active ? drag.dx : 0}px) rotate(${rotation}deg)`,
              opacity,
              transition: drag.active ? "none" : "transform 0.35s cubic-bezier(.4,0,.2,1), opacity 0.35s ease",
              cursor: drag.active ? "grabbing" : "grab",
            }}
            onMouseDown={(e) => { e.preventDefault(); onStart(e.clientX) }}
            onTouchStart={(e) => onStart(e.touches[0].clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
            onTouchEnd={onEnd}
          >
            <span className="review__emoji">{card.emoji}</span>
            <span className="review__label">{card.label}</span>

            {card.text && (
              <p className={`review__text ${card.type === "narration" ? "review__text--narration" : ""}`}>
                {card.text}
              </p>
            )}

            {card.type === "storyboard" && (
              <StoryboardContent storyboard={storyboard} video={video} onGenerateVideo={onGenerateVideo} />
            )}

            {card.type === "video" && (
              <VideoContent video={video} onGenerateVideo={onGenerateVideo} />
            )}
          </div>

          <div className="review__nav">
            <div className="review__dots">
              {cards.map((c, i) => (
                <button
                  key={c.type}
                  className={`dot ${i === currentIndex ? "dot--active" : ""}`}
                  onClick={() => setCurrentIndex(i)}
                  aria-label={c.label}
                />
              ))}
            </div>
            <span className="review__hint">
              {currentIndex + 1} / {cards.length}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
