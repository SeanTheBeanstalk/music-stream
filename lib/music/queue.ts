import type { Track } from "./track";
export interface QueueState {
  tracks: Track[];
  index: number;
  revision: number;
}
export type QueueAction =
  | { type: "play" | "enqueue"; track: Track }
  | { type: "next" | "previous" | "clear-upcoming" }
  | { type: "select" | "remove"; index: number }
  | { type: "move"; from: number; to: number };
export const emptyQueue: QueueState = { tracks: [], index: -1, revision: 0 };
export function queueReducer(
  state: QueueState,
  action: QueueAction
): QueueState {
  switch (action.type) {
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
        index: state.index < 0 ? 0 : state.index,
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
        : state;
    case "previous":
      return state.index > 0
        ? { ...state, index: state.index - 1, revision: state.revision + 1 }
        : state;
  }
}
