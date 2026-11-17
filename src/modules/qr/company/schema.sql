-- Owned local target schema; never applied automatically by the retained legacy server.
BEGIN;
SELECT pg_advisory_xact_lock(94121, 1);
CREATE SCHEMA IF NOT EXISTS lp2_company;
CREATE TABLE IF NOT EXISTS lp2_company.schema_versions (
  owner text PRIMARY KEY, version integer NOT NULL CHECK(version>0)
);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM lp2_company.schema_versions WHERE (owner='identity' AND version<>1) OR (owner='qr' AND version NOT IN (1,2))) THEN
    RAISE EXCEPTION 'Unsupported retained Company schema version';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS lp2_company.subjects (
  company text NOT NULL, central_user text NOT NULL, local_user uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(company,central_user), UNIQUE(company,local_user)
);
CREATE TABLE IF NOT EXISTS lp2_company.qr_documents (
  company text NOT NULL, id uuid NOT NULL, owner uuid NOT NULL,
  qr_type text NOT NULL CHECK(qr_type IN ('PHONE','LINK','EMAIL','TEXT','WHATSAPP','TELEGRAM','CONTACT')),
  qr_data text NOT NULL CHECK(octet_length(qr_data)<=131072),
  description text CHECK(octet_length(description)<=8192),
  status text NOT NULL CHECK(status IN ('ACTIVE','PAUSED','DELETED')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0 AND revision<=9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company,id), FOREIGN KEY(company,owner) REFERENCES lp2_company.subjects(company,local_user)
);
CREATE INDEX IF NOT EXISTS qr_owner_page ON lp2_company.qr_documents(company,owner,id);
INSERT INTO lp2_company.schema_versions(owner,version) VALUES ('identity',1),('qr',1) ON CONFLICT DO NOTHING;
COMMIT;
