-- Customer + account products (no money movement here)
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS account;

CREATE TABLE IF NOT EXISTS customer.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  kyc_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
  date_of_birth DATE,
  address_line TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account.products (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  product_type TEXT NOT NULL CHECK (product_type IN ('savings', 'current', 'loan'))
);

INSERT INTO account.products (code, name, product_type) VALUES
  ('SAV_INR', 'Savings Account', 'savings'),
  ('CUR_INR', 'Current Account', 'current')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS account.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer.profiles(id),
  product_code TEXT NOT NULL REFERENCES account.products(code),
  account_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'frozen', 'closed')),
  currency TEXT NOT NULL DEFAULT 'INR',
  -- Cache only — ledger is source of truth
  available_balance_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_customer ON account.accounts(customer_id);
