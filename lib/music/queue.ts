import type { Track } from "./track";
export interface QueueState {
  tracks: Track[];
  index: number;
  revision: number;
}
export type QueueAction =
  { type: "play" | "enqueue"; track: Track } | { type: "next" | "previous" };
export const emptyQueue: QueueState = { tracks: [], index: -1, revision: 0 };
export function queueReducer(
  state: QueueState,
  action: QueueAction
): QueueState {
  switch (action.type) {
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
