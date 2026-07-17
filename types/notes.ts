export type Note = {
  id: string;
  title: string;
  /** Once true, title is user-owned and never auto-derived from body. */
  titleManual: boolean;
  body: string;
  updatedAt: number;
};

export type NotePhase = "idle" | "suggesting" | "cancelled" | "error";
