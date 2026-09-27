const BASE = "";

export type User = { id: string; email: string; fullName: string };
export type Account = {
  id: string;
  accountNumber: string;
  productCode: string;
  status: string;
  availableBalancePaise: number;
  currency: string;
};
export type Txn = {
  id: string;
  direction: string;
  amountPaise: number;
  signedPaise: number;
  narration: string;
  referenceType: string;
  postedAt: string;
};
export type Beneficiary = {
  id: string;
  nickname: string;
  accountNumber: string;
  ifsc: string;
  accountId: string | null;
};
export type Card = {
  id: string;
  last4: string;
  network: string;
  status: string;
  maskedPan: string;
  accountId: string;
  accountNumber: string;
};
export type Biller = { code: string; name: string; category: string };
export type Profile = {
  id: string;
  kycStatus: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
};

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `http_${res.status}`);
  return body as T;
}

export const api = {
  register: (email: string, password: string, fullName: string, phone?: string) =>
    call<{ id: string }>("/v1/banking/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, fullName, phone }),
    }),
  login: (email: string, password: string) =>
    call<{ accessToken: string; user: User }>("/v1/banking/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => call<{ user: User }>("/v1/banking/auth/me", { headers: authHeaders(token) }),
  logout: (token: string) =>
    call<{ ok: boolean }>("/v1/banking/auth/logout", {
      method: "POST",
      headers: authHeaders(token),
    }),
  profile: (token: string) =>
    call<{ user: User; profile: Profile | null }>("/v1/banking/profile", {
      headers: authHeaders(token),
    }),
  submitKyc: (
    token: string,
    data: { dateOfBirth: string; addressLine: string; city: string; state: string; pincode: string }
  ) =>
    call("/v1/banking/profile/kyc", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(data),
    }),
  listAccounts: (token: string) =>
    call<{ items: Account[] }>("/v1/banking/accounts", { headers: authHeaders(token) }),
  openAccount: (token: string, openingDepositPaise: number, productCode = "SAV_INR") =>
    call<Account>("/v1/banking/accounts", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ openingDepositPaise, productCode }),
    }),
  deposit: (token: string, accountId: string, amountPaise: number) =>
    call(`/v1/banking/accounts/${accountId}/deposit`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ amountPaise, idempotencyKey: crypto.randomUUID() }),
    }),
  transactions: (token: string, accountId: string) =>
    call<{ items: Txn[] }>(`/v1/banking/accounts/${accountId}/transactions`, {
      headers: authHeaders(token),
    }),
  beneficiaries: (token: string) =>
    call<{ items: Beneficiary[] }>("/v1/banking/beneficiaries", { headers: authHeaders(token) }),
  addBeneficiary: (token: string, nickname: string, accountNumber: string) =>
    call("/v1/banking/beneficiaries", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ nickname, accountNumber, ifsc: "APEX0000001" }),
    }),
  transfer: (
    token: string,
    fromAccountId: string,
    opts: { toAccountId?: string; toAccountNumber?: string; amountPaise: number; narration?: string }
  ) =>
    call("/v1/banking/transfers", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...opts, fromAccountId, idempotencyKey: crypto.randomUUID() }),
    }),
  billers: (token: string) =>
    call<{ items: Biller[] }>("/v1/banking/billers", { headers: authHeaders(token) }),
  payBill: (
    token: string,
    data: { fromAccountId: string; billerCode: string; consumerRef: string; amountPaise: number }
  ) =>
    call("/v1/banking/bill-payments", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...data, idempotencyKey: crypto.randomUUID() }),
    }),
  billPayments: (token: string) =>
    call<{ items: Array<{ id: string; billerName: string; amountPaise: number; status: string; createdAt: string }> }>(
      "/v1/banking/bill-payments",
      { headers: authHeaders(token) }
    ),
  cards: (token: string) => call<{ items: Card[] }>("/v1/banking/cards", { headers: authHeaders(token) }),
  issueCard: (token: string, accountId: string) =>
    call<Card>("/v1/banking/cards", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ accountId, network: "Rupay" }),
    }),
  blockCard: (token: string, cardId: string) =>
    call(`/v1/banking/cards/${cardId}/block`, {
      method: "POST",
      headers: authHeaders(token),
      body: "{}",
    }),
};

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}
