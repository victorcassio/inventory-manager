-- 1. Guard: refuse to proceed if any two e-mails collide once normalized.
--    Aborts the entire migration with a readable message. Never merges or
--    deletes users.
DO $$
DECLARE conflicting TEXT;
BEGIN
  SELECT string_agg(e, ', ') INTO conflicting
  FROM (
    SELECT lower(btrim("email")) AS e
    FROM "users"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) dups;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration abortada: e-mails que colidem apos normalizacao (lower+btrim): %. Resolva manualmente antes de aplicar.',
      conflicting;
  END IF;
END $$;

-- 2. Normalize existing e-mails so they match the service's normalized lookup.
UPDATE "users"
   SET "email" = lower(btrim("email"))
 WHERE "email" <> lower(btrim("email"));

-- 3. The invitation flow creates a user before any password exists.
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- 4. New timestamps. All nullable: no table rewrite, no default needed.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "password_set_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);

-- 5. Backfill. WITHOUT THIS EVERY EXISTING USER IS LOCKED OUT, because the new
--    login gate rejects a NULL email_verified_at. password_changed_at stays
--    NULL: these accounts have never had a password *change*.
UPDATE "users"
   SET "email_verified_at" = "created_at",
       "password_set_at"   = "created_at"
 WHERE "password" IS NOT NULL;

-- 6. Action tokens (invitations and password resets).
CREATE TYPE "UserActionTokenType" AS ENUM ('invitation', 'password_reset');

CREATE TABLE "user_action_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "UserActionTokenType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_action_tokens_token_hash_key" ON "user_action_tokens"("token_hash");
CREATE INDEX "user_action_tokens_user_id_type_idx" ON "user_action_tokens"("user_id", "type");
CREATE INDEX "user_action_tokens_expires_at_idx" ON "user_action_tokens"("expires_at");

ALTER TABLE "user_action_tokens"
  ADD CONSTRAINT "user_action_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Case- AND whitespace-insensitive uniqueness as a database guarantee, not
--    just an application one. Prisma cannot express a functional index in
--    schema.prisma, so `prisma db pull` will not round-trip this — do not drop
--    it if a future `migrate diff` suggests doing so.
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower(btrim("email")));
