-- Audit-grade DB controls: immutable journals/audit, lockout columns, maker-checker status.

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transfer.transfers DROP CONSTRAINT IF EXISTS transfers_status_check;
ALTER TABLE transfer.transfers
  ADD CONSTRAINT transfers_status_check
  CHECK (status IN ('pending', 'pending_approval', 'posted', 'failed', 'reversed'));

CREATE OR REPLACE FUNCTION audit.deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_table:%', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS journals_immutable ON ledger.journals;
CREATE TRIGGER journals_immutable
  BEFORE UPDATE OR DELETE ON ledger.journals
  FOR EACH ROW EXECUTE PROCEDURE audit.deny_mutation();

DROP TRIGGER IF EXISTS journal_legs_immutable ON ledger.journal_legs;
CREATE TRIGGER journal_legs_immutable
  BEFORE UPDATE OR DELETE ON ledger.journal_legs
  FOR EACH ROW EXECUTE PROCEDURE audit.deny_mutation();

DROP TRIGGER IF EXISTS audit_events_immutable ON audit.events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit.events
  FOR EACH ROW EXECUTE PROCEDURE audit.deny_mutation();

COMMENT ON TABLE ledger.journals IS 'Append-only journals; mutations blocked by trigger.';
COMMENT ON TABLE audit.events IS 'Append-only application audit trail.';
