/**
 * Arrowhead definitions shared by every graph canvas. Rendered once by the app shell (never
 * inside a hidden route), because markers defined in a display:none subtree stop painting.
 */
/** Must match the stroke colours in graph.css (black, bone, blood palette). */
export const MARKER_COLORS = {
  base: "#514949",
  dim: "#2e2929",
  hover: "#aba49b",
  focus: "#ece6dc",
  unwanted: "#f03a4d",
  required: "#7fa58b",
  permitted: "#9a938b",
  mixed: "#d6cfc4",
  added: "#ece6dc",
  removed: "#f03a4d",
} as const;

export type MarkerKey = keyof typeof MARKER_COLORS;

export function markerUrl(key: MarkerKey): string {
  return `url(#cl-arrow-${key})`;
}

export function GraphMarkers() {
  return (
    <svg width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden focusable="false">
      <defs>
        {(Object.keys(MARKER_COLORS) as MarkerKey[]).map((key) => (
          <marker
            key={key}
            id={`cl-arrow-${key}`}
            viewBox="0 0 10 10"
            refX="9.2"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M1 1.4 L9.2 5 L1 8.6 Z" fill={MARKER_COLORS[key]} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
