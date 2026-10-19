-- Apply after 0001. Tracks reservations, completed objects, and orphan cleanup.
BEGIN;
CREATE TABLE public.cache_objects (
    object_key TEXT PRIMARY KEY,
    audio_asset_id UUID NOT NULL REFERENCES public.audio_assets(id) ON DELETE RESTRICT,
    job_id UUID REFERENCES public.cache_jobs(id) ON DELETE RESTRICT,
    lease_token UUID,
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    -- Wait longer than a worker's absolute deadline before crash cleanup.
    cleanup_after TIMESTAMPTZ NOT NULL DEFAULT now() + interval '20 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cache_objects_cleanup ON public.cache_objects(cleanup_after);
INSERT INTO public.cache_objects(object_key,audio_asset_id,byte_size,cleanup_after)
SELECT object_key,id,byte_size,now() FROM public.audio_assets
WHERE object_key IS NOT NULL AND byte_size > 0;
COMMIT;
