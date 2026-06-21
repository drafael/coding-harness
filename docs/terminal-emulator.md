# Terminal emulator

Use a modern terminal emulator, such as:

- [WezTerm](https://wezterm.org/) (cross-platform) - Highly configurable terminal with strong font, tab, pane, and GPU rendering support.
- [Alacritty](https://alacritty.org) (cross-platform) - Minimal, fast GPU-accelerated terminal focused on performance.
- [Ghostty](https://ghostty.org/) (Linux and macOS) - Modern native terminal with sensible defaults and good performance.
- [Kitty](https://sw.kovidgoyal.net/kitty/) (Linux and macOS) - Feature-rich GPU terminal with tabs, splits, images, and extensive customization.
- [Warp](https://warp.dev/) (macOS) - AI-assisted terminal with command blocks, history, and collaboration features.
- PowerShell v6+ (Windows) - Cross-platform shell and terminal experience commonly available on Windows.

## Configuration examples

These examples are based on the Ghostty, Kitty, and WezTerm templates from the public [`drafael/dotfiles`](https://github.com/drafael/dotfiles) repository. They focus on settings that work well with coding agents: large scrollback, clipboard access, shell integration, split resizing, and `Shift+Enter` for inserting a newline.

| Terminal | Platforms | Common config path |
| --- | --- | --- |
| Ghostty | Linux, macOS | `~/.config/ghostty/config` |
| Kitty | Linux, macOS | `~/.config/kitty/kitty.conf` |
| WezTerm | Linux, macOS, Windows | `~/.config/wezterm/wezterm.lua` or `~/.wezterm.lua` |

The snippets use macOS-style `cmd`/`CMD` key bindings from the templates. On Linux or Windows, replace those modifiers with your preferred `ctrl`, `alt`, or `super` bindings.

### Ghostty

```ini
theme = dark:Catppuccin Frappe,light:Catppuccin Latte
window-theme = dark

window-width = 208
window-height = 50
window-padding-x = 4
window-padding-y = 4
window-save-state = always
window-inherit-working-directory = true

background-opacity = 0.96
background-blur = 8

font-family = Monaco
font-size = 14

cursor-style = block
cursor-style-blink = false
copy-on-select = clipboard
clipboard-read = allow
clipboard-write = allow

keybind = shift+enter=text:\n
keybind = cmd+ctrl+h=resize_split:left,40
keybind = cmd+ctrl+l=resize_split:right,40
keybind = cmd+ctrl+k=resize_split:up,20
keybind = cmd+ctrl+j=resize_split:down,20

shell-integration = detect
shell-integration-features = no-cursor,sudo,title
term = xterm-256color
scrollback-limit = 100000
```

### Kitty

```conf
font_family      Monaco
font_size        14.0

initial_window_width  208c
initial_window_height 50c
window_padding_width  4
remember_window_size  yes

background_opacity 0.96
background_blur    8

cursor_shape          block
cursor_blink_interval 0
copy_on_select        clipboard
clipboard_control     write-clipboard read-clipboard write-primary read-primary

shell_integration enabled no-cursor
term              xterm-256color
scrollback_lines  100000

map shift+enter send_text all \n
enabled_layouts splits:split_axis=horizontal
map cmd+d       launch --location=vsplit --cwd=current
map cmd+shift+d launch --location=hsplit --cwd=current
map cmd+w       close_window

map cmd+ctrl+h     resize_window narrower 40
map cmd+ctrl+l     resize_window wider 40
map cmd+ctrl+k     resize_window taller 20
map cmd+ctrl+j     resize_window shorter 20
map cmd+alt+left   neighboring_window left
map cmd+alt+right  neighboring_window right
map cmd+alt+up     neighboring_window up
map cmd+alt+down   neighboring_window down
```

### WezTerm

```lua
local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder and wezterm.config_builder() or {}

config.color_scheme = "Catppuccin Frappe"
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"
config.window_background_opacity = 0.95
config.macos_window_background_blur = 20
config.initial_cols = 208
config.initial_rows = 54

config.font = wezterm.font("Monaco")
config.font_size = 13.0

config.window_padding = {
  left = 10,
  right = 10,
  top = 10,
  bottom = 10,
}

config.enable_tab_bar = true
config.hide_tab_bar_if_only_one_tab = false
config.enable_scroll_bar = false
config.window_close_confirmation = "NeverPrompt"

config.inactive_pane_hsb = {
  saturation = 1.0,
  brightness = 1.0,
}

config.keys = {
  { key = "Enter", mods = "SHIFT", action = act.SendString("\n") },

  { key = "d", mods = "CMD", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
  { key = "d", mods = "CMD|SHIFT", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
  { key = "w", mods = "CMD", action = act.CloseCurrentPane({ confirm = false }) },

  { key = "LeftArrow", mods = "CMD|ALT", action = act.ActivatePaneDirection("Left") },
  { key = "RightArrow", mods = "CMD|ALT", action = act.ActivatePaneDirection("Right") },
  { key = "UpArrow", mods = "CMD|ALT", action = act.ActivatePaneDirection("Up") },
  { key = "DownArrow", mods = "CMD|ALT", action = act.ActivatePaneDirection("Down") },

  { key = "h", mods = "CMD|CTRL", action = act.AdjustPaneSize({ "Left", 5 }) },
  { key = "l", mods = "CMD|CTRL", action = act.AdjustPaneSize({ "Right", 5 }) },
  { key = "k", mods = "CMD|CTRL", action = act.AdjustPaneSize({ "Up", 3 }) },
  { key = "j", mods = "CMD|CTRL", action = act.AdjustPaneSize({ "Down", 3 }) },
}

return config
```
