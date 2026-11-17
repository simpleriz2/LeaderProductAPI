-- QR owner migration1->2. The reply is immutable even after the document is subsequently edited.
BEGIN;
SELECT pg_advisory_xact_lock(94121, 1);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM lp2_company.schema_versions WHERE owner='qr' AND version IN (1,2)) THEN
    RAISE EXCEPTION 'Missing/unsupported QR base schema';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS lp2_company.qr_create_receipts (
  company text NOT NULL, owner uuid NOT NULL, operation_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  document_id uuid NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company,owner,operation_id),
  FOREIGN KEY(company,document_id) REFERENCES lp2_company.qr_documents(company,id),
  FOREIGN KEY(company,owner) REFERENCES lp2_company.subjects(company,local_user)
);
UPDATE lp2_company.schema_versions SET version=2 WHERE owner='qr' AND version=1;
COMMIT;
