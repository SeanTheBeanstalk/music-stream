type PlaybackStatus = "loading" | "playing" | "retrying" | "paused" | "blocked";

// Media elements do not expose HTTP status codes, so retry stream/load failures.
export function createPlaybackRetry(
  audio: HTMLAudioElement,
  onStatus: (status: PlaybackStatus, delay?: number) => void
) {
  let wanted = false;
  let generation = 0;
  let failures = 0;
  let resumeTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearRetry() {
    clearTimeout(timer);
    timer = undefined;
  }

  function stop() {
    wanted = false;
    generation++;
    clearRetry();
    audio.pause();
    onStatus("paused");
  }

  function failed() {
    if (!wanted || timer !== undefined) return;
    resumeTime = Math.max(resumeTime, audio.currentTime || 0);
    // Back off indefinitely, without repeatedly hammering the stream endpoint.
    const delay = Math.min(1000 * 2 ** Math.min(failures++, 5), 30000);
    onStatus("retrying", delay);
    timer = setTimeout(() => {
      timer = undefined;
      attempt(true);
    }, delay);
  }

  function attempt(reload: boolean) {
    if (!wanted) return;
    const current = ++generation;
    onStatus("loading");
    if (reload) audio.load();
    void audio.play().catch((cause: unknown) => {
      if (!wanted || current !== generation) return;
      if (cause instanceof Error && cause.name === "NotAllowedError") {
        stop();
        onStatus("blocked");
      } else {
        failed();
      }
    });
  }

  return {
    start(src?: string) {
      clearRetry();
      failures = 0;
      wanted = true;
      if (src) {
        resumeTime = 0;
        audio.src = src;
      }
      attempt(Boolean(src) || Boolean(audio.error));
    },
    stop,
    failed,
    playing() {
      if (!wanted) {
        audio.pause();
        return;
      }
      clearRetry();
      failures = 0;
      resumeTime = 0;
      onStatus("playing");
    },
    loadedMetadata() {
      if (!wanted || !resumeTime || !Number.isFinite(audio.duration)) return;
      // Restore the last position after reloading a failed stream.
      audio.currentTime = Math.min(
        resumeTime,
        Math.max(0, audio.duration - 0.1)
      );
    },
  };
}
