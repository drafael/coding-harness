#!/usr/bin/env python3
"""Export a Diagram Design HTML file to PNG with local runtime discovery."""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

PYTHON_OVERRIDE = "DIAGRAM_DESIGN_PYTHON"
BROWSER_OVERRIDE = "DIAGRAM_DESIGN_CHROMIUM"
REEXEC_MARKER = "DIAGRAM_DESIGN_PLAYWRIGHT_REEXEC"
PLAYWRIGHT_PROBE = (
    "import sys; from playwright.sync_api import sync_playwright; "
    "raise SystemExit(0 if sys.version_info >= (3, 10) else 2)"
)
BROWSER_COMMANDS = (
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "chrome",
    "microsoft-edge",
    "msedge",
)


class DiscoveryError(RuntimeError):
    """Raised when no usable Playwright runtime or Chromium browser is found."""


@dataclass(frozen=True)
class BrowserCandidate:
    label: str
    executable: Path | None


def unique_paths(paths: Iterable[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        expanded = path.expanduser()
        key = str(expanded.absolute())
        if key in seen:
            continue
        seen.add(key)
        result.append(expanded)
    return result


def resolve_command(value: str, which: Callable[[str], str | None]) -> Path:
    expanded = Path(value).expanduser()
    if expanded.is_absolute() or "/" in value or "\\" in value:
        return expanded
    resolved = which(value)
    return Path(resolved) if resolved else expanded


def python_candidates(
    source: Path | None = None,
    *,
    environ: Mapping[str, str] = os.environ,
    which: Callable[[str], str | None] = shutil.which,
    current_executable: str = sys.executable,
    cwd: Path | None = None,
) -> list[Path]:
    """Return Python interpreters in deterministic discovery order."""
    candidates: list[Path] = []
    override = environ.get(PYTHON_OVERRIDE)
    if override:
        candidates.append(resolve_command(override, which))

    candidates.append(Path(current_executable))

    for variable in ("VIRTUAL_ENV", "CONDA_PREFIX"):
        prefix = environ.get(variable)
        if prefix:
            candidates.extend(
                (
                    Path(prefix) / "bin/python3",
                    Path(prefix) / "bin/python",
                    Path(prefix) / "Scripts/python.exe",
                )
            )

    roots = [cwd or Path.cwd()]
    if source is not None:
        roots.append(source.resolve().parent)
    for root in unique_paths(roots):
        for directory in (".venv", "venv"):
            candidates.extend(
                (
                    root / directory / "bin/python3",
                    root / directory / "bin/python",
                    root / directory / "Scripts/python.exe",
                )
            )

    for command in ("python3", "python"):
        resolved = which(command)
        if resolved:
            candidates.append(Path(resolved))

    return unique_paths(candidates)


def interpreter_has_playwright(python: Path) -> bool:
    if not python.is_file():
        return False
    try:
        result = subprocess.run(
            [str(python), "-c", PLAYWRIGHT_PROBE],
            capture_output=True,
            check=False,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def find_playwright_python(
    candidates: Sequence[Path],
    probe: Callable[[Path], bool] = interpreter_has_playwright,
) -> Path | None:
    return next((candidate for candidate in candidates if probe(candidate)), None)


def import_playwright_or_reexec(source: Path | None) -> None:
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401

        return
    except ImportError as error:
        import_error = error

    if os.environ.get(REEXEC_MARKER) != "1":
        candidates = python_candidates(source)
        discovered = find_playwright_python(candidates)
        if discovered is not None and discovered.absolute() != Path(sys.executable).absolute():
            environment = dict(os.environ)
            environment[REEXEC_MARKER] = "1"
            os.execve(
                str(discovered),
                [str(discovered), str(Path(__file__).resolve()), *sys.argv[1:]],
                environment,
            )

    raise DiscoveryError(
        "Python Playwright was not found in the active interpreter, project virtual "
        "environments, or PATH. Install it with:\n"
        f"  {sys.executable} -m pip install playwright\n"
        f"  {sys.executable} -m playwright install chromium"
    ) from import_error


def platform_browser_paths(
    *,
    platform_name: str = sys.platform,
    environ: Mapping[str, str] = os.environ,
    home: Path | None = None,
) -> list[Path]:
    user_home = home or Path.home()
    if platform_name == "darwin":
        application_roots = (Path("/Applications"), user_home / "Applications")
        relative_paths = (
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "Chromium.app/Contents/MacOS/Chromium",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        )
        return [root / relative for root in application_roots for relative in relative_paths]

    if platform_name.startswith("win"):
        roots = [
            Path(value)
            for variable in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)")
            if (value := environ.get(variable))
        ]
        relative_paths = (
            "Google/Chrome/Application/chrome.exe",
            "Chromium/Application/chrome.exe",
            "Microsoft/Edge/Application/msedge.exe",
        )
        return [root / relative for root in roots for relative in relative_paths]

    return [
        Path("/usr/bin/chromium"),
        Path("/usr/bin/chromium-browser"),
        Path("/usr/bin/google-chrome"),
        Path("/usr/bin/google-chrome-stable"),
        Path("/usr/bin/microsoft-edge"),
        Path("/snap/bin/chromium"),
    ]


def system_browser_candidates(
    *,
    environ: Mapping[str, str] = os.environ,
    which: Callable[[str], str | None] = shutil.which,
    platform_name: str = sys.platform,
    home: Path | None = None,
) -> list[BrowserCandidate]:
    candidates: list[BrowserCandidate] = []
    override = environ.get(BROWSER_OVERRIDE)
    if override:
        candidates.append(
            BrowserCandidate(
                f"{BROWSER_OVERRIDE} override",
                resolve_command(override, which),
            )
        )

    paths: list[Path] = []
    for command in BROWSER_COMMANDS:
        resolved = which(command)
        if resolved:
            paths.append(Path(resolved))
    paths.extend(
        platform_browser_paths(
            platform_name=platform_name,
            environ=environ,
            home=home,
        )
    )

    existing_labels = {
        str(candidate.executable.expanduser().absolute())
        for candidate in candidates
        if candidate.executable is not None
    }
    for path in unique_paths(paths):
        key = str(path.expanduser().absolute())
        if key not in existing_labels and path.is_file():
            candidates.append(BrowserCandidate(path.name, path))
            existing_labels.add(key)
    return candidates


def launch_browser(playwright, candidates: Sequence[BrowserCandidate] | None = None):
    """Launch managed Chromium, then explicit and discovered system browsers."""
    attempts: list[str] = []
    managed_path = Path(playwright.chromium.executable_path)
    if managed_path.is_file():
        try:
            return playwright.chromium.launch(), f"Playwright Chromium ({managed_path})"
        except Exception as error:  # Playwright exposes runtime-specific subclasses.
            attempts.append(f"Playwright Chromium: {error}")
    else:
        attempts.append(f"Playwright Chromium not found at {managed_path}")

    resolved_candidates = (
        list(candidates) if candidates is not None else system_browser_candidates()
    )
    for candidate in resolved_candidates:
        executable = candidate.executable
        if executable is None or not executable.expanduser().is_file():
            attempts.append(f"{candidate.label}: executable not found at {executable}")
            continue
        try:
            browser = playwright.chromium.launch(executable_path=str(executable.expanduser()))
            return browser, f"{candidate.label} ({executable.expanduser()})"
        except Exception as error:  # Continue to the next installed Chromium-family browser.
            attempts.append(f"{candidate.label}: {error}")

    detail = "\n  - ".join(attempts) if attempts else "No browser candidates were found."
    raise DiscoveryError(
        "Playwright is installed, but no usable Chromium-family browser was found. "
        f"Discovery attempts:\n  - {detail}\n"
        f"Install the managed browser with:\n  {sys.executable} -m playwright install chromium\n"
        f"Or set {BROWSER_OVERRIDE} to a Chrome, Chromium, or Edge executable."
    )


def scale_value(value: str) -> float:
    try:
        scale = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("scale must be a number from 1 through 4") from error
    if not 1 <= scale <= 4:
        raise argparse.ArgumentTypeError("scale must be from 1 through 4")
    return scale


def viewbox_dimensions(value: str | None) -> tuple[float, float]:
    if value is None:
        raise DiscoveryError("SVG diagram has no viewBox; refusing to guess export dimensions.")
    try:
        parts = [float(part) for part in value.replace(",", " ").split()]
    except ValueError as error:
        raise DiscoveryError(f"SVG diagram has an invalid viewBox: {value}") from error
    if len(parts) != 4:
        raise DiscoveryError(f"SVG diagram has an invalid viewBox: {value}")
    width, height = parts[2], parts[3]
    if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
        raise DiscoveryError(f"SVG diagram has an invalid viewBox: {value}")
    return width, height


def size_svg_for_export(page, diagram) -> tuple[float, float]:
    width, height = viewbox_dimensions(diagram.get_attribute("viewBox"))
    diagram.evaluate(
        """(svg, size) => {
            document.body.replaceChildren(svg);
            document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden';
            document.body.style.cssText = 'margin:0;padding:0;overflow:hidden';
            svg.style.setProperty('display', 'block', 'important');
            svg.style.setProperty('width', `${size.width}px`, 'important');
            svg.style.setProperty('height', `${size.height}px`, 'important');
            svg.style.setProperty('min-width', '0', 'important');
            svg.style.setProperty('max-width', 'none', 'important');
        }""",
        {"width": width, "height": height},
    )
    page.set_viewport_size({"width": math.ceil(width), "height": math.ceil(height)})
    return width, height


def render_png(source: Path, output: Path, scale: float) -> tuple[str, str]:
    from playwright.sync_api import sync_playwright

    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    if not source.is_file():
        raise DiscoveryError(f"Source HTML file not found: {source}")
    if source.name == "index.html" and source.parent.name == "assets":
        raise DiscoveryError("Refusing to export the multi-diagram assets/index.html gallery.")

    output.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser, browser_description = launch_browser(playwright)
        try:
            page = browser.new_page(device_scale_factor=scale)
            page.goto(f"{source.as_uri()}?motion=static", wait_until="networkidle")
            page.evaluate("document.fonts.ready")

            motion_root = page.locator("[data-motion-root]").first
            if motion_root.count() and motion_root.get_attribute("data-frame") != "static":
                raise DiscoveryError("Motion diagram did not resolve to its static export frame.")

            diagram = page.locator("svg").first
            if not diagram.count():
                raise DiscoveryError(f"No SVG diagram found in {source}")
            width, height = size_svg_for_export(page, diagram)
            bounding_box = diagram.bounding_box()
            if bounding_box is None:
                raise DiscoveryError("SVG diagram has no rendered bounding box.")
            if abs(bounding_box["width"] - width) > 0.01 or abs(
                bounding_box["height"] - height
            ) > 0.01:
                raise DiscoveryError(
                    "SVG diagram did not resolve to its viewBox dimensions before capture."
                )
            page.screenshot(
                path=str(output),
                omit_background=True,
                clip={"x": 0, "y": 0, "width": width, "height": height},
            )
            return browser_description, browser.version
        finally:
            browser.close()


def check_environment() -> tuple[str, str]:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser, browser_description = launch_browser(playwright)
        try:
            return browser_description, browser.version
        finally:
            browser.close()


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(
        description=(
            "Export a Diagram Design HTML file to PNG using discovered "
            "Playwright and Chromium."
        ),
    )
    argument_parser.add_argument("source", nargs="?", type=Path, help="source diagram HTML")
    argument_parser.add_argument("output", nargs="?", type=Path, help="output PNG path")
    argument_parser.add_argument("--scale", type=scale_value, default=2.0)
    argument_parser.add_argument(
        "--check",
        action="store_true",
        help="discover and launch a browser without exporting",
    )
    return argument_parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    if not arguments.check and arguments.source is None:
        parser().error("source is required unless --check is used")

    source = arguments.source.expanduser() if arguments.source is not None else None
    try:
        import_playwright_or_reexec(source)
        if arguments.check:
            browser_description, browser_version = check_environment()
            print(
                f"Playwright ready: python={sys.executable}; "
                f"browser={browser_description}; version={browser_version}"
            )
            return 0

        assert source is not None
        output = arguments.output or source.with_suffix(".png")
        browser_description, browser_version = render_png(source, output, arguments.scale)
        print(
            f"PNG written to {output.expanduser().resolve()} using "
            f"{browser_description}; version={browser_version}; scale={arguments.scale:g}"
        )
        return 0
    except DiscoveryError as error:
        print(f"export_png: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
