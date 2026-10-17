"""Guards against UTF-8 text being re-saved through a cp1252 tool (an arrow becomes three garbage characters)."""

from pathlib import Path

from tests.conftest import ok

ROOT = Path(__file__).resolve().parents[1]
MOJIBAKE = tuple(chr(a) + chr(b) for a, b in ((0xE2, 0x20AC), (0xE2, 0x2020), (0xC3, 0xA9), (0xC2, 0xB7)))


def test_backend_sources_have_no_mojibake():
    offenders = []
    for path in [*ROOT.joinpath("app").rglob("*.py"), *ROOT.joinpath("tests").rglob("*.py"),
                 *ROOT.joinpath("benchmarks").rglob("*.py"), *ROOT.joinpath("scripts").rglob("*.py")]:
        text = path.read_text(encoding="utf-8")
        if text.startswith(chr(0xFEFF)):
            offenders.append(f"{path.name}: BOM")
        if any(m in text for m in MOJIBAKE):
            offenders.append(f"{path.name}: mojibake")
    assert offenders == []


def test_planner_reasons_render_real_arrows(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    cut = next(c for c in plan["candidates"] if c["family"] == "single_cut")
    assert "maya → support" in cut["edits"][0]["reason"].lower() or "→" in cut["edits"][0]["reason"]
