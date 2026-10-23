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
import {
  defaultRepeatMode,
  emptyQueue,
  queueReducer,
  type RepeatMode,
} from "@/lib/music/queue";
import { toast } from "sonner";
import type { Track } from "@/lib/music/track";
import { createPlaybackRetry } from "@/lib/music/playback-retry";

function usePlaybackState(audioRef: RefObject<HTMLAudioElement | null>) {
  const [queue, dispatch] = useReducer(queueReducer, emptyQueue);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(defaultRepeatMode);
  const [playing, setPlaying] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const retryRef = useRef<ReturnType<typeof createPlaybackRetry> | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [seekable, setSeekable] = useState(false);
  const track = queue.tracks[queue.index];
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let notification: string | number | undefined;
    const retry = createPlaybackRetry(audio, (status, delay) => {
      setPlayRequested(status !== "paused" && status !== "blocked");
      setPlaying(status === "playing");
      setBuffering(status === "loading");
      if (status === "retrying") {
        notification = toast.error(
          `Unable to load audio. Retrying in ${delay! / 1000}s... Pause to cancel or skip this track.`,
          {
            id: notification,
            duration: Infinity,
          }
        );
      } else if (status === "blocked") {
        notification = toast.error(
          "Your browser requires you to press Play to start audio.",
          { id: notification }
        );
      } else if (status === "playing" || status === "paused") {
        if (notification !== undefined) toast.dismiss(notification);
        notification = undefined;
      }
    });
    retryRef.current = retry;
    return () => {
      retry.stop();
      retryRef.current = null;
    };
  }, [audioRef]);
  useEffect(() => {
    const retry = retryRef.current;
    if (!retry || !track) return;
    // Only an explicit playback action promotes an upcoming track to current.
    if (queue.revision > 0) retry.start(`/api/stream/${track.id}`);
    return () => retry.stop();
    // Queue additions must not reload or interrupt the active audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, queue.revision]);
  return {
    queue,
    repeatMode,
    cycleRepeatMode: () =>
      setRepeatMode((mode) =>
        mode === "off" ? "track" : mode === "track" ? "queue" : "off"
      ),
    track,
    playing,
    playRequested,
    buffering,
    time,
    duration,
    volume,
    seekable,
    play: (track: Track) => dispatch({ type: "play", track }),
    playMany: (tracks: Track[]) => dispatch({ type: "play-many", tracks }),
    enqueue: (track: Track) => dispatch({ type: "enqueue", track }),
    playQueued: (index: number) =>
      dispatch({ type: "select", index, repeatMode }),
    removeQueued: (index: number) =>
      dispatch({ type: "remove", index, repeatMode }),
    moveQueued: (from: number, to: number) =>
      dispatch({ type: "move", from, to, repeatMode }),
    clearUpcoming: () => dispatch({ type: "clear-upcoming", repeatMode }),
    next: () => dispatch({ type: "next", repeatMode }),
    previous: () => dispatch({ type: "previous", repeatMode }),
    toggle: () => {
      if (!track) dispatch({ type: "next" });
      else if (playRequested) retryRef.current?.stop();
      else retryRef.current?.start();
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
        retryRef.current?.playing();
      },
      onLoadedMetadata: () => retryRef.current?.loadedMetadata(),
      onWaiting: () => setBuffering(true),
      onLoadStart: () => {
        setTime(0);
        setDuration(0);
        setSeekable(false);
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
        retryRef.current?.failed();
      },
      onEnded: () => {
        retryRef.current?.stop();
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
