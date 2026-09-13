// Exact original Foundation private SQLite layout, retained only as a repair witness.
// This is not a pre-Foundation product or compatibility fixture.
export const FOUNDATION_RECLAMATION_LAYOUT1_SQL = `
    PRAGMA application_id = 1279613010;
    PRAGMA user_version = 1;

    CREATE TABLE ledger_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_id TEXT NOT NULL,
      installation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE handoffs (
      obligation_digest TEXT PRIMARY KEY,
      handoff_core_digest TEXT NOT NULL UNIQUE,
      handoff_digest TEXT NOT NULL UNIQUE,
      store_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('agent-attempt', 'check')),
      owner_subject_digest TEXT NOT NULL,
      specification_digest TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL UNIQUE,
      reclamation_binding_digest TEXT NOT NULL UNIQUE,
      retirement_digest TEXT NOT NULL UNIQUE,
      dispatch_authority_consumed INTEGER NOT NULL CHECK (dispatch_authority_consumed IN (0, 1)),
      accepted_at TEXT NOT NULL,
      handoff_json TEXT NOT NULL CHECK (length(handoff_json) BETWEEN 2 AND 1048576),
      UNIQUE (store_id, process_id, activity_id, owner_kind, owner_subject_digest)
    ) STRICT;

    CREATE TABLE standings (
      obligation_digest TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK (generation > 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'reclaimed', 'integrity-refusal')),
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
      next_attempt_at TEXT,
      claim_token TEXT UNIQUE,
      claim_expires_at TEXT,
      last_observation_digest TEXT,
      last_observation_json TEXT,
      updated_at TEXT NOT NULL,
      standing_digest TEXT NOT NULL UNIQUE,
      FOREIGN KEY (obligation_digest) REFERENCES handoffs(obligation_digest),
      CHECK (
        (state = 'pending' AND next_attempt_at IS NOT NULL AND claim_token IS NULL AND claim_expires_at IS NULL) OR
        (state = 'claimed' AND next_attempt_at IS NULL AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL) OR
        (state IN ('reclaimed', 'integrity-refusal') AND next_attempt_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL AND last_observation_digest IS NOT NULL AND last_observation_json IS NOT NULL)
      ),
      CHECK (
        (last_observation_digest IS NULL AND last_observation_json IS NULL) OR
        (last_observation_digest IS NOT NULL AND last_observation_json IS NOT NULL)
      )
    ) STRICT;

    CREATE INDEX standings_schedule ON standings (state, next_attempt_at, claim_expires_at, obligation_digest);
    CREATE INDEX handoffs_process ON handoffs (store_id, process_id, obligation_digest);

    CREATE TRIGGER ledger_metadata_immutable_update BEFORE UPDATE ON ledger_metadata BEGIN
      SELECT RAISE(ABORT, 'ledger_metadata is immutable');
    END;
    CREATE TRIGGER ledger_metadata_immutable_delete BEFORE DELETE ON ledger_metadata BEGIN
      SELECT RAISE(ABORT, 'ledger_metadata is immutable');
    END;
    CREATE TRIGGER handoffs_immutable_update BEFORE UPDATE ON handoffs BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation handoff is immutable');
    END;
    CREATE TRIGGER handoffs_immutable_delete BEFORE DELETE ON handoffs BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation handoff is immutable');
    END;
    CREATE TRIGGER standings_retained_delete BEFORE DELETE ON standings BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation standing tombstone is retained');
    END;
  `;
