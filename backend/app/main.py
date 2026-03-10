"""Take — Cinematic AI Film Director (ADK Streaming Server).

FastAPI backend that uses Google ADK bidi-streaming to connect a live
camera/microphone to the Gemini Live API for real-time cinematic direction.

Includes a separate HTTP endpoint for storyboard image generation using
Gemini's native image generation capabilities.
"""

import asyncio
import base64
import json
import logging
import os
import warnings
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE importing the agent (ADK reads env at import time)
load_dotenv(Path(__file__).parent.parent / ".env")

# pylint: disable=wrong-import-position
from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from google import genai  # noqa: E402
from google.adk.agents.live_request_queue import LiveRequestQueue  # noqa: E402
from google.adk.agents.run_config import RunConfig, StreamingMode  # noqa: E402
from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.take_agent.agent import root_agent  # noqa: E402

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

# ---------------------------------------------------------------------------
# Phase 1: Application Initialisation (runs once at startup)
# ---------------------------------------------------------------------------
APP_NAME = "take"

app = FastAPI(title="take backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_service = InMemorySessionService()

runner = Runner(
    app_name=APP_NAME,
    agent=root_agent,
    session_service=session_service,
)

# Gemini client for image generation (separate from ADK)
image_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation"

# ---------------------------------------------------------------------------
# Health check (kept for ops / Docker)
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Storyboard generation endpoint
# ---------------------------------------------------------------------------

class StoryboardRequest(BaseModel):
    style: str
    narration: str
    camera: str = ""
    lighting: str = ""
    frame_base64: str = ""  # Optional: camera frame as reference


STORYBOARD_PROMPT_TEMPLATE = """You are a storyboard artist for a cinematic film.
Generate a SINGLE storyboard frame illustration — a wide cinematic shot (16:9 aspect ratio).

STYLE: {style}
SCENE NARRATION: {narration}
CAMERA DIRECTION: {camera}
LIGHTING & COLOR: {lighting}

Create a beautiful, cinematic storyboard illustration that captures this exact moment.
The image should look like a professional film storyboard frame with:
- Dramatic composition matching the camera direction
- Color palette matching the lighting description
- The mood and atmosphere of the chosen cinematic style
- Wide 16:9 cinematic framing

DO NOT include any text, labels, or annotations in the image.
Generate ONLY the image, no text response."""


@app.post("/api/storyboard")
async def generate_storyboard(req: StoryboardRequest):
    """Generate a cinematic storyboard frame using Gemini image generation."""
    logger.info("Storyboard request: style=%s", req.style)

    prompt = STORYBOARD_PROMPT_TEMPLATE.format(
        style=req.style,
        narration=req.narration[:500],  # Limit for token budget
        camera=req.camera or "wide establishing shot",
        lighting=req.lighting or "natural cinematic lighting",
    )

    try:
        # Build content parts
        contents = [prompt]

        # If a reference camera frame is provided, include it
        if req.frame_base64:
            frame_bytes = base64.b64decode(req.frame_base64)
            contents = [
                types.Part.from_text(
                    text=f"Here is the actual scene from the camera. "
                         f"Create a storyboard illustration inspired by this scene.\n\n{prompt}"
                ),
                types.Part.from_bytes(data=frame_bytes, mime_type="image/jpeg"),
            ]

        response = await asyncio.to_thread(
            image_client.models.generate_content,
            model=IMAGE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        # Extract generated image
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                image_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                mime = part.inline_data.mime_type or "image/png"
                logger.info("Storyboard generated: %d bytes", len(part.inline_data.data))
                return {
                    "image": image_b64,
                    "mime_type": mime,
                }

        # No image in response
        logger.warning("No image returned from model")
        return {"error": "No image generated", "text": getattr(response, "text", "")}

    except Exception as exc:
        logger.error("Storyboard generation error: %s", exc, exc_info=True)
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Video generation endpoint (Veo 3.1)
# ---------------------------------------------------------------------------

VEO_MODEL = "veo-3.1-generate-preview"

class VideoRequest(BaseModel):
    style: str
    narration: str = ""
    camera: str = ""
    lighting: str = ""
    music: str = ""
    storyboard_image_b64: str = ""  # first storyboard frame as reference


VIDEO_PROMPT_TEMPLATE = """Cinematic short film in the "{style}" style.

SCENE: {narration}

CAMERA DIRECTION: {camera}
LIGHTING & COLOR: {lighting}
MUSIC & SOUND: {music}

Create a single continuous cinematic shot that captures this scene with professional filmmaking quality.
The video should feel like a real {style} film — with the described camera movement, color grading, and atmosphere.
Include ambient sound effects and music matching the described audio direction."""


@app.post("/api/generate-video")
async def generate_video(req: VideoRequest):
    """Generate a cinematic video clip using Veo 3.1."""
    logger.info("Video generation request: style=%s", req.style)

    prompt = VIDEO_PROMPT_TEMPLATE.format(
        style=req.style,
        narration=req.narration[:600] or "A cinematic scene",
        camera=req.camera[:200] or "smooth tracking shot",
        lighting=req.lighting[:200] or "cinematic lighting",
        music=req.music[:200] or "atmospheric score",
    )

    try:
        # Build generate_videos kwargs
        kwargs = {
            "model": VEO_MODEL,
            "prompt": prompt,
            "config": types.GenerateVideosConfig(
                aspect_ratio="16:9",
            ),
        }

        # Use storyboard image as reference if available
        if req.storyboard_image_b64:
            try:
                img_bytes = base64.b64decode(req.storyboard_image_b64)
                kwargs["image"] = types.Image(
                    image_bytes=img_bytes,
                    mime_type="image/png",
                )
                logger.info("Using storyboard image as Veo reference (%d bytes)", len(img_bytes))
            except Exception as img_err:
                logger.warning("Could not decode storyboard image: %s", img_err)

        # Start async video generation
        import time
        operation = await asyncio.to_thread(
            image_client.models.generate_videos,
            **kwargs,
        )

        logger.info("Veo operation started, polling for completion...")

        # Poll until done (typically 1-3 minutes)
        max_polls = 60  # 10s * 60 = 10 min max
        for i in range(max_polls):
            if operation.done:
                break
            logger.debug("Veo poll %d: still generating...", i + 1)
            await asyncio.sleep(10)
            operation = await asyncio.to_thread(
                image_client.operations.get, operation
            )

        if not operation.done:
            logger.error("Veo generation timed out after %d polls", max_polls)
            return {"error": "Video generation timed out"}

        # Download the generated video
        generated_video = operation.response.generated_videos[0]
        await asyncio.to_thread(
            image_client.files.download,
            file=generated_video.video,
        )

        # Save to temp file and read bytes
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        generated_video.video.save(tmp_path)
        with open(tmp_path, "rb") as f:
            video_data = f.read()
        os.unlink(tmp_path)

        video_b64 = base64.b64encode(video_data).decode("utf-8")
        logger.info("Video generated: %d bytes", len(video_data))

        return {
            "video": video_b64,
            "mime_type": "video/mp4",
        }

    except Exception as exc:
        logger.error("Video generation error: %s", exc, exc_info=True)
        return {"error": str(exc)}

# ---------------------------------------------------------------------------
# WebSocket streaming endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str,
    session_id: str,
) -> None:
    """Bidirectional streaming between the browser and the ADK agent."""

    logger.info(
        "WebSocket request: user_id=%s  session_id=%s", user_id, session_id
    )
    await websocket.accept()
    logger.debug("WebSocket accepted")

    # ------------------------------------------------------------------
    # Phase 2: Session Initialisation
    # ------------------------------------------------------------------
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=types.SessionResumptionConfig(),
    )

    session = await session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id,
    )
    if not session:
        await session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id,
        )

    live_request_queue = LiveRequestQueue()

    # ------------------------------------------------------------------
    # Phase 3: Active bidi-streaming session
    # ------------------------------------------------------------------

    async def upstream_task() -> None:
        """Receive from WebSocket → push into LiveRequestQueue."""
        while True:
            message = await websocket.receive()

            # Binary frames → audio PCM data
            if "bytes" in message:
                audio_data = message["bytes"]
                audio_blob = types.Blob(
                    mime_type="audio/pcm;rate=16000", data=audio_data,
                )
                live_request_queue.send_realtime(audio_blob)

            # Text frames → JSON messages (text commands or image frames)
            elif "text" in message:
                text_data = message["text"]

                try:
                    json_message = json.loads(text_data)
                except json.JSONDecodeError:
                    continue

                msg_type = json_message.get("type")

                if msg_type == "text":
                    content = types.Content(
                        parts=[types.Part(text=json_message["text"])]
                    )
                    live_request_queue.send_content(content)

                elif msg_type == "image":
                    image_data = base64.b64decode(json_message["data"])
                    mime_type = json_message.get("mimeType", "image/jpeg")
                    image_blob = types.Blob(
                        mime_type=mime_type, data=image_data,
                    )
                    live_request_queue.send_realtime(image_blob)

    async def downstream_task() -> None:
        """Iterate run_live() events → send to WebSocket."""
        async for event in runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=live_request_queue,
            run_config=run_config,
        ):
            event_json = event.model_dump_json(
                exclude_none=True, by_alias=True,
            )
            await websocket.send_text(event_json)

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.error("Streaming error: %s", exc, exc_info=True)
    finally:
        # ------------------------------------------------------------------
        # Phase 4: Session Termination
        # ------------------------------------------------------------------
        live_request_queue.close()
