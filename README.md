# SmolNotes

A small notepad with a small language model inside it.

SmolNotes offers short continuations as you write. The model runs in your
browser, so there is no account, API key, or server receiving your notes. The
project is an exploration of local writing and generative motion: the model's
suggestions shape the words on one side, while the same generation events set
an ASCII field in motion on the other. It is not a scientific readout, just a
visual companion to the writing.

[Try SmolNotes](https://smol-notes.jasonxuyang.com)

![SmolNotes demo](assets/demo.gif)

## Writing with it

Start typing and pause briefly at the end of a line. A suggestion will appear
as ghost text:

- **Tab** keeps it
- **Esc** lets it go
- Continuing to type replaces it with your own words

Suggestions are deliberately short: usually a word or phrase rather than a
finished thought. The model is small, local, and sometimes odd. That is part of
the experiment—it can give you a nudge without trying to take over the page.

Notes are saved in your browser's `localStorage`, with the 10 most recent
available from the opening screen. Nothing is synced between devices.

## What is happening locally

On the first visit, SmolNotes downloads a quantized SmolLM2 360M model and
caches it in the browser. [WebLLM](https://github.com/mlc-ai/web-llm) runs the
model with WebGPU inside a Web Worker, keeping inference away from the main UI
thread.

As you type, the editor sends the text before your cursor to the worker. Tokens
stream back into the ghost-text layer, while generation events feed the ASCII
animation on the right.

```text
editor + ghost text                    Web Worker
──────────────────                    ──────────
note context ─────── postMessage ───▶ WebLLM / WebGPU
ghost suggestion ◀── token stream ─── SmolLM2 360M
ASCII field ◀──────── generation events
```

The ASCII field responds to starts, token deltas, completions, and
cancellations. It is an interpretation of the process, not a visualization of
attention, activations, or the model's inner reasoning.
