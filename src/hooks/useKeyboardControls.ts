"use client";

import { useEffect } from "react";

import { RATE_STEP, useFocusStore } from "@/store/useFocusStore";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Global transport keys. Deliberately inert while the user is typing (the
 * scratchpad needs its spacebar) and while an intercept is open (the modal owns
 * the keyboard until a summary is committed).
 */
export function useKeyboardControls(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useFocusStore.getState();
      if (!state.doc) return;
      if (state.intercept.open) return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          state.togglePlaying();
          break;

        case "ArrowUp":
          event.preventDefault();
          state.nudgeRate(RATE_STEP);
          break;

        case "ArrowDown":
          event.preventDefault();
          state.nudgeRate(-RATE_STEP);
          break;

        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) {
            const current = state.doc.tokens[state.tokenIndex]?.section ?? 0;
            state.seekSection(Math.min(current + 1, state.doc.sections.length - 1));
          } else {
            state.stepSentence(1);
          }
          break;

        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) {
            const current = state.doc.tokens[state.tokenIndex]?.section ?? 0;
            state.seekSection(Math.max(current - 1, 0));
          } else {
            state.stepSentence(-1);
          }
          break;

        case "Home":
          event.preventDefault();
          state.seekChunk(0);
          break;

        case "Escape":
          event.preventDefault();
          state.setPlaying(false);
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
