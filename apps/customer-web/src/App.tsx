import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  formatInr,
  type Account,
  type Beneficiary,
  type Biller,
  type Card,
  type Profile,
  type Txn,
  type User,
} from "./api";

const TOKEN_KEY = "apex.token";
type Tab = "home" | "pay" | "cards" | "profile";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [billers, setBillers] = useState<Biller[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // forms
  const [depositInr, setDepositInr] = useState("5000");
  const [transferInr, setTransferInr] = useState("500");
  const [toAccountNumber, setToAccountNumber] = useState("");
  const [benNickname, setBenNickname] = useState("");
  const [benAcct, setBenAcct] = useState("");
  const [billerCode, setBillerCode] = useState("");
  const [consumerRef, setConsumerRef] = useState("");
  const [billInr, setBillInr] = useState("350");
  const [kyc, setKyc] = useState({
    dateOfBirth: "1995-01-15",
    addressLine: "",
    city: "",
    state: "",
    pincode: "",
  });

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];
  const total = useMemo(
    () => accounts.reduce((s, a) => s + a.availableBalancePaise, 0),
    [accounts]
  );

  const persist = (t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  };

  const logout = async () => {
    try {
      if (token) await api.logout(token);
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
  };

  const refresh = useCallback(async (t: string, accountForTx?: string) => {
    const [me, acc, bens, cds, bl] = await Promise.all([
      api.profile(t),
      api.listAccounts(t),
      api.beneficiaries(t),
      api.cards(t),
      api.billers(t),
    ]);
    setUser(me.user);
    setProfile(me.profile);
    setAccounts(acc.items);
    setBeneficiaries(bens.items);
    setCards(cds.items);
    setBillers(bl.items);
    if (bl.items[0]) setBillerCode((c) => c || bl.items[0].code);
    const prefer = accountForTx || selectedId;
    const nextId =
      (prefer && acc.items.some((a) => a.id === prefer) && prefer) || acc.items[0]?.id || "";
    setSelectedId(nextId);
    if (nextId) {
      const tx = await api.transactions(t, nextId);
      setTxns(tx.items);
    } else {
      setTxns([]);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!token) return;
    refresh(token).catch((e: Error) => {
      setError(e.message);
      if (e.message === "unauthorized") {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setUser(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedId) return;
    api
      .transactions(token, selectedId)
      .then((r) => setTxns(r.items))
      .catch((e: Error) => setError(e.message));
  }, [token, selectedId]);

  async function onAuth(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await api.register(email, password, fullName, phone || undefined);
      }
      const login = await api.login(email, password);
      persist(login.accessToken);
      setUser(login.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth_failed");
    } finally {
      setBusy(false);
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh(token, selectedId);
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token || !user) {
    return (
      <div className="shell">
        <header className="hero">
          <p className="eyebrow">Apex Bank · NetBanking</p>
          <h1 className="brand">Banking that posts to a real ledger</h1>
          <p className="tagline">
            KYC, savings accounts, IMPS transfers, RuPay cards, and bill pay — all through a
            double-entry journal. Balances are never edited by hand.
          </p>
        </header>
        <form className="panel auth" onSubmit={onAuth}>
          <div className="actions">
            <button type="button" className={mode === "login" ? "" : "secondary"} onClick={() => setMode("login")}>
              Sign in
            </button>
            <button
              type="button"
              className={mode === "register" ? "" : "secondary"}
              onClick={() => setMode("register")}
            >
              New customer
            </button>
          </div>
          {mode === "register" && (
            <>
              <label>
                Full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
              <label>
                Mobile
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit" />
              </label>
            </>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="err">{error}</p>}
          <button disabled={busy}>{mode === "login" ? "Sign in securely" : "Create profile"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="shell app">
      <header className="top">
        <div>
          <p className="eyebrow">Apex Bank</p>
          <h1>Hello, {user.fullName.split(" ")[0]}</h1>
          <p className="muted">
            {profile?.kycStatus === "verified" ? "KYC verified" : "KYC pending"} · {user.email}
          </p>
        </div>
        <div className="top-right">
          <div className="total">
            <span>Total balance</span>
            <strong>{formatInr(total)}</strong>
          </div>
          <button className="secondary" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ["home", "Accounts"],
            ["pay", "Pay & transfer"],
            ["cards", "Cards"],
            ["profile", "Profile / KYC"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {(error || notice) && (
        <p className={error ? "err banner" : "ok banner"}>{error ?? notice}</p>
      )}

      {tab === "home" && (
        <div className="grid">
          <section className="panel">
            <div className="row-between">
              <h2>Your accounts</h2>
              <button
                disabled={busy}
                onClick={() =>
                  run("Savings account opened with ledger deposit", async () => {
                    await api.openAccount(token, accounts.length === 0 ? 100_000 : 0);
                  })
                }
              >
                Open savings
              </button>
            </div>
            <div className="accounts">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={a.id === selected?.id ? "account on" : "account"}
                  onClick={() => setSelectedId(a.id)}
                >
                  <div>
                    <div className="acct-type">{a.productCode === "SAV_INR" ? "Savings" : "Current"}</div>
                    <small>{a.accountNumber}</small>
                  </div>
                  <strong>{formatInr(a.availableBalancePaise)}</strong>
                </button>
              ))}
              {accounts.length === 0 && <p className="muted">Open a savings account to get started.</p>}
            </div>

            {selected && (
              <div className="deposit-box">
                <h3>Deposit to {selected.accountNumber}</h3>
                <p className="muted">Posts: debit funding pool · credit your account (ledger journal).</p>
                <div className="inline">
                  <input value={depositInr} onChange={(e) => setDepositInr(e.target.value)} />
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("Deposit posted", async () => {
                        await api.deposit(token, selected.id, Math.round(Number(depositInr) * 100));
                      })
                    }
                  >
                    Deposit INR
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Statement · {selected?.accountNumber ?? "—"}</h2>
            <p className="muted">From immutable ledger legs — source of truth.</p>
            <ul className="txns">
              {txns.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.narration || t.referenceType}</strong>
                    <small>{new Date(t.postedAt).toLocaleString("en-IN")}</small>
                  </div>
                  <span className={t.signedPaise >= 0 ? "credit" : "debit"}>
                    {t.signedPaise >= 0 ? "+" : ""}
                    {formatInr(t.signedPaise)}
                  </span>
                </li>
              ))}
              {txns.length === 0 && <li className="muted">No transactions yet.</li>}
            </ul>
          </section>
        </div>
      )}

      {tab === "pay" && (
        <div className="grid">
          <section className="panel">
            <h2>Transfer (IMPS / internal)</h2>
            <label>
              From account
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber} · {formatInr(a.availableBalancePaise)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To account number
              <input
                value={toAccountNumber}
                onChange={(e) => setToAccountNumber(e.target.value)}
                placeholder="5011…"
                list="bens"
              />
              <datalist id="bens">
                {beneficiaries.map((b) => (
                  <option key={b.id} value={b.accountNumber}>
                    {b.nickname}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              Amount (INR)
              <input value={transferInr} onChange={(e) => setTransferInr(e.target.value)} />
            </label>
            <button
              disabled={busy || !selectedId}
              onClick={() =>
                run("Transfer posted to ledger", async () => {
                  await api.transfer(token, selectedId, {
                    toAccountNumber,
                    amountPaise: Math.round(Number(transferInr) * 100),
                    narration: "Customer IMPS transfer",
                  });
                })
              }
            >
              Send money
            </button>

            <hr />
            <h3>Saved beneficiaries</h3>
            <ul className="plain">
              {beneficiaries.map((b) => (
                <li key={b.id}>
                  <button type="button" className="linkish" onClick={() => setToAccountNumber(b.accountNumber)}>
                    {b.nickname} · {b.accountNumber}
                  </button>
                </li>
              ))}
            </ul>
            <div className="inline">
              <input placeholder="Nickname" value={benNickname} onChange={(e) => setBenNickname(e.target.value)} />
              <input placeholder="Account no." value={benAcct} onChange={(e) => setBenAcct(e.target.value)} />
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run("Beneficiary added", async () => {
                    await api.addBeneficiary(token, benNickname, benAcct);
                    setBenNickname("");
                    setBenAcct("");
                  })
                }
              >
                Add
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Bill pay</h2>
            <label>
              Biller
              <select value={billerCode} onChange={(e) => setBillerCode(e.target.value)}>
                {billers.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name} ({b.category})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Consumer / CA number
              <input value={consumerRef} onChange={(e) => setConsumerRef(e.target.value)} required />
            </label>
            <label>
              Amount (INR)
              <input value={billInr} onChange={(e) => setBillInr(e.target.value)} />
            </label>
            <label>
              Debit account
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !consumerRef}
              onClick={() =>
                run("Bill paid via ledger", async () => {
                  await api.payBill(token, {
                    fromAccountId: selectedId,
                    billerCode,
                    consumerRef,
                    amountPaise: Math.round(Number(billInr) * 100),
                  });
                })
              }
            >
              Pay bill
            </button>
          </section>
        </div>
      )}

      {tab === "cards" && (
        <section className="panel">
          <div className="row-between">
            <h2>Debit cards</h2>
            <button
              disabled={busy || !selectedId}
              onClick={() =>
                run("RuPay debit card issued (PAN tokenized)", async () => {
                  await api.issueCard(token, selectedId);
                })
              }
            >
              Issue RuPay card
            </button>
          </div>
          <p className="muted">PAN/CVV never stored — only last4 + vault token_ref.</p>
          <div className="cards">
            {cards.map((c) => (
              <div key={c.id} className={c.status === "blocked" ? "card blocked" : "card"}>
                <div className="card-net">{c.network}</div>
                <div className="card-pan">{c.maskedPan}</div>
                <div className="card-meta">
                  Linked {c.accountNumber} · {c.status}
                </div>
                {c.status === "active" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => run("Card blocked", async () => { await api.blockCard(token, c.id); })}
                  >
                    Block card
                  </button>
                )}
              </div>
            ))}
            {cards.length === 0 && <p className="muted">No cards yet.</p>}
          </div>
        </section>
      )}

      {tab === "profile" && (
        <section className="panel" style={{ maxWidth: 520 }}>
          <h2>KYC profile</h2>
          <p className="muted">Status: {profile?.kycStatus ?? "not started"}</p>
          <label>
            Date of birth
            <input
              type="date"
              value={kyc.dateOfBirth}
              onChange={(e) => setKyc({ ...kyc, dateOfBirth: e.target.value })}
            />
          </label>
          <label>
            Address
            <input
              value={kyc.addressLine}
              onChange={(e) => setKyc({ ...kyc, addressLine: e.target.value })}
              placeholder="Flat / street"
            />
          </label>
          <label>
            City
            <input value={kyc.city} onChange={(e) => setKyc({ ...kyc, city: e.target.value })} />
          </label>
          <label>
            State
            <input value={kyc.state} onChange={(e) => setKyc({ ...kyc, state: e.target.value })} />
          </label>
          <label>
            Pincode
            <input value={kyc.pincode} onChange={(e) => setKyc({ ...kyc, pincode: e.target.value })} />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              run("KYC submitted", async () => {
                await api.submitKyc(token, kyc);
              })
            }
          >
            Submit KYC
          </button>
        </section>
      )}
    </div>
  );
}
