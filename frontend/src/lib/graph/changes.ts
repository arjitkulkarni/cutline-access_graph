import type { GraphSnapshot } from "../types";
import type { Presence } from "./view";

/** Compare only snapshots actually observed in this browser session. */
export function graphChanges(previous: GraphSnapshot, current: GraphSnapshot) {
  const nodePresence: Record<string, Presence> = {};
  const edgePresence: Record<string, Presence> = {};
  const counts = { added: 0, removed: 0, modified: 0 };
  for (const [before, after, presence] of [
    [previous.nodes, current.nodes, nodePresence],
    [previous.edges, current.edges, edgePresence],
  ] as const) {
    const old = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
    const next = new Map(after.map((item) => [item.id, JSON.stringify(item)]));
    for (const [id, value] of next) {
      const state = !old.has(id) ? "added" : old.get(id) !== value ? "modified" : "present";
      presence[id] = state;
      if (state !== "present") counts[state]++;
    }
    for (const id of old.keys()) {
      if (!next.has(id)) { presence[id] = "removed"; counts.removed++; }
    }
  }
  return { nodePresence, edgePresence, counts };
}
