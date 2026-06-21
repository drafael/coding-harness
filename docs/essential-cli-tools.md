# Essential CLI tools

Install the command-line tools commonly used by AI coding agents.

## Core tools

- [Git](https://git-scm.com/) - Version control used by agents to inspect diffs, branches, and change history.
- [`node`/`npm`](https://nodejs.org/) - JavaScript runtime and package manager used by many agent tools and plugins.
- [ripgrep (`rg`)](https://github.com/BurntSushi/ripgrep#ripgrep-rg) - Fast code/text search across project files.
- [`fd`](https://github.com/sharkdp/fd#fd) - Fast, user-friendly alternative to `find` for locating files.
- [`jq`](https://github.com/jqlang/jq#jq) - Command-line JSON processor for reading and transforming API/tool output.
- [`curl`](https://curl.se/) - Fetches URLs and API responses from the command line.

## Useful additions

- [`yq`](https://github.com/mikefarah/yq) - Like `jq`, but for YAML, TOML, XML, and properties files.
- [`tree`](https://oldmanprogrammer.net/source.php?dir=projects/tree) - Prints compact directory trees for quick project overviews.
- [`unzip`](https://infozip.sourceforge.net/UnZip.html) - Extracts archives downloaded by tools, plugins, or model-generated commands.

## Windows notes

For Windows, prefer one of these setups:

1. **WSL2** for Unix-first agents and projects. Keep repositories inside the Linux filesystem, for example `~/code/project`, instead of `/mnt/c/...`.
2. **Native Windows** for agents that explicitly support it. Use PowerShell 7+, Git for Windows, and a package manager such as `winget`, Scoop, or Chocolatey.

Common workarounds:

- Install Unix-style shell tools via WSL2, Git Bash, or MSYS2 if an agent or script expects `bash`, `sed`, `grep`, `find`, or `xargs`.
- Configure Git in the environment where you work. Avoid mixing Windows Git and WSL Git on the same checkout.
- If native Windows paths get too long, enable long paths in Git:

  ```powershell
  git config --global core.longpaths true
  ```

- If `npm install` fails while compiling native modules, install Python and Visual Studio Build Tools, or rerun the official Node.js installer with its native build tools option.

Example native Windows install with `winget`:

```powershell
winget install Git.Git OpenJS.NodeJS BurntSushi.ripgrep.MSVC sharkdp.fd jqlang.jq
```
