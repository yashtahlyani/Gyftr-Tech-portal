/* ─── Tiny toast bus — exists so a failed cloud write is never silent.
   The stores update the UI optimistically; if Supabase then rejects the
   write (RLS, network), the user must SEE that it didn't stick, not
   discover it after a refresh. ─── */
import { useEffect, useState } from "react";

export interface Toast { id: number; text: string; }

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

export function toast(text: string) {
  const t = { id: nextId++, text };
  toasts = [...toasts, t];
  listeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l());
  }, 5000);
}

export function useToasts(): Toast[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return toasts;
}
