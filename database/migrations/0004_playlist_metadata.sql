BEGIN;
ALTER TABLE public.playlists
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  ADD COLUMN cover_image_key TEXT CHECK (cover_image_key ~ '^playlist-covers/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');

-- Uploads are registered before R2 writes. Publication removes the pending
-- cleanup row in the same transaction. Crashed uploads expire after one day.
CREATE TABLE public.playlist_cover_cleanup (
  object_key TEXT PRIMARY KEY,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION public.queue_playlist_cover_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cover_image_key IS NOT NULL THEN
    INSERT INTO public.playlist_cover_cleanup (object_key) VALUES (OLD.cover_image_key)
      ON CONFLICT (object_key) DO UPDATE SET available_at=now();
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER playlist_cover_replaced AFTER UPDATE OF cover_image_key ON public.playlists
  FOR EACH ROW WHEN (OLD.cover_image_key IS DISTINCT FROM NEW.cover_image_key)
  EXECUTE FUNCTION public.queue_playlist_cover_cleanup();
CREATE TRIGGER playlist_cover_deleted AFTER DELETE ON public.playlists
  FOR EACH ROW EXECUTE FUNCTION public.queue_playlist_cover_cleanup();
COMMIT;
