import type { Note } from "@/types/notes";

const STORAGE_KEY = "smol-notes.v1";
const MAX_NOTES = 10;

export type NoteStoreData = {
  version: 1;
  activeId: string | null;
  notes: Note[];
};

function emptyStore(): NoteStoreData {
  return { version: 1, activeId: null, notes: [] };
}

function normalizeNote(n: Partial<Note> & { id: string }): Note {
  return {
    id: n.id,
    title: typeof n.title === "string" && n.title.trim() ? n.title : "untitled",
    titleManual: Boolean(n.titleManual),
    body: typeof n.body === "string" ? n.body : "",
    updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
  };
}

export function loadNoteStore(): NoteStoreData {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as NoteStoreData;
    if (parsed?.version !== 1 || !Array.isArray(parsed.notes)) {
      return emptyStore();
    }
    return {
      version: 1,
      activeId: parsed.activeId ?? null,
      notes: parsed.notes.map((n) => normalizeNote(n)),
    };
  } catch {
    return emptyStore();
  }
}

export function saveNoteStore(store: NoteStoreData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode — ignore
  }
}

export function titleFromBody(body: string): string {
  const line =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const t = line.replace(/\s+/g, " ");
  if (!t) return "untitled";
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** Auto title from body unless the user has locked it. */
export function withAutoTitle(note: Note, body: string = note.body): Note {
  if (note.titleManual) {
    return { ...note, body };
  }
  return {
    ...note,
    body,
    title: titleFromBody(body),
  };
}

export function upsertNote(store: NoteStoreData, note: Note): NoteStoreData {
  const rest = store.notes.filter((n) => n.id !== note.id);
  const notes = [note, ...rest]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_NOTES);
  return {
    version: 1,
    activeId: note.id,
    notes,
  };
}

export function removeNote(store: NoteStoreData, id: string): NoteStoreData {
  const notes = store.notes.filter((n) => n.id !== id);
  return {
    version: 1,
    activeId: store.activeId === id ? null : store.activeId,
    notes,
  };
}

export function listNotes(store: NoteStoreData): Note[] {
  return [...store.notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createEmptyNote(id: string): Note {
  return {
    id,
    title: "untitled",
    titleManual: false,
    body: "",
    updatedAt: Date.now(),
  };
}
