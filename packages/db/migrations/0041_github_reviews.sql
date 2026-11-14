-- custom: the data step, which drizzle-kit does not write (no column changes: the rights are jsonb). Since 2026-11-14 a
-- profile's GitHub part has a `reviews` right (`off`, `comment` or `approve`: reviewing pull requests through the
-- agents' GitHub tools). Every GitHub part stored before gets `"reviews": "off"`, so nothing reviews until its owner
-- turns it on; a part that already says `reviews` is left as it is. Nobody gains anything, so no audit row is written.
UPDATE "access_profiles"
SET "github_rights" = "github_rights" || '{"reviews": "off"}'::jsonb
WHERE "github_rights" IS NOT NULL AND NOT ("github_rights" ? 'reviews');
