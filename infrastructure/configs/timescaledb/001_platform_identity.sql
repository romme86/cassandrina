ALTER TABLE users
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS platform_user_id TEXT;

UPDATE users
SET
    platform = COALESCE(platform, 'whatsapp'),
    platform_user_id = COALESCE(platform_user_id, whatsapp_jid)
WHERE
    platform IS NULL
    OR platform_user_id IS NULL;

ALTER TABLE users
    ALTER COLUMN platform SET NOT NULL,
    ALTER COLUMN platform_user_id SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'whatsapp_jid'
    ) THEN
        ALTER TABLE users DROP COLUMN whatsapp_jid;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_platform_platform_user_id_key'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_platform_platform_user_id_key
            UNIQUE (platform, platform_user_id);
    END IF;
END $$;

DROP INDEX IF EXISTS idx_users_whatsapp_jid;
CREATE INDEX IF NOT EXISTS idx_users_platform_identity ON users(platform, platform_user_id);
