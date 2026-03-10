import { useState } from "react"

const STYLES = [
  { id: "wes anderson", label: "Wes Anderson", color: "#E8A87C" },
  { id: "noir",         label: "Noir",         color: "#8B8B8B" },
  { id: "nature doc",   label: "Nature Doc",   color: "#56AB91" },
  { id: "sci-fi",       label: "Sci-Fi",       color: "#7B68EE" },
  { id: "heist",        label: "Heist",        color: "#E85D75" },
  { id: "horror",       label: "Horror",       color: "#6B3FA0" },
]

export default function StyleSelector({ selected, onSelect, disabled }) {
  return (
    <div className="styles">
      <span className="styles__label">Style</span>
      {STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(s.id)}
          className={`style-btn ${selected === s.id ? "style-btn--active" : ""}`}
          style={{ "--style-color": s.color }}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
