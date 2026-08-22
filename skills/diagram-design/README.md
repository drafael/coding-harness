# Diagram Design Skill

## Description

Creates editorial technical and product diagrams as standalone HTML with inline SVG and CSS. It supports branded architecture diagrams, flowcharts, sequence diagrams, data models, timelines, charts, and other structured visual formats. It can also redraw Mermaid and draw.io sources for a specific audience, size, and level of detail.

## Usage examples

- "Create an editorial architecture diagram of this service as standalone HTML."
- "Redraw this Mermaid sequence diagram for a 16:9 engineering presentation."
- "Create a branded database schema diagram using my saved client profile."
- "Turn this draw.io system map into a simplified executive diagram."

For Mermaid-as-code, themed Mermaid rendering, ASCII output, or batch rendering, use [`pretty-mermaid`](../pretty-mermaid/) instead.

## Installation scope

This directory vendors the upstream `skills/diagram-design/` subtree plus the local patch documented below. It does not include the upstream Pi prompt templates, so `/export-diagram`, `/import-mermaid`, `/profile`, and `/doctor` are not installed as standalone commands. Invoke `/skill:diagram-design` and request those workflows in natural language instead.

Keep the committed vendor snapshot unchanged. Store custom styles in `~/.diagram-design/profiles/` and select a profile from a project-level `.diagram-design` marker as described in [`references/profiles.md`](references/profiles.md).

Upstream onboarding temporarily writes `references/style-guide.md` before saving a profile. After onboarding saves the profile and adds the project marker, restore the committed working copy from the `coding-harness` repository root:

```bash
git restore --source=HEAD -- skills/diagram-design/references/style-guide.md
git status --short -- skills/diagram-design
```

The status command should produce no output. The project marker then reads the saved profile directly without modifying the installed working copy.

## Origin

- Upstream skill: [`skills/diagram-design/`](https://github.com/cathrynlavery/diagram-design/tree/main/skills/diagram-design)
- Upstream repository: [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
- Live gallery: [cathrynlavery.github.io/diagram-design](https://cathrynlavery.github.io/diagram-design/)
- Vendored upstream commit: [`648c2a597839301e06df1e7434a08bde9f42eed3`](https://github.com/cathrynlavery/diagram-design/commit/648c2a597839301e06df1e7434a08bde9f42eed3)

## Credits

- Original author and maintainer: **Cathryn Lavery**
- Local packaging and documentation: `coding-harness`

## License

The upstream skill is distributed under the MIT License. See [`LICENSE`](LICENSE) for the retained notice and [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) for bundled asset attribution.

## Local patch

[`local-patches/playwright-chromium-discovery.patch`](local-patches/playwright-chromium-discovery.patch) adds a packaged PNG exporter that discovers:

1. Python Playwright in the active interpreter, project virtual environments, or another Python on `PATH`.
2. Playwright-managed Chromium.
3. A browser named by `DIAGRAM_DESIGN_CHROMIUM`.
4. Chrome, Chromium, or Edge in standard system locations.

The exporter never installs packages or downloads browsers. Run its unit tests with:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_export_png.py
```

## Update from upstream

Updates are manual so each upstream change can be reviewed. From the `coding-harness` repository root, run:

```bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
target="$repo_root/skills/diagram-design"
if [ -n "$(git -C "$repo_root" status --porcelain -- skills/diagram-design)" ]; then
  echo "Commit or restore local diagram-design changes before updating." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone --depth 1 --filter=blob:none --sparse \
  --branch main --single-branch \
  https://github.com/cathrynlavery/diagram-design.git \
  "$tmp/upstream"
git -C "$tmp/upstream" sparse-checkout set skills/diagram-design

rsync -a --delete \
  --exclude README.md \
  --exclude LICENSE \
  --exclude THIRD_PARTY_LICENSES.md \
  --exclude local-patches/ \
  "$tmp/upstream/skills/diagram-design/" \
  "$target/"
cp "$tmp/upstream/LICENSE" "$target/LICENSE"
cp "$tmp/upstream/THIRD_PARTY_LICENSES.md" "$target/THIRD_PARTY_LICENSES.md"

rsync -ainc --delete \
  --exclude README.md \
  --exclude LICENSE \
  --exclude THIRD_PARTY_LICENSES.md \
  --exclude local-patches/ \
  "$tmp/upstream/skills/diagram-design/" \
  "$target/"

git -C "$repo_root" apply --check \
  "$target/local-patches/playwright-chromium-discovery.patch"
git -C "$repo_root" apply \
  "$target/local-patches/playwright-chromium-discovery.patch"

PYTHONDONTWRITEBYTECODE=1 python3 "$target/scripts/test_export_png.py"
python3 "$target/scripts/self_check.py" \
  "$target/assets/example-flowchart.html"
printf '%s\n' 'flowchart LR' '    A[Start] --> B[End]' \
  > "$tmp/sample.mmd"
python3 "$target/scripts/mermaid_extract.py" "$tmp/sample.mmd"
python3 "$target/scripts/drawio_extract.py" --help >/dev/null

git -C "$tmp/upstream" rev-parse HEAD
```

The checksum-mode `rsync` command should produce no output, the local patch must apply cleanly, and the discovery tests and smoke checks should pass. If `git apply --check` fails, restore the committed snapshot and rebase the local patch against the new upstream commit; do not force-apply it.

Replace the vendored commit in this README with the printed commit hash, then inspect the update:

```bash
git diff --check
git diff -- skills/diagram-design
```

If the update should not be retained, restore the previously committed snapshot:

```bash
git restore --source=HEAD -- skills/diagram-design
```
