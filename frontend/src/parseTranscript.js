export default function parseTranscript(rawText) {
  if (!rawText || rawText.trim().length < 30) return null

  const text = rawText
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

  const sections = { narration: "", camera: "", lighting: "", music: "" }

  const spokenMarkers = [
    { type: "camera", re: /\bnow for the camera\b/i },
    { type: "lighting", re: /\bnow for the lighting\b/i },
    { type: "music", re: /\bnow for the music\b/i },
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

  const sentences = text.split(/(?<=[.!?])\s+/)
  const camRe = /\b(?:shot|camera|dolly|tracking|panning?|tilt|zoom|close-?up|wide|overhead|rack focus|framing|lens|angle|crane|steadicam|handheld|symmetri)/i
  const litRe = /\b(?:lighting?|colors?|palette|grading|tungsten|neon|shadow|glow|hue|saturated?|desaturated?|warm|cool|pastel|contrast|tone|amber|golden)/i
  const musRe = /\b(?:music|soundtrack|score|melody|tempo|rhythm|cue|instrument|orchestra|guitar|piano|synth|bass|drum|strings|harpsichord|acoustic|sound)/i

  const narr = [], cam = [], lit = [], mus = []
  for (const s of sentences) {
    const t = s.trim()
    if (!t) continue
    const hasCam = camRe.test(t), hasLit = litRe.test(t), hasMus = musRe.test(t)
    if (!hasCam && !hasLit && !hasMus) narr.push(t)
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
