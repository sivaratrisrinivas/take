# take

Point your phone at anything — AI instantly generates a cinematic short film in the style you choose.

## What is this?

**take** turns your phone's camera into a cinematic film director. Point it at literally anything — your coffee cup, a street scene, your dog — pick a film style like "Wes Anderson" or "Noir Thriller," and the AI will:

1. **Narrate your scene** in the chosen cinematic style (you hear it live)
2. **Tell you how to shoot it** — camera angles, movements, framing
3. **Suggest lighting & color** — color grading, mood, atmosphere
4. **Design the soundtrack** — music cues, ambient sounds, score
5. **Draw a storyboard** — 3 AI-generated frames showing what the final film would look like
6. **Generate a video clip** — an actual 8-second cinematic video using Google's Veo 3.1

## Why?

50M+ creators on TikTok and Reels want their content to look more cinematic. "How to make my videos look professional" is searched millions of times monthly. **take** gives you instant cinematic direction for any scene, in any style, in real-time.

## How it works (step by step)

### 1. Open the app
Open `localhost:5173` in your browser. Your camera turns on automatically.

### 2. Start a session
Click **Start Directing**. This opens a live connection between your camera and the AI.

### 3. Pick a style
Choose one of 6 cinematic styles: **Wes Anderson**, **Noir**, **Nature Documentary**, **Sci-Fi**, **Heist**, or **Horror**.

### 4. AI watches and directs (live)
The AI sees your camera feed in real-time (1 frame per second). It starts speaking — narrating your scene in the chosen film style, telling you how to move the camera, what lighting to use, and what music would fit.

### 5. Swipe through the director's cards
When you end the session, the AI's output is parsed into swipeable cards:
- 🎬 **Narration** — the spoken scene description
- 📹 **Camera** — specific shot directions (dolly, tracking, close-up, etc.)
- 💡 **Lighting & Color** — color grading and mood
- 🎵 **Music & Sound** — soundtrack and sound design cues
- 🖼️ **Storyboard** — 3 AI-generated frames showing the final film

### 6. Generate a video
After the storyboard loads, click **Generate Video**. The app sends everything (narration, camera directions, lighting, music, and a storyboard frame) to Google's Veo 3.1 model, which creates an 8-second cinematic video clip. This takes about 1-3 minutes.

### 7. Watch your film
Swipe to the Video card. Your cinematic short film plays inline with full controls.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Python, FastAPI |
| AI Agent | Google ADK (Agent Development Kit) |
| Live Streaming | Gemini Live API (bidirectional audio/video) |
| Image Generation | Gemini 2.0 Flash |
| Video Generation | Google Veo 3.1 |
| Communication | WebSocket (real-time), REST (storyboard + video) |

## Project structure

```
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI server (WebSocket + REST endpoints)
│   │   └── take_agent/
│   │       └── agent.py             # AI film director agent definition
│   ├── .env.example                 # Environment variable template
│   └── requirements.txt             # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Camera, WebSocket, audio playback, state
│   │   ├── api.js                   # WebSocket connection helpers
│   │   ├── index.css                # Dark cinematic theme + animations
│   │   └── components/
│   │       ├── OutputPanel.jsx      # Swipeable card stack + video player
│   │       └── StyleSelector.jsx    # 6 film style buttons
│   ├── index.html
│   └── package.json
├── Dockerfile
└── README.md
```

## Setup

### Prerequisites
- Python 3.12+
- Node.js 18+
- A Google API key with access to Gemini and Veo models

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Open .env and paste your GOOGLE_API_KEY
uvicorn app.main:app --reload
```

Runs on `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `WebSocket` | `/ws/{user_id}/{session_id}` | Live bidirectional streaming (camera → AI → audio) |
| `POST` | `/api/storyboard` | Generate a storyboard frame (Gemini image generation) |
| `POST` | `/api/generate-video` | Generate a cinematic video clip (Veo 3.1) |

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `FALSE` for Google AI Studio |
| `GOOGLE_API_KEY` | Your Gemini API key |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:8000` | Backend WebSocket URL |

## Docker

```bash
docker build -t take-backend .
docker run --rm -p 8080:8080 --env-file backend/.env take-backend
```
