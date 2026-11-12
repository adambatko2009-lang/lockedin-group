"use client";
import { useEffect } from "react";

// Starts the app (src/engine/engine.ts) once, in the browser, after React has put the page in place.
// The engine then draws every page itself, exactly like the old index.html did.
export default function Boot() {
  useEffect(() => { import("@/engine/engine"); }, []);
  return null;
}
