import { useState, useRef, useEffect } from "react"

export default function StyleSelector({ onSelect }) {
  const [director, setDirector] = useState("")
  const [movies, setMovies] = useState("")
  const [scene, setScene] = useState("")
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e) => {
    e?.preventDefault()
    const d = director.trim()
    if (d) onSelect({ director: d, movies: movies.trim(), scene: scene.trim() })
  }

  return (
    <div className="styles-screen">
      <h2 className="styles-screen__title">Set the scene</h2>
      <form className="styles-screen__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="director-input"
          value={director}
          onChange={(e) => setDirector(e.target.value)}
          placeholder="Director — Kubrick, Spielberg, Tarantino…"
          autoComplete="off"
          spellCheck="false"
        />
        <input
          type="text"
          className="director-input director-input--movies"
          value={movies}
          onChange={(e) => setMovies(e.target.value)}
          placeholder="Films — Blade Runner, Interstellar… (optional)"
          autoComplete="off"
          spellCheck="false"
        />
        <textarea
          className="director-input director-input--scene"
          value={scene}
          onChange={(e) => setScene(e.target.value)}
          placeholder="Describe your scene… (optional)"
          rows={3}
          spellCheck="false"
        />
        <button
          type="submit"
          className="btn-go"
          disabled={!director.trim()}
        >
          Direct
        </button>
      </form>
      <p className="styles-screen__hint">
        Director is required. Movies and scene description sharpen the output.
      </p>
    </div>
  )
}
