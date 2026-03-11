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
from urllib.parse import urlparse

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
from google.auth import default as google_auth_default  # noqa: E402
from google.auth.transport.requests import Request as GoogleAuthRequest  # noqa: E402
from google.cloud import storage  # noqa: E402
from google.genai import types  # noqa: E402
import httpx  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.take_agent.agent import root_agent  # noqa: E402

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

# ---------------------------------------------------------------------------
# Phase 1: Application Initialisation (runs once at startup)
# ---------------------------------------------------------------------------
APP_NAME = "take"

app = FastAPI(title="take backend")

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allow_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
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
# Vertex: set GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION; auth via ADC (e.g. Cloud Run SA).
_use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
image_client = None


def _get_image_client():
    global image_client
    if image_client is not None:
        return image_client

    if _use_vertex:
        image_client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
    else:
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY is required when Vertex AI is disabled")
        image_client = genai.Client(api_key=api_key)

    return image_client

vertex_credentials = None
storage_client = None
if _use_vertex:
    vertex_credentials, _ = google_auth_default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    storage_client = storage.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT"))

IMAGE_MODEL = (
    "gemini-2.5-flash-image"
    if _use_vertex
    else "gemini-3.1-flash-image-preview"
)

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
    movies: str = ""
    scene_prompt: str = ""
    narration: str
    camera: str = ""
    lighting: str = ""
    frame_base64: str = ""


STORYBOARD_PROMPT_TEMPLATE = """You are a storyboard artist for a cinematic film.
Generate a SINGLE storyboard frame illustration — a wide cinematic shot (16:9 aspect ratio).

DIRECTOR STYLE: {style}
{movies_line}{scene_line}SCENE NARRATION: {narration}
CAMERA DIRECTION: {camera}
LIGHTING & COLOR: {lighting}

Create a beautiful, cinematic storyboard illustration that captures this exact moment.
The image should look like a professional film storyboard frame with:
- Dramatic composition matching the camera direction
- Color palette matching the lighting description
- The mood and atmosphere of the named director's visual style
- Wide 16:9 cinematic framing

DO NOT include any text, labels, or annotations in the image.
Generate ONLY the image, no text response."""


@app.post("/api/storyboard")
async def generate_storyboard(req: StoryboardRequest):
    """Generate a cinematic storyboard frame using Gemini image generation."""
    logger.info("Storyboard request: style=%s", req.style)

    movies_line = f"REFERENCE FILMS: {req.movies}\n" if req.movies else ""
    scene_line = f"USER'S CREATIVE BRIEF: {req.scene_prompt}\n" if req.scene_prompt else ""
    prompt = STORYBOARD_PROMPT_TEMPLATE.format(
        style=req.style,
        movies_line=movies_line,
        scene_line=scene_line,
        narration=req.narration[:500],
        camera=req.camera or "wide establishing shot",
        lighting=req.lighting or "natural cinematic lighting",
    )

    try:
        client = _get_image_client()
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
            client.models.generate_content,
            model=IMAGE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="16:9",
                ),
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


def _get_vertex_access_token() -> str:
    if not vertex_credentials:
        raise RuntimeError("Vertex credentials are not configured")
    if not vertex_credentials.valid or vertex_credentials.expired:
        vertex_credentials.refresh(GoogleAuthRequest())
    return vertex_credentials.token


def _download_gcs_bytes(gcs_uri: str) -> bytes:
    if not storage_client:
        raise RuntimeError("Storage client is not configured")
    parsed = urlparse(gcs_uri)
    bucket = storage_client.bucket(parsed.netloc)
    blob = bucket.blob(parsed.path.lstrip("/"))
    return blob.download_as_bytes()


def _extract_video_gcs_uri(video_obj: dict) -> str:
    if not isinstance(video_obj, dict):
        raise KeyError(f"unexpected_video_shape:{type(video_obj).__name__}")

    candidates = [
        video_obj.get("gcsUri"),
        video_obj.get("gcs_uri"),
        video_obj.get("uri"),
        (video_obj.get("video") or {}).get("gcsUri") if isinstance(video_obj.get("video"), dict) else None,
        (video_obj.get("video") or {}).get("gcs_uri") if isinstance(video_obj.get("video"), dict) else None,
        (video_obj.get("file") or {}).get("gcsUri") if isinstance(video_obj.get("file"), dict) else None,
    ]
    for candidate in candidates:
        if candidate:
            return candidate

    raise KeyError("gcsUri")


def _extract_video_bytes(video_obj: dict) -> bytes | None:
    if not isinstance(video_obj, dict):
        return None

    candidates = [
        video_obj.get("bytesBase64Encoded"),
        video_obj.get("bytes_base64_encoded"),
        (video_obj.get("video") or {}).get("bytesBase64Encoded") if isinstance(video_obj.get("video"), dict) else None,
        (video_obj.get("video") or {}).get("bytes_base64_encoded") if isinstance(video_obj.get("video"), dict) else None,
    ]
    for candidate in candidates:
        if candidate:
            return base64.b64decode(candidate)

    return None

class VideoRequest(BaseModel):
    style: str
    movies: str = ""
    scene_prompt: str = ""
    narration: str = ""
    camera: str = ""
    lighting: str = ""
    music: str = ""
    storyboard_image_b64: str = ""


VIDEO_PROMPT_TEMPLATE = """Create a cinematic short film scene inspired by the visual language associated with {style}.
{movies_line}{scene_line}
SCENE: {narration}

CAMERA DIRECTION: {camera}
LIGHTING & COLOR: {lighting}
MUSIC & SOUND: {music}

Create a single continuous cinematic shot with strong atmosphere, clear composition, and natural motion.
Use the style only as creative inspiration, not as a literal recreation of any existing film, character, or copyrighted scene.
Include ambient sound effects and music matching the described audio direction."""

VIDEO_PROMPT_FALLBACK_TEMPLATE = """Create a cinematic short film scene.
SCENE: {narration}

CAMERA DIRECTION: {camera}
LIGHTING & COLOR: {lighting}
MUSIC & SOUND: {music}

Create a single continuous cinematic shot with strong atmosphere, clear composition, natural motion, and emotionally coherent sound design."""


@app.post("/api/generate-video")
async def generate_video(req: VideoRequest):
    """Generate a cinematic video clip using Veo 3.1."""
    logger.info("Video generation request: style=%s", req.style)

    movies_line = f"Visual reference: {req.movies}\n" if req.movies else ""
    scene_line = f"Creative brief: {req.scene_prompt}\n" if req.scene_prompt else ""
    prompt = VIDEO_PROMPT_TEMPLATE.format(
        style=req.style,
        movies_line=movies_line,
        scene_line=scene_line,
        narration=req.narration[:600] or "A cinematic scene",
        camera=req.camera[:200] or "smooth tracking shot",
        lighting=req.lighting[:200] or "cinematic lighting",
        music=req.music[:200] or "atmospheric score",
    )
    fallback_prompt = VIDEO_PROMPT_FALLBACK_TEMPLATE.format(
        narration=req.narration[:600] or "A cinematic scene",
        camera=req.camera[:200] or "smooth tracking shot",
        lighting=req.lighting[:200] or "cinematic lighting",
        music=req.music[:200] or "atmospheric score",
    )

    try:
        image_api_client = _get_image_client()
        compressed_image = None
        if req.storyboard_image_b64:
            try:
                from io import BytesIO
                from PIL import Image as PILImage

                img_bytes = base64.b64decode(req.storyboard_image_b64)
                img = PILImage.open(BytesIO(img_bytes))
                img.thumbnail((1024, 1024), PILImage.LANCZOS)
                buf = BytesIO()
                img.save(buf, format="JPEG", quality=80)
                compressed_image = buf.getvalue()
                logger.info(
                    "Prepared Veo reference image (%d bytes, compressed from %d)",
                    len(compressed_image),
                    len(img_bytes),
                )
            except Exception as img_err:
                logger.warning("Could not process storyboard image: %s", img_err)

        async def try_generate(prompt_text: str, use_image: bool):
            if _use_vertex:
                token = await asyncio.to_thread(_get_vertex_access_token)
                base_url = (
                    "https://us-central1-aiplatform.googleapis.com/v1/"
                    f"projects/{os.getenv('GOOGLE_CLOUD_PROJECT')}/locations/us-central1/"
                    f"publishers/google/models/{VEO_MODEL}"
                )
                instance = {"prompt": prompt_text}
                if use_image and compressed_image:
                    instance["image"] = {
                        "bytesBase64Encoded": base64.b64encode(compressed_image).decode("utf-8"),
                        "mimeType": "image/jpeg",
                    }

                payload = {
                    "instances": [instance],
                    "parameters": {
                        "aspectRatio": "16:9",
                        "sampleCount": 1,
                    },
                }

                async with httpx.AsyncClient(timeout=60) as http_client:
                    start_resp = await http_client.post(
                        f"{base_url}:predictLongRunning",
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json; charset=utf-8",
                        },
                        json=payload,
                    )
                    start_resp.raise_for_status()
                    operation_name = start_resp.json()["name"]

                    max_polls = 60
                    poll_json = None
                    for i in range(max_polls):
                        await asyncio.sleep(10)
                        poll_resp = await http_client.post(
                            f"{base_url}:fetchPredictOperation",
                            headers={
                                "Authorization": f"Bearer {token}",
                                "Content-Type": "application/json; charset=utf-8",
                            },
                            json={"operationName": operation_name},
                        )
                        poll_resp.raise_for_status()
                        poll_json = poll_resp.json()
                        if poll_json.get("done"):
                            break

                if not poll_json or not poll_json.get("done"):
                    logger.error("Veo generation timed out after %d polls", max_polls)
                    return None, "Video generation timed out"

                response = poll_json.get("response") or {}
                videos = response.get("videos") or []
                if not videos:
                    logger.error("Veo returned no videos. Response: %s", response)
                    filtered = response.get("raiMediaFilteredCount", 0)
                    if filtered:
                        return None, "Video generation was filtered by Vertex AI"
                    return None, "Video generation returned no results"

                video_bytes = _extract_video_bytes(videos[0])
                if video_bytes is None:
                    gcs_uri = _extract_video_gcs_uri(videos[0])
                    video_bytes = await asyncio.to_thread(_download_gcs_bytes, gcs_uri)
                return {
                    "video_bytes": video_bytes,
                    "mime_type": videos[0].get("mimeType", "video/mp4"),
                }, None

            kwargs = {
                "model": VEO_MODEL,
                "prompt": prompt_text,
                "config": types.GenerateVideosConfig(
                    aspect_ratio="16:9",
                ),
            }
            if use_image and compressed_image:
                kwargs["image"] = types.Image(
                    image_bytes=compressed_image,
                    mime_type="image/jpeg",
                )

            operation = await asyncio.to_thread(
                image_api_client.models.generate_videos,
                **kwargs,
            )

            max_polls = 60
            for i in range(max_polls):
                if operation.done:
                    break
                await asyncio.sleep(10)
                operation = await asyncio.to_thread(
                    image_api_client.operations.get, operation
                )

            if not operation.done:
                logger.error("Veo generation timed out after %d polls", max_polls)
                return None, "Video generation timed out"

            if not operation.response or not operation.response.generated_videos:
                logger.error("Veo returned no videos. Response: %s", operation.response)
                return None, "Video generation returned no results"

            generated_video = operation.response.generated_videos[0]
            await asyncio.to_thread(
                image_api_client.files.download,
                file=generated_video.video,
            )
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name
            generated_video.video.save(tmp_path)
            with open(tmp_path, "rb") as f:
                video_data = f.read()
            os.unlink(tmp_path)
            return {
                "video_bytes": video_data,
                "mime_type": "video/mp4",
            }, None

        generated_video = None
        last_error = None
        attempts = [
            (prompt, True),
            (prompt, False),
            (fallback_prompt, False),
        ]
        for prompt_text, use_image in attempts:
            generated_video, last_error = await try_generate(prompt_text, use_image)
            if generated_video:
                break

        if not generated_video:
            return {
                "error": (
                    f"{last_error} — Veo likely filtered the request. "
                    "Try a less specific director reference or a calmer scene description."
                )
            }

        video_data = generated_video["video_bytes"]
        video_b64 = base64.b64encode(video_data).decode("utf-8")
        logger.info("Video generated: %d bytes", len(video_data))

        return {
            "video": video_b64,
            "mime_type": generated_video.get("mime_type", "video/mp4"),
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
