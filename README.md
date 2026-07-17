# SmolNotes

Local autocomplete notepad in the browser.

Write on the left. An interpretive ASCII field on the right. Inference runs entirely in your tab via WebGPU — no server, no API key, nothing leaves the machine.

Pause while typing for a ghost suggestion. **Tab** accepts, **Esc** dismisses.

[github.com/jasonxuyang/smol-notes](https://github.com/jasonxuyang/smol-notes)

## Features

- Local streaming autocomplete with [WebLLM](https://github.com/mlc-ai/web-llm) / WebGPU
- Copilot-style ghost text at the caret
- Live ASCII visualization driven by generation events
- Last 10 notes cached in `localStorage`
- Session stats: suggestions offered / accepted / dismissed
- Auto-loads `SmolLM2-360M` for a light first run

## Requirements

- Desktop **Chrome** or **Edge** with WebGPU enabled
- Hardware acceleration on
- A few hundred MB free for the first model download (then cached)

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), wait for the boot screen, then type.

```bash
pnpm build   # production build
pnpm start   # serve production build
pnpm lint    # eslint
```

## How it works

```text
React UI                         Web Worker
─────────────────────            ────────────────────────
note editor + ghost text         CreateMLCEngine / WebLLM
autocomplete debounce            download · compile · decode
localStorage notes                     │
     │                                 │
     └──── postMessage ────────────────┘
           initialize / generate / cancel
           load-progress / ready / text-delta
```

| Path | Role |
| --- | --- |
| `components/AppShell.tsx` | Boot, notes, inference wiring |
| `components/NoteEditor.tsx` | Note textarea + ghost overlay |
| `components/EmptySidePanel.tsx` | Right-pane blurb + recent notes when empty |
| `lib/autocomplete.ts` | Debounce, pack, short continuation |
| `lib/note-store.ts` | Note persistence |
| `lib/ascii-terminal-viz.ts` | Event-driven ASCII field |
| `lib/model-config.ts` | Model IDs |
| `workers/llm.worker.ts` | WebLLM engine + text-completion streaming |

The app loads a single model (`MODEL_ID` in `lib/model-config.ts`: SmolLM2 360M).

## Notes

- First visit downloads model weights. Keep the tab open until ready.
- Viz is interpretive — not attention maps or real activations.
- Autocomplete only fires at the end of a non-empty line after a short pause.
- OS `prefers-reduced-motion` is respected by the ASCII field.
- COOP / COEP headers are set for cross-origin isolation WebLLM may need.

## License

MIT — see [LICENSE](./LICENSE).
