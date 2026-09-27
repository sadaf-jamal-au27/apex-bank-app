-- Real banking ops: funding GL, beneficiaries, cards, payments, KYC enrich
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS card;

-- System / product codes
INSERT INTO account.products (code, name, product_type) VALUES
  ('SYS_FUNDING', 'Bank Funding Pool', 'current'),
  ('SYS_MERCHANT', 'Merchant Settlement Pool', 'current')
ON CONFLICT (code) DO NOTHING;

-- Internal bank customer (holds GL pools)
INSERT INTO customer.profiles (id, user_id, kyc_status, address_line, city, state, pincode)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'verified',
  'Apex Bank Treasury',
  'Mumbai',
  'MH',
  '400001'
)
ON CONFLICT (user_id) DO NOTHING;

-- Funding pool — counterpart for customer deposits / withdrawals
INSERT INTO account.accounts (
  id, customer_id, product_code, account_number, status, available_balance_paise
) VALUES (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  'SYS_FUNDING',
  'APEX-FUNDING-POOL',
  'open',
  100000000000000
)
ON CONFLICT (account_number) DO NOTHING;

INSERT INTO account.accounts (
  id, customer_id, product_code, account_number, status, available_balance_paise
) VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001',
  'SYS_MERCHANT',
  'APEX-MERCHANT-POOL',
  'open',
  0
)
ON CONFLICT (account_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer.beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer.profiles(id),
  nickname TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc TEXT NOT NULL DEFAULT 'APEX0000001',
  account_id UUID REFERENCES account.accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, account_number)
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_customer ON customer.beneficiaries(customer_id);

CREATE TABLE IF NOT EXISTS card.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account.accounts(id),
  customer_id UUID NOT NULL REFERENCES customer.profiles(id),
  last4 TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'Rupay' CHECK (network IN ('Rupay', 'Visa', 'Mastercard')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'closed')),
  token_ref TEXT NOT NULL UNIQUE, -- external vault id — never store PAN/CVV
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_customer ON card.cards(customer_id);
CREATE INDEX IF NOT EXISTS idx_cards_account ON card.cards(account_id);

CREATE TABLE IF NOT EXISTS payment.bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer.profiles(id),
  from_account_id UUID NOT NULL REFERENCES account.accounts(id),
  biller_code TEXT NOT NULL,
  biller_name TEXT NOT NULL,
  consumer_ref TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'failed')),
  journal_id UUID REFERENCES ledger.journals(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_customer ON payment.bill_payments(customer_id);

-- Seed common billers (reference data)
CREATE TABLE IF NOT EXISTS payment.billers (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL
);

INSERT INTO payment.billers (code, name, category) VALUES
  ('ELEC_MSEB', 'MSEB Electricity', 'electricity'),
  ('MOB_AIRTEL', 'Airtel Prepaid', 'mobile'),
  ('GAS_IGL', 'IGL Gas', 'gas'),
  ('WATER_BMC', 'BMC Water', 'water')
ON CONFLICT (code) DO NOTHING;
