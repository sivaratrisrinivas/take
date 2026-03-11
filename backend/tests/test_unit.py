"""Unit tests — no external API calls. All Gemini/Veo calls are mocked."""

import base64
import textwrap
from unittest.mock import MagicMock, patch

import pytest

from app.main import (
    APP_NAME,
    IMAGE_MODEL,
    STORYBOARD_PROMPT_TEMPLATE,
    VIDEO_PROMPT_TEMPLATE,
    StoryboardRequest,
    VideoRequest,
)
from app.take_agent.agent import DIRECTOR_INSTRUCTION, root_agent


# ── Agent definition ──────────────────────────────────────────────

class TestAgentDefinition:
    def test_agent_name(self):
        assert root_agent.name == "cinematic_director"

    def test_agent_has_model(self):
        assert root_agent.model is not None

    def test_instruction_contains_four_sections(self):
        for marker in ["Now for the camera", "Now for the lighting", "Now for the music"]:
            assert marker in DIRECTOR_INSTRUCTION

    def test_instruction_supports_director_input(self):
        assert "Names a Director" in DIRECTOR_INSTRUCTION or "names a director" in DIRECTOR_INSTRUCTION.lower()

    def test_instruction_supports_creative_brief(self):
        assert "creative brief" in DIRECTOR_INSTRUCTION.lower()


# ── Request model validation ──────────────────────────────────────

class TestRequestModels:
    def test_storyboard_request_required_fields(self):
        req = StoryboardRequest(style="Kubrick", narration="A dark hallway")
        assert req.style == "Kubrick"
        assert req.narration == "A dark hallway"
        assert req.movies == ""
        assert req.scene_prompt == ""
        assert req.camera == ""
        assert req.lighting == ""

    def test_storyboard_request_all_fields(self):
        req = StoryboardRequest(
            style="Nolan",
            movies="Interstellar, Tenet",
            scene_prompt="astronaut drifting in space",
            narration="silence among the stars",
            camera="wide tracking",
            lighting="cold blue",
            frame_base64="abc123",
        )
        assert req.movies == "Interstellar, Tenet"
        assert req.scene_prompt == "astronaut drifting in space"

    def test_video_request_defaults(self):
        req = VideoRequest(style="Tarantino")
        assert req.narration == ""
        assert req.movies == ""
        assert req.scene_prompt == ""
        assert req.storyboard_image_b64 == ""

    def test_video_request_all_fields(self):
        req = VideoRequest(
            style="Fincher",
            movies="Se7en",
            scene_prompt="rain-soaked alley",
            narration="dark city streets",
            camera="steadicam",
            lighting="desaturated green",
            music="industrial drone",
            storyboard_image_b64="xyz",
        )
        assert req.scene_prompt == "rain-soaked alley"


# ── Prompt template formatting ────────────────────────────────────

class TestPromptTemplates:
    def test_storyboard_prompt_includes_all_fields(self):
        rendered = STORYBOARD_PROMPT_TEMPLATE.format(
            style="Kubrick",
            movies_line="REFERENCE FILMS: 2001\n",
            scene_line="USER'S CREATIVE BRIEF: space station\n",
            narration="floating in zero gravity",
            camera="wide symmetrical shot",
            lighting="cold white fluorescent",
        )
        assert "Kubrick" in rendered
        assert "REFERENCE FILMS: 2001" in rendered
        assert "USER'S CREATIVE BRIEF: space station" in rendered
        assert "floating in zero gravity" in rendered
        assert "wide symmetrical shot" in rendered

    def test_storyboard_prompt_without_optionals(self):
        rendered = STORYBOARD_PROMPT_TEMPLATE.format(
            style="Spielberg",
            movies_line="",
            scene_line="",
            narration="a boy on a bicycle",
            camera="crane up",
            lighting="golden hour",
        )
        assert "REFERENCE FILMS" not in rendered
        assert "CREATIVE BRIEF" not in rendered

    def test_video_prompt_includes_all_fields(self):
        rendered = VIDEO_PROMPT_TEMPLATE.format(
            style="Villeneuve",
            movies_line="Visual reference: Dune\n",
            scene_line="Creative brief: desert landscape\n",
            narration="sand dunes stretching forever",
            camera="aerial tracking",
            lighting="orange dusty haze",
            music="Hans Zimmer pulse",
        )
        assert "Villeneuve" in rendered
        assert "Visual reference: Dune" in rendered
        assert "Creative brief: desert landscape" in rendered

    def test_video_prompt_without_optionals(self):
        rendered = VIDEO_PROMPT_TEMPLATE.format(
            style="Lynch",
            movies_line="",
            scene_line="",
            narration="red curtains sway",
            camera="slow dolly",
            lighting="deep red",
            music="ambient drone",
        )
        assert "Visual reference" not in rendered
        assert "Creative brief" not in rendered


# ── Constants ─────────────────────────────────────────────────────

class TestConstants:
    def test_image_model_is_nano_banana_2(self):
        assert IMAGE_MODEL == "gemini-3.1-flash-image-preview"

    def test_app_name(self):
        assert APP_NAME == "take"
