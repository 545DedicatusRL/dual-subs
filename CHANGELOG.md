# Changelog

## 1.2.0


**Reliability (the "sometimes needs a refresh" problem)**
- **Preview trailers no longer evict the title you play.** Netflix loads a manifest for every hover trailer and billboard on the browse page. The extension kept subtitle URLs for only 4 titles, so after browsing, the title you started often had no subtitle files until a page refresh. It now keeps 60 titles in least-recently-used order.
- **No duplicate languages.** The player's track list and the manifest can use different IDs for the same language. Those used to show as two entries, and the one without file URLs could be picked, which triggered the slow "switch Netflix's subtitle and back" fallback. They are now merged into one entry.
- **Automatic recovery.** Transient load failures retry 3 times (1.5 s, 4 s, 10 s). A load also restarts on its own once Netflix exposes the subtitle files late. Unreadable image-only tracks still fail right away.
- **Self-healing connection.** A periodic handshake recovers state messages lost while Netflix rebuilds its player.
- **Clean extension updates.** After a reload or update, the old orphaned scripts detect this, remove their overlay and buttons, and stop, so no duplicate CC² buttons or dead overlays remain.
- **Less main-thread work.** The clock lookup is cached instead of rescanning the whole player 7× a second. Native subtitle font sampling runs about 3× a second instead of 30. The settings panel stops polling while it's closed.

**Design**
- A redesigned settings panel with a live preview of both subtitle lines, a status pill (green ready / amber loading / red error), toggle switches, filled sliders, color swatches, and a collapsible "More settings".
- The CC² button shows a red underline when dual subtitles are on and dims when they are off.
- Removed the unused 1.0.x toolbar popup code.

## 1.1.3

Windowed CC² button above the remaining time, hover-to-open settings panel, C shortcut, fullscreen indicator, automatic script recovery in open tabs.
