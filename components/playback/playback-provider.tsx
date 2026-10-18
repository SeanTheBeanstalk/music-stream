"use client";
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { emptyQueue, queueReducer, type RepeatMode } from "@/lib/music/queue";
import type { Track } from "@/lib/music/track";

function usePlaybackState(audioRef: RefObject<HTMLAudioElement | null>) {
  const [queue, dispatch] = useReducer(queueReducer, emptyQueue);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [seekable, setSeekable] = useState(false);
  const track = queue.tracks[queue.index];
  const playAudio = () => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    if (audio.error) audio.load();
    setError(null);
    setBuffering(true);
    void audio.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setBuffering(false);
      setError(
        "Playback could not start. Try Play again or choose another track."
      );
    });
  };
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    audio.src = `/api/stream/${track.id}`;
    audio.load();
    // Only an explicit playback action promotes an upcoming track to current.
    if (queue.revision > 0) playAudio();
    // Queue additions must not reload or interrupt the active audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, queue.index, queue.revision]);
  return {
    queue,
    repeatMode,
    cycleRepeatMode: () =>
      setRepeatMode((mode) =>
        mode === "off" ? "track" : mode === "track" ? "queue" : "off"
      ),
    track,
    playing,
    buffering,
    error,
    time,
    duration,
    volume,
    seekable,
    play: (track: Track) => dispatch({ type: "play", track }),
    enqueue: (track: Track) => dispatch({ type: "enqueue", track }),
    playQueued: (index: number) => dispatch({ type: "select", index }),
    removeQueued: (index: number) => dispatch({ type: "remove", index }),
    moveQueued: (from: number, to: number) =>
      dispatch({ type: "move", from, to }),
    clearUpcoming: () => dispatch({ type: "clear-upcoming" }),
    next: () => dispatch({ type: "next" }),
    previous: () => dispatch({ type: "previous" }),
    toggle: () => {
      if (!track) dispatch({ type: "next" });
      else if (playing) audioRef.current?.pause();
      else playAudio();
    },
    seek: (value: number) => {
      if (audioRef.current && seekable) audioRef.current.currentTime = value;
    },
    changeVolume: (value: number) => {
      if (audioRef.current) audioRef.current.volume = value;
      setVolume(value);
    },
    events: {
      onPlay: () => setPlaying(true),
      onPause: () => {
        setPlaying(false);
        setBuffering(false);
      },
      onPlaying: () => {
        setBuffering(false);
        setError(null);
      },
      onWaiting: () => setBuffering(true),
      onLoadStart: () => {
        setTime(0);
        setDuration(0);
        setSeekable(false);
        setError(null);
      },
      onTimeUpdate: () => setTime(audioRef.current?.currentTime ?? 0),
      onProgress: () =>
        setSeekable((audioRef.current?.seekable.length ?? 0) > 0),
      onDurationChange: () => {
        const value = audioRef.current?.duration ?? 0;
        setDuration(Number.isFinite(value) ? value : 0);
      },
      onCanPlay: () => {
        setBuffering(false);
        setSeekable((audioRef.current?.seekable.length ?? 0) > 0);
      },
      onError: () => {
        setPlaying(false);
        setBuffering(false);
        setError(
          "This track could not be loaded. Retry Play or skip to the next track."
        );
      },
      onEnded: () => {
        setPlaying(false);
        setBuffering(false);
        dispatch({ type: "ended", repeatMode });
      },
    },
  };
}
const PlaybackContext = createContext<ReturnType<
  typeof usePlaybackState
> | null>(null);
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playback = usePlaybackState(audioRef);
  return (
    <PlaybackContext.Provider value={playback}>
      <audio ref={audioRef} preload="metadata" {...playback.events} />
      {children}
    </PlaybackContext.Provider>
  );
}
export function usePlayback() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("PlaybackProvider is required.");
  return value;
}
