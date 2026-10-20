import type { Track } from "./track";
export type RepeatMode = "off" | "track" | "queue";
export const defaultRepeatMode: RepeatMode = "queue";
export interface QueueState {
  tracks: Track[];
  index: number;
  revision: number;
}
export type QueueAction =
  | { type: "play-many"; tracks: Track[] }
  | { type: "ended"; repeatMode: RepeatMode }
  | { type: "play" | "enqueue"; track: Track }
  | { type: "next" | "previous"; repeatMode?: RepeatMode }
  | { type: "clear-upcoming"; repeatMode?: RepeatMode }
  | { type: "select" | "remove"; index: number; repeatMode?: RepeatMode }
  | { type: "move"; from: number; to: number; repeatMode?: RepeatMode };
export const emptyQueue: QueueState = { tracks: [], index: -1, revision: 0 };

// Keep occurrence indexes: two entries can refer to the same video.
export function upcomingQueue(state: QueueState, repeatMode: RepeatMode) {
  const entries = state.tracks.map((track, index) => ({ track, index }));
  const upcoming = entries.slice(state.index + 1);
  return repeatMode === "queue" && state.index >= 0
    ? [...upcoming, ...entries.slice(0, state.index)]
    : upcoming;
}

// Lay the edited cycle around the current position, preserving navigation history
// where possible. Playback revision changes only when a track is selected.
function replaceCycle(state: QueueState, current: Track, upcoming: Track[]) {
  const index = Math.min(state.index, upcoming.length);
  const split = upcoming.length - index;
  return {
    ...state,
    tracks: [...upcoming.slice(split), current, ...upcoming.slice(0, split)],
    index,
  };
}

export function queueReducer(
  state: QueueState,
  action: QueueAction
): QueueState {
  if (
    "repeatMode" in action &&
    action.repeatMode === "queue" &&
    action.type !== "ended" &&
    action.type !== "next" &&
    action.type !== "previous" &&
    state.tracks[state.index]
  ) {
    const current = state.tracks[state.index];
    const entries = upcomingQueue(state, "queue");
    if (action.type === "clear-upcoming")
      return entries.length ? replaceCycle(state, current, []) : state;
    if (action.type === "move") {
      const from = entries.findIndex((entry) => entry.index === action.from);
      const to = entries.findIndex((entry) => entry.index === action.to);
      if (from < 0 || to < 0 || from === to) return state;
      const [entry] = entries.splice(from, 1);
      entries.splice(to, 0, entry);
      return replaceCycle(
        state,
        current,
        entries.map((entry) => entry.track)
      );
    }
    if (action.type === "select" || action.type === "remove") {
      if (action.type === "select" && action.index === state.index)
        return { ...state, revision: state.revision + 1 };
      const offset = entries.findIndex((entry) => entry.index === action.index);
      if (offset < 0) return state;
      const [selected] = entries.splice(offset, 1);
      const remaining = entries.map((entry) => entry.track);
      return action.type === "remove"
        ? replaceCycle(state, current, remaining)
        : {
            ...replaceCycle(state, selected.track, [...remaining, current]),
            revision: state.revision + 1,
          };
    }
  }
  switch (action.type) {
    case "play-many": {
      if (!action.tracks.length) return state;
      return {
        tracks: [...action.tracks],
        index: 0,
        revision: state.revision + 1,
      };
    }
    case "ended":
      // An ending event must never start an idle or empty queue.
      if (!state.tracks[state.index]) return state;
      if (action.repeatMode === "track")
        return { ...state, revision: state.revision + 1 };
      if (state.index + 1 < state.tracks.length)
        return {
          ...state,
          index: state.index + 1,
          revision: state.revision + 1,
        };
      if (action.repeatMode === "queue")
        return { ...state, index: 0, revision: state.revision + 1 };
      return state;
    case "select": {
      if (
        !Number.isInteger(action.index) ||
        action.index < state.index ||
        action.index < 0 ||
        action.index >= state.tracks.length
      )
        return state;
      if (action.index === state.index)
        return { ...state, revision: state.revision + 1 };
      // Keep the old current track in history and bring only the selected
      // occurrence forward, leaving every other upcoming track in order.
      const tracks = [...state.tracks];
      const [track] = tracks.splice(action.index, 1);
      const index = state.index + 1;
      tracks.splice(index, 0, track);
      return { tracks, index, revision: state.revision + 1 };
    }
    case "remove":
      if (
        !Number.isInteger(action.index) ||
        action.index <= state.index ||
        action.index >= state.tracks.length
      )
        return state;
      return {
        ...state,
        tracks: state.tracks.filter((_, index) => index !== action.index),
      };
    case "move": {
      if (
        !Number.isInteger(action.from) ||
        !Number.isInteger(action.to) ||
        action.from <= state.index ||
        action.to <= state.index ||
        action.from >= state.tracks.length ||
        action.to >= state.tracks.length ||
        action.from === action.to
      )
        return state;
      const tracks = [...state.tracks];
      const [track] = tracks.splice(action.from, 1);
      tracks.splice(action.to, 0, track);
      return { ...state, tracks };
    }
    case "clear-upcoming":
      return state.tracks.length > state.index + 1
        ? { ...state, tracks: state.tracks.slice(0, state.index + 1) }
        : state;
    case "enqueue":
      return {
        ...state,
        tracks: [...state.tracks, action.track],
      };
    case "play": {
      const index = state.index + 1;
      const tracks = [...state.tracks];
      tracks.splice(index, 0, action.track);
      return { tracks, index, revision: state.revision + 1 };
    }
    case "next":
      return state.index + 1 < state.tracks.length
        ? { ...state, index: state.index + 1, revision: state.revision + 1 }
        : action.repeatMode === "queue" && state.index >= 0
          ? { ...state, index: 0, revision: state.revision + 1 }
          : state;
    case "previous":
      return state.index > 0
        ? { ...state, index: state.index - 1, revision: state.revision + 1 }
        : action.repeatMode === "queue" && state.index === 0
          ? {
              ...state,
              index: state.tracks.length - 1,
              revision: state.revision + 1,
            }
          : state;
  }
}
