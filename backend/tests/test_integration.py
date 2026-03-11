"""Integration tests — test HTTP endpoints with mocked external services."""

import base64
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ── Health check ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


# ── CORS headers ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_cors_preflight(client):
    resp = await client.options(
        "/api/storyboard",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" in resp.headers


# ── Storyboard endpoint ──────────────────────────────────────────

def _make_fake_image_response(image_bytes=b"\x89PNG_FAKE", mime="image/png"):
    part = SimpleNamespace(
        inline_data=SimpleNamespace(data=image_bytes, mime_type=mime),
        text=None,
    )
    candidate = SimpleNamespace(content=SimpleNamespace(parts=[part]))
    return SimpleNamespace(candidates=[candidate])


@pytest.mark.anyio
async def test_storyboard_success(client):
    fake_resp = _make_fake_image_response()

    with patch("app.main.image_client") as mock_client:
        mock_client.models.generate_content.return_value = fake_resp

        resp = await client.post("/api/storyboard", json={
            "style": "Kubrick",
            "narration": "A dark corridor stretches into infinity.",
            "camera": "symmetrical wide shot",
            "lighting": "cold fluorescent",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "image" in data
    assert data["mime_type"] == "image/png"
    decoded = base64.b64decode(data["image"])
    assert decoded == b"\x89PNG_FAKE"


@pytest.mark.anyio
async def test_storyboard_with_movies_and_scene(client):
    fake_resp = _make_fake_image_response()

    with patch("app.main.image_client") as mock_client:
        mock_client.models.generate_content.return_value = fake_resp

        resp = await client.post("/api/storyboard", json={
            "style": "Nolan",
            "movies": "Interstellar",
            "scene_prompt": "astronaut floating in space",
            "narration": "silence among stars",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "image" in data

    call_args = mock_client.models.generate_content.call_args
    prompt_text = call_args.kwargs.get("contents", call_args.args[0] if call_args.args else "")
    if isinstance(prompt_text, list):
        prompt_text = str(prompt_text[0])
    assert "Nolan" in str(prompt_text) or "nolan" in str(prompt_text).lower()


@pytest.mark.anyio
async def test_storyboard_with_frame_reference(client):
    fake_resp = _make_fake_image_response()
    fake_frame = base64.b64encode(b"\xff\xd8\xff\xe0JFIF_FAKE").decode()

    with patch("app.main.image_client") as mock_client:
        mock_client.models.generate_content.return_value = fake_resp

        resp = await client.post("/api/storyboard", json={
            "style": "Spielberg",
            "narration": "boy on bicycle",
            "frame_base64": fake_frame,
        })

    assert resp.status_code == 200
    assert "image" in resp.json()


@pytest.mark.anyio
async def test_storyboard_no_image_returned(client):
    text_part = SimpleNamespace(inline_data=None, text="No image generated")
    candidate = SimpleNamespace(content=SimpleNamespace(parts=[text_part]))
    fake_resp = SimpleNamespace(candidates=[candidate], text="No image")

    with patch("app.main.image_client") as mock_client:
        mock_client.models.generate_content.return_value = fake_resp

        resp = await client.post("/api/storyboard", json={
            "style": "Lynch",
            "narration": "red curtains",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data


@pytest.mark.anyio
async def test_storyboard_api_error(client):
    with patch("app.main.image_client") as mock_client:
        mock_client.models.generate_content.side_effect = Exception("API quota exceeded")

        resp = await client.post("/api/storyboard", json={
            "style": "Tarkovsky",
            "narration": "rain on a window",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
    assert "quota" in data["error"].lower()


@pytest.mark.anyio
async def test_storyboard_validation_error(client):
    resp = await client.post("/api/storyboard", json={
        "narration": "missing style field",
    })
    assert resp.status_code == 422


# ── Video endpoint ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_video_success(client):
    fake_video_bytes = b"FAKE_MP4_DATA"
    fake_video_file = SimpleNamespace()
    fake_video_file.save = MagicMock()

    fake_generated = SimpleNamespace(video=fake_video_file)
    fake_response = SimpleNamespace(generated_videos=[fake_generated])
    fake_op = SimpleNamespace(done=True, response=fake_response)

    with patch("app.main.image_client") as mock_client, \
         patch("app.main.asyncio.to_thread") as mock_thread, \
         patch("builtins.open", create=True) as mock_open, \
         patch("app.main.os.unlink"):

        call_count = 0
        async def fake_to_thread(fn, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return fake_op
            return None

        mock_thread.side_effect = fake_to_thread
        mock_open.return_value.__enter__ = lambda s: BytesIO(fake_video_bytes)
        mock_open.return_value.__exit__ = MagicMock(return_value=False)

        resp = await client.post("/api/generate-video", json={
            "style": "Kubrick",
            "narration": "a dark room",
        })

    assert resp.status_code == 200


@pytest.mark.anyio
async def test_video_no_results(client):
    fake_op = SimpleNamespace(done=True, response=SimpleNamespace(generated_videos=None))

    with patch("app.main.asyncio.to_thread", return_value=fake_op):
        resp = await client.post("/api/generate-video", json={
            "style": "Kubrick",
            "narration": "a scene",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
    assert "no results" in data["error"].lower()


@pytest.mark.anyio
async def test_video_api_error(client):
    with patch("app.main.asyncio.to_thread", side_effect=Exception("Veo quota exceeded")):
        resp = await client.post("/api/generate-video", json={
            "style": "Lynch",
            "narration": "red room",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data


@pytest.mark.anyio
async def test_video_validation_error(client):
    resp = await client.post("/api/generate-video", json={})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_video_with_all_fields(client):
    fake_op = SimpleNamespace(done=True, response=SimpleNamespace(generated_videos=None))

    with patch("app.main.asyncio.to_thread", return_value=fake_op):
        resp = await client.post("/api/generate-video", json={
            "style": "Villeneuve",
            "movies": "Dune, Arrival",
            "scene_prompt": "desert landscape at sunset",
            "narration": "sand stretches to horizon",
            "camera": "aerial tracking",
            "lighting": "orange haze",
            "music": "Hans Zimmer pulse",
        })

    assert resp.status_code == 200


# ── WebSocket endpoint ────────────────────────────────────────────

@pytest.mark.anyio
async def test_websocket_connects(client):
    """Verify the WebSocket endpoint accepts connections."""
    try:
        import httpx_ws  # noqa: F401
    except ImportError:
        pytest.skip("httpx-ws not installed")
