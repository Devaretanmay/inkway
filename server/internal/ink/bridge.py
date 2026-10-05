"""Local JSONL adapter from the Inkway daemon to the Ink SDK."""

from __future__ import annotations

import json
import hashlib
import os
import platform
import sys
import urllib.error
import urllib.request
from pathlib import Path

from ink import DecisionSite, FallbackResult, Ink, __version__
from ink.internal.model import registry

if __version__ != "0.6.0rc2":
    raise RuntimeError("Ink SDK 0.6.0rc2 required")

PROTOCOL_VERSION = 1
MODEL_SPEC = None
MODEL_ERROR = None
try:
    _manifest_path = Path(os.environ["INK_RUNTIME_MANIFEST"])
    _runtime_manifest = json.loads(_manifest_path.read_text())
    if _runtime_manifest.get("bridge_protocol_version") != PROTOCOL_VERSION:
        raise ValueError("bridge protocol is incompatible")
    if _runtime_manifest.get("ink_version") != __version__:
        raise ValueError("Ink version is incompatible")
    if _runtime_manifest.get("inkway_version") != os.environ.get("INK_INKWAY_VERSION"):
        raise ValueError("Inkway runtime manifest is incompatible")
    if _runtime_manifest.get("python_version") != platform.python_version():
        raise ValueError("bundled Python version is incompatible")
    if _runtime_manifest.get("platform") != "darwin-arm64" or platform.machine() != "arm64":
        raise ValueError("bundled Ink platform is incompatible")
    MODEL_SPEC = registry.specification(registry.model_path())
    registry.verify(registry.model_path())
    if (
        MODEL_SPEC.get("name") != _runtime_manifest.get("model_name")
        or MODEL_SPEC.get("version") != _runtime_manifest.get("model_version")
        or not MODEL_SPEC.get("weights_modified")
        or not MODEL_SPEC.get("trained_by")
        or MODEL_SPEC.get("sha256", {}).get("model.safetensors") != _runtime_manifest.get("model_weights_sha256")
    ):
        raise ValueError("trained model does not match the compatibility manifest")
    model_manifest = registry.model_path() / "ink-model.json"
    if hashlib.sha256(model_manifest.read_bytes()).hexdigest() != _runtime_manifest.get("model_manifest_sha256"):
        raise ValueError("trained model manifest checksum mismatch")
except Exception as exc:
    MODEL_ERROR = type(exc).__name__

SITE = DecisionSite(
    name="coding_agent.recovery_action",
    state_schema={
        "provider": "string",
        "failure_reason": "string",
        "retry_attempt": "integer",
        "previous_session_exists": "boolean",
    },
    choices=("resume_session", "fresh_session"),
    fallback_revision="1",
)


def teacher_choice(state: dict, safe_choice: str) -> tuple[str, str | None, int]:
    base = os.getenv("INK_TEACHER_BASE_URL", "").strip().rstrip("/")
    key = os.getenv("INK_TEACHER_API_KEY", "").strip()
    model = os.getenv("INK_TEACHER_MODEL", "").strip()
    if not (base and key and model):
        return safe_choice, "teacher_not_configured", 0
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Choose exactly one coding-agent recovery action. Return only JSON: "
                    '{"choice":"resume_session"} or {"choice":"fresh_session"}. '
                    "Resume only when bounded state supports continuity; otherwise choose fresh."
                ),
            },
            {"role": "user", "content": json.dumps(state, separators=(",", ":"))},
        ],
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "ink-platform/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            payload = json.loads(response.read(256_000))
        content = payload["choices"][0]["message"]["content"]
        decoded = json.loads(content)
        choice = decoded.get("choice") if isinstance(decoded, dict) else None
        if choice not in SITE.choices:
            return safe_choice, "teacher_invalid_output", 1
        return choice, None, 1
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        return safe_choice, "teacher_unavailable_or_invalid", 1


def main() -> None:
    db_path = Path(os.getenv("INK_DB_PATH", str(Path.home() / ".ink" / "decisions.db"))).expanduser()
    db_path = Path(migrate_legacy_database(db_path))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    client = Ink(path=str(db_path), auto_maintenance=False, disable_fast_path=MODEL_SPEC is None)
    client.register(SITE)
    for raw in sys.stdin:
        request = {}
        try:
            request = json.loads(raw)
            rid = request.get("id")
            op = request.get("op")
            if op == "hello":
                response = {
                    "id": rid,
                    "ok": True,
                    "version": __version__,
                    "protocol_version": PROTOCOL_VERSION,
                    "model_name": MODEL_SPEC.get("name") if MODEL_SPEC else "",
                    "model_version": MODEL_SPEC.get("version") if MODEL_SPEC else "",
                    "model_sha256": MODEL_SPEC.get("sha256", {}).get("model.safetensors", "") if MODEL_SPEC else "",
                    "model_verified": MODEL_SPEC is not None,
                    "model_error": MODEL_ERROR,
                }
            elif op == "decide":
                state = request["state"]
                safe_choice = request.get("safe_choice", "resume_session")
                teacher_error = None

                def fallback():
                    nonlocal teacher_error
                    choice, teacher_error, model_calls = teacher_choice(state, safe_choice)
                    return FallbackResult(choice=choice, model_calls=model_calls)

                result = client.decide(
                    site=SITE,
                    state=state,
                    fallback=fallback,
                    task_id=request.get("correlation_id"),
                )
                response = {
                    "id": rid,
                    "ok": True,
                    "choice": result.choice,
                    "source": result.source,
                    "decision_id": result.decision_id,
                    "site_version": result.site_version,
                    "fast_path_version": result.fast_path_version,
                    "fallback_reason": result.fallback_reason,
                    "host_fallback_reason": teacher_error,
                }
            elif op == "record_outcome":
                outcome = client.record_outcome(
                    request.get("decision_id"),
                    quality=request["quality"],
                    verifier=request["verifier"],
                    verifier_version=request["verifier_version"],
                    evidence=request.get("evidence", {}),
                )
                response = {"id": rid, "ok": True, "recorded": outcome is not None}
            elif op == "fleet_health":
                health = client.fleet_health()
                for site_name, site_health in health.get("sites", {}).items():
                    if site_name == SITE.name:
                        site_health["verified_outcomes"] = client.status(SITE)["outcomes"]
                response = {"id": rid, "ok": True, "health": health}
            elif op == "maintenance":
                response = {"id": rid, "ok": True, "maintenance": client.maintenance(max_sites=1, max_rows=100, time_budget_sec=1.0)}
            elif op == "shutdown":
                response = {"id": rid, "ok": True}
                print(json.dumps(response, separators=(",", ":")), flush=True)
                break
            else:
                response = {"id": rid, "ok": False, "error": "invalid_operation"}
        except Exception as exc:  # Bridge errors must be returned, never crash the daemon.
            rid = request.get("id") if isinstance(request, dict) else None
            response = {"id": rid, "ok": False, "error": type(exc).__name__}
        print(json.dumps(response, separators=(",", ":"), default=str), flush=True)
    client.close()


if __name__ == "__main__":
    main()
