"use client";

import { useEffect, useRef, useState } from "react";
import { AsciiBackdrop } from "@/components/AsciiBackdrop";
import { EmptySidePanel } from "@/components/EmptySidePanel";
import { NoteEditor } from "@/components/NoteEditor";
import { PixelLoader } from "@/components/PixelLoader";
import { StatusLine, type SessionStats } from "@/components/StatusLine";
import { AutocompleteController } from "@/lib/autocomplete";
import { BootProgressMixer } from "@/lib/boot-progress";
import {
  createRequestId,
  InferenceClient,
} from "@/lib/inference-client";
import { MODEL_ID } from "@/lib/model-config";
import {
  createEmptyNote,
  listNotes,
  loadNoteStore,
  removeNote,
  saveNoteStore,
  withAutoTitle,
  upsertNote,
} from "@/lib/note-store";
import type { VisualizationEvent } from "@/lib/visualization-events";
import { checkWebGPUSupport } from "@/lib/webgpu-support";
import type { ModelState, WorkerResponse } from "@/types/inference";
import type { Note, NotePhase } from "@/types/notes";

function classifyLoadPhase(text: string, progress: number): ModelState {
  const lower = text.toLowerCase();
  if (
    lower.includes("compil") ||
    lower.includes("shader") ||
    lower.includes("pipeline")
  ) {
    return "compiling";
  }
  if (progress > 0 && progress < 1) return "downloading";
  if (
    lower.includes("load") ||
    lower.includes("fetch") ||
    lower.includes("download")
  ) {
    return "downloading";
  }
  return progress >= 1 ? "compiling" : "downloading";
}

function newId(prefix: string): string {
  return `${prefix}_${createRequestId()}`;
}

const MIN_BOOT_MS = 2000;

function emptyBootstrap(): {
  note: Note;
  past: Note[];
  caret: number;
} {
  return {
    note: createEmptyNote(newId("note")),
    past: [],
    caret: 0,
  };
}

const EMPTY_STATS: SessionStats = {
  offered: 0,
  accepted: 0,
  dismissed: 0,
};

export function AppShell() {
  const [boot] = useState(emptyBootstrap);
  const clientRef = useRef<InferenceClient | null>(null);
  const autocompleteRef = useRef<AutocompleteController | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const noteRef = useRef<Note>(boot.note);
  const caretRef = useRef(boot.caret);
  const suggestionRef = useRef("");
  const bootMixerRef = useRef(new BootProgressMixer(MIN_BOOT_MS));
  const bootRafRef = useRef(0);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesHydratedRef = useRef(false);
  const countedOfferRef = useRef(false);

  const [modelState, setModelState] = useState<ModelState>("checking-webgpu");
  const [displayProgress, setDisplayProgress] = useState(0.02);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [note, setNote] = useState<Note>(boot.note);
  const [caret, setCaret] = useState(boot.caret);
  const [suggestion, setSuggestion] = useState("");
  const [phase, setPhase] = useState<NotePhase>("idle");
  const [vizEvents, setVizEvents] = useState<VisualizationEvent[]>([]);
  const [pulseKey, setPulseKey] = useState("");
  const [past, setPast] = useState<Note[]>(boot.past);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);

  const ready =
    modelState === "ready" ||
    modelState === "generating" ||
    modelState === "cancelled";
  const booting =
    !ready && modelState !== "unsupported" && modelState !== "error";
  const noteEmpty = note.body.trim().length === 0;

  const persistNote = (next: Note) => {
    const store = loadNoteStore();
    if (!next.body.trim()) {
      // Empty drafts never stay in history.
      const saved = removeNote(store, next.id);
      saveNoteStore({ ...saved, activeId: null });
      setPast(listNotes(saved));
      return;
    }
    const saved = upsertNote(store, {
      ...next,
      updatedAt: Date.now(),
    });
    saveNoteStore(saved);
    setPast(listNotes(saved).filter((n) => n.id !== next.id));
  };

  const flushPersist = () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    persistNote(noteRef.current);
  };

  const schedulePersist = (next: Note) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistNote(next);
    }, 400);
  };

  const patchNote = (updater: (prev: Note) => Note) => {
    setNote((prev) => {
      const next = updater(prev);
      noteRef.current = next;
      schedulePersist(next);
      return next;
    });
  };

  const handleOpenPast = (id: string) => {
    flushPersist();
    const store = loadNoteStore();
    const found = store.notes.find((n) => n.id === id);
    if (!found) return;
    autocompleteRef.current?.cancel();
    setSuggestion("");
    suggestionRef.current = "";
    noteRef.current = found;
    caretRef.current = found.body.length;
    setCaret(found.body.length);
    setNote(found);
    setPhase("idle");
    countedOfferRef.current = false;
    setVizEvents([{ type: "reset", at: performance.now() }]);
    saveNoteStore({ ...store, activeId: found.id });
    setPast(listNotes(store).filter((n) => n.id !== found.id));
  };

  const startModelLoad = () => {
    bootMixerRef.current.reset(MIN_BOOT_MS);
    setDisplayProgress(0.02);
    setModelState("downloading");
    setErrorMessage(null);
    clientRef.current?.initialize(MODEL_ID);
  };

  useEffect(() => {
    if (!booting) return;

    const tick = () => {
      const snap = bootMixerRef.current.tick();
      setDisplayProgress(snap.display);
      if (snap.revealReady) {
        setModelState("ready");
        return;
      }
      bootRafRef.current = requestAnimationFrame(tick);
    };

    bootRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(bootRafRef.current);
    };
  }, [booting]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const controller = new AutocompleteController({
      onSuggestion: (text) => {
        if (text && !countedOfferRef.current) {
          countedOfferRef.current = true;
          setStats((prev) => ({ ...prev, offered: prev.offered + 1 }));
        }
        if (!text) countedOfferRef.current = false;
        suggestionRef.current = text;
        setSuggestion(text);
      },
      onPhase: (next) => setPhase(next),
      onError: (message) => setErrorMessage(message),
    });
    autocompleteRef.current = controller;
    return () => {
      controller.cancel();
      autocompleteRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const client = new InferenceClient();
    clientRef.current = client;

    const handleWorkerMessage = (message: WorkerResponse) => {
      switch (message.type) {
        case "load-progress":
          setModelState(classifyLoadPhase(message.text, message.progress));
          bootMixerRef.current.setReal(message.progress);
          setErrorMessage(null);
          break;
        case "ready": {
          bootMixerRef.current.markEngineReady();
          setErrorMessage(null);
          break;
        }
        case "generation-start":
          activeRequestRef.current = message.requestId;
          setModelState("generating");
          setPulseKey(`${message.requestId}::start::${Date.now()}`);
          setVizEvents((prev) => [
            ...prev,
            {
              type: "generation-start",
              requestId: message.requestId,
              at: performance.now(),
            },
          ]);
          break;
        case "text-delta":
          if (activeRequestRef.current !== message.requestId) break;
          setPulseKey(
            `${message.requestId}::${message.deltaIndex}::${Date.now()}`,
          );
          setVizEvents((prev) => [
            ...prev,
            {
              type: "text-delta",
              requestId: message.requestId,
              text: message.text,
              deltaIndex: message.deltaIndex,
              contextLength: noteRef.current.body.length,
              at: performance.now(),
            },
          ]);
          break;
        case "generation-complete":
          if (activeRequestRef.current === message.requestId) {
            activeRequestRef.current = null;
          }
          setModelState("ready");
          setVizEvents((prev) => [
            ...prev,
            {
              type: "generation-complete",
              requestId: message.requestId,
              at: performance.now(),
            },
          ]);
          break;
        case "generation-cancelled":
          if (activeRequestRef.current === message.requestId) {
            activeRequestRef.current = null;
          }
          setModelState("cancelled");
          setVizEvents((prev) => [
            ...prev,
            {
              type: "generation-cancelled",
              requestId: message.requestId,
              at: performance.now(),
            },
          ]);
          break;
        case "error":
          activeRequestRef.current = null;
          setModelState((prev) => {
            if (
              prev === "generating" ||
              prev === "ready" ||
              prev === "cancelled"
            ) {
              return "ready";
            }
            return "error";
          });
          setErrorMessage(message.message);
          break;
        default: {
          const _exhaustive: never = message;
          void _exhaustive;
        }
      }
    };

    void (async () => {
      if (!notesHydratedRef.current) {
        notesHydratedRef.current = true;
        // Always open on an empty draft; history is available in the empty state.
        const store = loadNoteStore();
        if (store.activeId !== null) {
          saveNoteStore({ ...store, activeId: null });
        }
        setPast(listNotes(store));
      }

      setModelState("checking-webgpu");
      const support = await checkWebGPUSupport();
      if (cancelled) return;

      if (!support.supported) {
        setModelState("unsupported");
        setErrorMessage(support.reason ?? "no webgpu");
        return;
      }

      client.start({
        onMessage: handleWorkerMessage,
        onWorkerError: (error) => {
          setModelState("error");
          setErrorMessage(error.message);
        },
      });
      autocompleteRef.current?.setClient(client);

      startModelLoad();
    })();

    return () => {
      cancelled = true;
      autocompleteRef.current?.setClient(null);
      client.stop();
      clientRef.current = null;
      cancelAnimationFrame(bootRafRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  const handleBodyChange = (body: string, nextCaret: number) => {
    caretRef.current = nextCaret;
    setCaret(nextCaret);
    patchNote((prev) => withAutoTitle(prev, body));
    if (!ready) return;
    autocompleteRef.current?.setClient(clientRef.current);
    autocompleteRef.current?.schedule(body, nextCaret);
  };

  const handleTitleChange = (title: string) => {
    patchNote((prev) => ({
      ...prev,
      title,
      titleManual: true,
    }));
  };

  const handleTitleBlur = () => {
    patchNote((prev) => {
      const trimmed = prev.title.replace(/\s+/g, " ").trim();
      if (trimmed === prev.title) return prev;
      return { ...prev, title: trimmed || "untitled" };
    });
  };

  const handleCaretChange = (nextCaret: number) => {
    caretRef.current = nextCaret;
    setCaret(nextCaret);
    if (!ready) return;
    // Moving caret without editing: clear ghost if no longer at a trigger point.
    autocompleteRef.current?.setClient(clientRef.current);
    autocompleteRef.current?.schedule(noteRef.current.body, nextCaret);
  };

  const handleAcceptSuggestion = () => {
    const ghost = suggestionRef.current;
    if (!ghost) return;
    const at = caretRef.current;
    const body = noteRef.current.body;
    const next = body.slice(0, at) + ghost + body.slice(at);
    const nextCaret = at + ghost.length;
    caretRef.current = nextCaret;
    setCaret(nextCaret);
    countedOfferRef.current = false;
    setStats((prev) => ({ ...prev, accepted: prev.accepted + 1 }));
    autocompleteRef.current?.accept();
    patchNote((prev) => withAutoTitle(prev, next));
    // Place caret after insert; think loop re-aims at the new prefix.
    requestAnimationFrame(() => {
      const el = document.querySelector(
        ".note-editor__input",
      ) as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
      if (!ready) return;
      autocompleteRef.current?.setClient(clientRef.current);
      autocompleteRef.current?.schedule(next, nextCaret, 0);
    });
  };

  const handleDismissSuggestion = () => {
    if (!suggestionRef.current) return;
    countedOfferRef.current = false;
    setStats((prev) => ({ ...prev, dismissed: prev.dismissed + 1 }));
    // Hide ghost but keep the think loop running.
    autocompleteRef.current?.dismiss();
  };

  if (booting || modelState === "unsupported" || modelState === "error") {
    return (
      <main className="app app--boot">
        <PixelLoader
          label="loading…"
          progress={booting ? displayProgress : undefined}
          error={
            modelState === "unsupported" || modelState === "error"
              ? (errorMessage ?? "failed")
              : null
          }
          onRetry={modelState === "error" ? startModelLoad : undefined}
        />
      </main>
    );
  }

  return (
    <main className="app app--live">
      <div className="session session--notes">
        <NoteEditor
          note={note}
          caret={caret}
          suggestion={suggestion}
          disabled={false}
          onBodyChange={handleBodyChange}
          onTitleChange={handleTitleChange}
          onTitleBlur={handleTitleBlur}
          onCaretChange={handleCaretChange}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
        />
        <StatusLine phase={phase} stats={stats} />
      </div>

      <aside
        className="viz-pane"
        aria-label={noteEmpty ? "welcome" : "visualization"}
      >
        {noteEmpty ? (
          <EmptySidePanel past={past} onOpenPast={handleOpenPast} />
        ) : (
          <AsciiBackdrop
            events={vizEvents}
            pulseKey={pulseKey}
            reducedMotion={reducedMotion}
          />
        )}
      </aside>

      {errorMessage ? (
        <p className="app__toast" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </main>
  );
}
