/** Shared timings in seconds for Motion; CSS equivalents live in globals.css. */
export const motionTokens = {
  fast: 0.12,
  standard: 0.2,
  moderate: 0.28,
  trace: 0.8,
  ease: [0.25, 1, 0.5, 1] as [number, number, number, number],
};

export const panelTransition = { duration: motionTokens.standard, ease: motionTokens.ease };
