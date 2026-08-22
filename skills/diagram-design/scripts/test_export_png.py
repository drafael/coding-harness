#!/usr/bin/env python3
"""Tests for export_png.py runtime and Chromium discovery."""

from __future__ import annotations

import argparse
import importlib.util
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("export_png.py")


def load_module():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("diagram_design_export_png", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load export_png.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("placeholder\n", encoding="utf-8")
    path.chmod(0o755)
    return path


class FakeBrowser:
    version = "123.0"

    def close(self) -> None:
        return None


class FakeChromium:
    def __init__(self, executable_path: Path, outcomes: list[object]) -> None:
        self.executable_path = str(executable_path)
        self.outcomes = outcomes
        self.launches: list[dict[str, str]] = []

    def launch(self, **kwargs):
        self.launches.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakePlaywright:
    def __init__(self, chromium: FakeChromium) -> None:
        self.chromium = chromium


def main() -> int:
    module = load_module()

    with tempfile.TemporaryDirectory(prefix="export-png-test-") as temp_dir:
        root = Path(temp_dir)
        override = touch(root / "override/python")
        current = touch(root / "current/python")
        path_python = touch(root / "path/python3")
        project_python = touch(root / "project/.venv/bin/python3")

        def which_python(command: str) -> str | None:
            return str(path_python) if command == "python3" else None

        candidates = module.python_candidates(
            root / "project/diagram.html",
            environ={module.PYTHON_OVERRIDE: str(override)},
            which=which_python,
            current_executable=str(current),
            cwd=root / "project",
        )
        if candidates[:3] != [override, current, project_python]:
            raise AssertionError(f"unexpected Python candidate order: {candidates[:3]}")
        if candidates.count(path_python) != 1:
            raise AssertionError("PATH Python was not discovered exactly once")
        print("OK: Python discovery prioritizes override, active runtime, and project virtualenv")

        venv_link = root / "symlink-venv/python"
        venv_link.parent.mkdir(parents=True)
        try:
            venv_link.symlink_to(current)
        except OSError as error:
            print(f"SKIP: virtualenv symlink identity check unavailable: {error}")
        else:
            distinct_invocations = module.unique_paths([venv_link, current])
            if distinct_invocations != [venv_link, current]:
                raise AssertionError(
                    "virtualenv interpreter symlink was collapsed into its base Python"
                )
            print("OK: virtualenv interpreter remains distinct from its base Python binary")

        unexpected_lookup = False

        def reject_lookup(_command: str) -> str | None:
            nonlocal unexpected_lookup
            unexpected_lookup = True
            return None

        relative_override = module.resolve_command("./custom-python", reject_lookup)
        if relative_override != Path("custom-python") or unexpected_lookup:
            raise AssertionError(
                "relative executable override was incorrectly resolved through PATH"
            )
        print("OK: explicit relative executable paths bypass PATH lookup")

        probed: list[Path] = []

        def probe(candidate: Path) -> bool:
            probed.append(candidate)
            return candidate == project_python

        discovered = module.find_playwright_python(candidates, probe)
        if discovered != project_python or probed[-1] != project_python:
            raise AssertionError("Playwright interpreter probing did not stop at the first match")
        print("OK: Playwright interpreter probe selects the first usable runtime")

        browser_override = touch(root / "browsers/override-chrome")
        path_browser = touch(root / "browsers/chromium")

        def which_browser(command: str) -> str | None:
            return str(path_browser) if command == "chromium" else None

        browsers = module.system_browser_candidates(
            environ={module.BROWSER_OVERRIDE: str(browser_override)},
            which=which_browser,
            platform_name="linux",
            home=root,
        )
        if [candidate.executable for candidate in browsers[:2]] != [
            browser_override,
            path_browser,
        ]:
            raise AssertionError(f"unexpected browser candidate order: {browsers}")
        print("OK: browser discovery prioritizes explicit override before PATH")

        managed = touch(root / "managed/chrome")
        managed_chromium = FakeChromium(managed, [FakeBrowser()])
        browser, description = module.launch_browser(FakePlaywright(managed_chromium), [])
        if not isinstance(browser, FakeBrowser) or managed_chromium.launches != [{}]:
            raise AssertionError("managed Chromium was not launched first")
        if "Playwright Chromium" not in description:
            raise AssertionError(f"managed browser description missing: {description}")
        print("OK: Playwright-managed Chromium is preferred")

        missing_managed = root / "missing/chrome"
        fallback_chromium = FakeChromium(
            missing_managed,
            [RuntimeError("broken override"), FakeBrowser()],
        )
        first = module.BrowserCandidate("override", browser_override)
        second = module.BrowserCandidate("PATH Chromium", path_browser)
        browser, description = module.launch_browser(
            FakePlaywright(fallback_chromium),
            [first, second],
        )
        if not isinstance(browser, FakeBrowser):
            raise AssertionError("system browser fallback did not return a browser")
        if fallback_chromium.launches != [
            {"executable_path": str(browser_override)},
            {"executable_path": str(path_browser)},
        ]:
            raise AssertionError(f"unexpected fallback launches: {fallback_chromium.launches}")
        if "PATH Chromium" not in description:
            raise AssertionError(f"fallback description missing: {description}")
        print("OK: failed browser candidates fall through to the next installed browser")

        no_browser = FakeChromium(missing_managed, [])
        try:
            module.launch_browser(FakePlaywright(no_browser), [])
        except module.DiscoveryError as error:
            if "playwright install chromium" not in str(error):
                raise AssertionError(f"missing remediation in discovery error: {error}")
        else:
            raise AssertionError("missing browsers did not raise DiscoveryError")
        print("OK: missing browser reports actionable remediation")

    for value in ("1", "1.25", "2", "4"):
        module.scale_value(value)
    for value in ("0.5", "4.1", "invalid"):
        try:
            module.scale_value(value)
        except argparse.ArgumentTypeError:
            continue
        raise AssertionError(f"invalid scale accepted: {value}")
    print("OK: export scale accepts the documented 1 through 4 range")

    if module.viewbox_dimensions("0 0 1000 600") != (1000.0, 600.0):
        raise AssertionError("valid whitespace-separated viewBox was not parsed")
    if module.viewbox_dimensions("0,0,1280,720") != (1280.0, 720.0):
        raise AssertionError("valid comma-separated viewBox was not parsed")
    for value in (None, "0 0 1000", "0 0 -1 600", "0 0 nan 600", "invalid"):
        try:
            module.viewbox_dimensions(value)
        except module.DiscoveryError:
            continue
        raise AssertionError(f"invalid viewBox accepted: {value}")
    print("OK: SVG viewBox dimensions are validated before rasterization")

    class FakePage:
        viewport: dict[str, int] | None = None

        def set_viewport_size(self, size: dict[str, int]) -> None:
            self.viewport = size

    class FakeDiagram:
        evaluation: tuple[str, dict[str, float]] | None = None

        def get_attribute(self, name: str) -> str | None:
            return "0 0 1000 600" if name == "viewBox" else None

        def evaluate(self, expression: str, argument: dict[str, float]) -> None:
            self.evaluation = (expression, argument)

    fake_page = FakePage()
    fake_diagram = FakeDiagram()
    dimensions = module.size_svg_for_export(fake_page, fake_diagram)
    if dimensions != (1000.0, 600.0) or fake_page.viewport != {
        "width": 1000,
        "height": 600,
    }:
        raise AssertionError("SVG export viewport did not follow the viewBox")
    if fake_diagram.evaluation is None or "replaceChildren" not in fake_diagram.evaluation[0]:
        raise AssertionError("SVG was not isolated from page layout before capture")
    print("OK: SVG capture is isolated and sized to its viewBox")

    print("All export PNG discovery tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
