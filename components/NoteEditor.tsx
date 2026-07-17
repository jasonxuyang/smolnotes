"use client";

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { Note } from "@/types/notes";

type NoteEditorProps = {
  note: Note;
  caret: number;
  suggestion: string;
  disabled: boolean;
  onBodyChange: (body: string, caret: number) => void;
  onTitleChange: (title: string) => void;
  onTitleBlur: () => void;
  onCaretChange: (caret: number) => void;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
};

export function NoteEditor({
  note,
  caret,
  suggestion,
  disabled,
  onBodyChange,
  onTitleChange,
  onTitleBlur,
  onCaretChange,
  onAcceptSuggestion,
  onDismissSuggestion,
}: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const showGhost = Boolean(suggestion) && !disabled;
  const empty = note.body.trim().length === 0;
  const safeCaret = Math.max(0, Math.min(caret, note.body.length));
  const before = note.body.slice(0, safeCaret);
  const after = note.body.slice(safeCaret);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || disabled) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    onCaretChange(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [note.id, disabled]);

  const syncCaret = () => {
    const el = textareaRef.current;
    if (!el) return;
    onCaretChange(el.selectionStart);
  };

  const syncScroll = () => {
    const el = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const nextCaret = event.target.selectionStart;
    onBodyChange(next, nextCaret);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      if (suggestion) onAcceptSuggestion();
      return;
    }
    if (event.key === "Escape" && suggestion) {
      event.preventDefault();
      onDismissSuggestion();
      return;
    }
  };

  return (
    <div className="note-pane">
      <header className="note-pane__bar">
        <input
          className={
            note.titleManual
              ? "note-pane__title note-pane__title--manual"
              : "note-pane__title"
          }
          type="text"
          value={note.title}
          disabled={disabled}
          spellCheck={false}
          aria-label="Note title"
          title={
            note.titleManual
              ? "Custom title"
              : "Auto title from note — edit to lock"
          }
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleBlur}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </header>

      <div className="note-editor">
        {showGhost ? (
          <pre ref={mirrorRef} className="note-editor__mirror" aria-hidden="true">
            {before}
            <span className="note-editor__ghost">{suggestion}</span>
            <span className="note-editor__inline-hint">
              <kbd>Tab</kbd>
              <span> Accept</span>
              <span className="note-editor__inline-hint-sep"> </span>
              <kbd>Esc</kbd>
              <span> Dismiss</span>
            </span>
            {after}
          </pre>
        ) : null}
        <textarea
          ref={textareaRef}
          className={
            showGhost
              ? "note-editor__input note-editor__input--ghosting"
              : "note-editor__input"
          }
          value={note.body}
          disabled={disabled}
          spellCheck
          placeholder={empty ? "start writing…" : undefined}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={syncCaret}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          onScroll={syncScroll}
          aria-label="Note"
        />
      </div>
    </div>
  );
}
