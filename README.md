# take

Point your phone at anything — name any film director — AI generates a cinematic short film in their style.

## What is this?

**take** turns your phone's camera into a cinematic film director. Point it at literally anything — your coffee cup, a street scene, your dog — type any director's name (Kubrick, Spielberg, Tarantino, Miyazaki, anyone), optionally add reference movies and a creative brief, and the AI will:

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
Open the frontend in your browser:
- Local: `http://localhost:5173`
- Production: Firebase Hosting (`https://<your-site>.web.app`)

Your camera turns on automatically.

### 2. Start a session
Click **Start Directing**. This opens a live connection between your camera and the AI.

### 3. Set the scene
Three input fields, only the first is required:
- **Director** — Wes Anderson, David Fincher, Akira Kurosawa, Greta Gerwig, anyone
- **Films** (optional) — specific movie references like "Blade Runner, Interstellar" to sharpen the visual direction
- **Scene** (optional) — a creative brief describing what you want, e.g., "a detective walking through neon-lit rain-soaked streets"

### 4. AI watches and directs (live)
The AI sees your camera feed in real-time (1 frame per second). It starts speaking — narrating your scene in the chosen film style, telling you how to move the camera, what lighting to use, and what music would fit. If you provided a creative brief, it weaves that vision into what it sees.

### 5. Swipe through the director's cards
When you end the session, the AI's output is parsed into swipeable cards written in plain English:
- **Narration** — the spoken scene description
- **Camera** — specific shot directions plus a layman-friendly explanation of how to move/frame the camera
- **Lighting & Color** — color grading, mood, and what visual changes to make in the scene
- **Music & Sound** — soundtrack and sound design cues with a simple explanation of the feeling they create
- **Storyboard** — 3 AI-generated frames showing the final film

### 6. Generate a video
After the storyboard loads, click **Generate Video**. The app sends everything (narration, camera directions, lighting, music, and a storyboard frame) to Google's Veo 3.1 model, which creates an 8-second cinematic video clip. This takes about 1-3 minutes.

### 7. Watch your film
Swipe to the Video card. Your cinematic short film plays inline with full controls.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Python + FastAPI |
| AI Agent | Google ADK (Agent Development Kit) |
| Live Streaming | Gemini Live on Vertex AI |
| Image Generation | Gemini 2.5 Flash Image on Vertex AI in production, Gemini image preview locally |
| Video Generation | Veo 3.1 via Vertex AI long-running prediction API |
| Communication | WebSocket (real-time), REST (storyboard + video) |
| Testing | pytest + pytest-asyncio (backend), Vitest (frontend) |
| Deployment | Cloud Run (backend), Firebase Hosting (frontend), GitHub Actions (CI/CD) |

## Project structure

```
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI server (WebSocket + REST endpoints)
│   │   └── take_agent/
│   │       └── agent.py             # AI film director agent definition
│   ├── tests/
│   │   ├── test_unit.py             # Unit tests (models, prompts, agent config)
│   │   └── test_integration.py      # Integration tests (HTTP endpoints, mocked APIs)
│   ├── .env.example                 # Environment variable template
│   ├── pytest.ini                   # Pytest configuration
│   └── requirements.txt             # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Camera, WebSocket, audio playback, state
│   │   ├── api.js                   # WebSocket connection helpers
│   │   ├── parseTranscript.js       # AI transcript parser (narration/camera/lighting/music)
│   │   ├── index.css                # Dark cinematic theme + animations
│   │   ├── __tests__/
│   │   │   ├── parseTranscript.test.js  # Transcript parser tests
│   │   │   └── api.test.js              # WebSocket helper tests
│   │   └── components/
│   │       ├── OutputPanel.jsx      # Swipeable card stack + video player
│   │       └── StyleSelector.jsx    # Director / movies / scene input
│   ├── index.html
│   └── package.json
├── Dockerfile
└── README.md
```

## Setup

### Prerequisites
- Python 3.12+
- Node.js 18+
- For local dev: a Google API key with access to Gemini/Veo
- For production: a GCP project with Vertex AI, Cloud Run, and Firebase enabled

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Open .env and paste your GOOGLE_API_KEY for local development
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

## Testing

### Backend (28 tests)

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -v
```

Tests cover:
- Agent definition and instruction validation
- Request model validation (required/optional fields)
- Prompt template rendering (with and without optional fields)
- Health check endpoint
- CORS preflight
- Storyboard endpoint (success, error, no image, with frame reference)
- Video endpoint (success, no results, API error, validation)

### Frontend (16 tests)

```bash
cd frontend
npm test
```

Tests cover:
- Transcript parser: spoken markers, keyword fallback, markdown stripping, edge cases
- WebSocket helpers: sendText, sendImage, sendAudio, closed socket handling

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `WebSocket` | `/ws/{user_id}/{session_id}` | Live bidirectional streaming (camera → AI → audio) |
| `POST` | `/api/storyboard` | Generate a storyboard frame (Nano Banana 2) |
| `POST` | `/api/generate-video` | Generate a cinematic video clip (Veo 3.1) |

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `GOOGLE_GENAI_USE_VERTEXAI` | `false` for local API-key usage, `true` for Vertex AI / Cloud Run |
| `GOOGLE_API_KEY` | Gemini API key for local development |
| `GOOGLE_CLOUD_PROJECT` | Required in production when using Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | Vertex region, e.g. `us-central1` |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend HTTP URL for storyboard/video endpoints |
| `VITE_WS_URL` | `ws://localhost:8000` | Backend WebSocket URL |

## Production deployment

Production is set up for:
- Backend: Cloud Run
- Frontend: Firebase Hosting
- AI auth: Vertex AI with the Cloud Run service account
- CI/CD: GitHub Actions on push to `main`

The deploy workflow lives in `.github/workflows/deploy.yml`.
The full deployment runbook lives in `DEPLOY.md`.

Expected production wiring:
- Frontend builds with `VITE_API_URL=https://<cloud-run-service>`
- Frontend builds with `VITE_WS_URL=wss://<cloud-run-service>`
- Cloud Run sets `GOOGLE_GENAI_USE_VERTEXAI=true`
- Cloud Run sets `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `CORS_ORIGINS`
- Frontend reconnects automatically if the Cloud Run WebSocket times out during a directing session

## Docker

```bash
docker build -t take-backend .
docker run --rm -p 8080:8080 --env-file backend/.env take-backend
```
