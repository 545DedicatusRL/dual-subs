# Testing

- **40 Node unit/regression tests pass** (1.2.0; the unused popup tests were removed and two regression tests added). Includes five automatic-start cases: opening/switching titles, healthy pages, install/restart recovery, unrelated/navigated-away tabs, and concurrent-event deduplication. The indicator preference has a saved-boolean/default regression case.
- **38 local browser fixture checks passed:** 18 subtitle-engine cases and 20 player-interface cases.
- Real pointer movement from CC² into the frame kept the panel open; leaving the panel closed it. The relocated windowed button and its close button also accepted real pointer input. The C shortcut and advanced settings are covered by the browser fixture checks.
- Live signed-in Netflix playback was not tested. Fullscreen container transitions are simulated in the fixture; these results do not establish compatibility with every live Netflix layout or ad-supported playback timeline.

## Run

With Node.js 20 or later:

```sh
npm test
PORT=18768 npm run test:browser
```

Open the printed `/watch/123` URL. The real packaged content scripts and settings page run against local Netflix and Chrome fixtures. A fixture-only bridge replaces worker messaging for the iframe; the worker's routing and startup events are tested separately in Node.

## Player regressions

The fixture verifies a clipped native CC wrapper and direct-button siblings; a minimum 52 px target to the left of CC; matching native SVG size and vertical centre; asymmetric SVG padding; ² inside the bubble; hit testing above player overlays; a clickable isolated settings frame; all settings and language selection; keyboard close/open; rerender recovery; native control visibility; fullscreen containment; optional, non-interactive fullscreen indicator; C toggling with typing/modifier/repeat exclusions; hover open/keep/close; a usable clock anchor while windowed native CC rerenders; and viewport positioning after scrolling.

The original subtitle cases cover TTML/VTT parsing, Unicode entities, Netflix track discovery and capture/restore, independent native-size rendering, no background, timing matching and delay, seeking, native fallback, disabled/off states, and episode navigation.

## Windowed placement regression

Checks verify an 8 px gap above the remaining time, horizontal centering, an uncovered clock hit target, no native CC row spacer, following a moved clock, recovery after clock classes change, and a usable clock-anchored button while native CC rerenders. Fullscreen icon placement and alignment checks run before returning to windowed mode.
