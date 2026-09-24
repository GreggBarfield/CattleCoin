import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type Account as AccountData,
  type ContactInfo,
  CONTACT_KEYS,
  getMyAccount,
  updateMyContactInfo,
  changeMyPassword,
  passwordProblem,
} from "@/lib/account";

// Punch list fix #10 (D8): My Account, for every role. View username, email,
// role and member-since; edit contact info; change password. Email is
// view-only for now (it is part of the login token).

const ROLE_LABELS: Record<AccountData["role"], string> = {
  rancher: "Rancher",
  investor: "Investor",
  feedlot: "Feedlot",
  admin: "Administrator",
};

type ContactForm = Record<keyof ContactInfo, string>;

const FIELD_SETUP: {
  key: keyof ContactInfo;
  label: string;
  autoComplete: string;
  maxLength: number;
  wide?: boolean;
  type?: string;
}[] = [
  { key: "fullName", label: "Full name", autoComplete: "name", maxLength: 120 },
  { key: "businessName", label: "Business or ranch name", autoComplete: "organization", maxLength: 160 },
  { key: "phone", label: "Phone", autoComplete: "tel", maxLength: 40, type: "tel" },
  { key: "addressLine1", label: "Address line 1", autoComplete: "address-line1", maxLength: 160, wide: true },
  { key: "addressLine2", label: "Address line 2", autoComplete: "address-line2", maxLength: 160, wide: true },
  { key: "city", label: "City", autoComplete: "address-level2", maxLength: 80 },
  { key: "state", label: "State", autoComplete: "address-level1", maxLength: 40 },
  { key: "postalCode", label: "ZIP / postal code", autoComplete: "postal-code", maxLength: 20 },
];

function toForm(account: AccountData): ContactForm {
  const form = {} as ContactForm;
  for (const key of CONTACT_KEYS) form[key] = account[key] ?? "";
  return form;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function Account() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<ContactForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [contactMessage, setContactMessage] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyAccount()
      .then((data) => {
        if (cancelled) return;
        setAccount(data);
        setForm(toForm(data));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, "Could not load your account."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function editField(key: keyof ContactInfo, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setContactMessage(null);
    setContactError(null);
  }

  const dirty =
    account !== null &&
    form !== null &&
    CONTACT_KEYS.some((key) => form[key].trim() !== (account[key] ?? ""));

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !account) return;
    const changes: Partial<ContactForm> = {};
    for (const key of CONTACT_KEYS) {
      if (form[key].trim() !== (account[key] ?? "")) changes[key] = form[key];
    }
    if (Object.keys(changes).length === 0) {
      setContactMessage("No changes to save.");
      return;
    }
    setSaving(true);
    setContactError(null);
    setContactMessage(null);
    try {
      const updated = await updateMyContactInfo(changes);
      setAccount(updated);
      setForm(toForm(updated));
      setContactMessage("Contact information saved.");
    } catch (err) {
      setContactError(errorText(err, "Could not save your changes."));
    } finally {
      setSaving(false);
    }
  }

  function clearPwNotes() {
    setPwMessage(null);
    setPwError(null);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(currentPw, newPw, confirmPw);
    if (problem) {
      setPwError(problem);
      setPwMessage(null);
      return;
    }
    setChangingPw(true);
    clearPwNotes();
    try {
      await changeMyPassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMessage("Your password was changed. Use the new one next time you sign in.");
    } catch (err) {
      setPwError(errorText(err, "Could not change your password."));
    } finally {
      setChangingPw(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">My Account</h2>
        <p className="text-sm text-destructive" role="alert">{loadError}</p>
      </div>
    );
  }

  if (!account || !form) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">My Account</h2>
        <p className="text-sm text-muted-foreground">Loading your account...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">My Account</h2>
        <p className="text-sm text-muted-foreground">
          Your sign-in details, how to reach you, and your password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Username (used to sign in)</dt>
              <dd className="font-medium break-all">{account.username}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Account type</dt>
              <dd className="font-medium">{ROLE_LABELS[account.role] ?? account.role}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{account.email}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                To change your email, contact CattleCoin.
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Member since</dt>
              <dd className="font-medium">{formatDate(account.memberSince)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact information</CardTitle>
          <CardDescription>
            All optional. Clear a box and save to remove it.
            {account.profileUpdatedAt ? ` Last saved ${formatDate(account.profileUpdatedAt)}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveContact} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELD_SETUP.map((f) => (
                <div key={f.key} className={f.wide ? "space-y-2 sm:col-span-2" : "space-y-2"}>
                  <Label htmlFor={`acct-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`acct-${f.key}`}
                    type={f.type ?? "text"}
                    autoComplete={f.autoComplete}
                    maxLength={f.maxLength}
                    value={form[f.key]}
                    onChange={(e) => editField(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            {contactMessage && <p className="text-sm text-emerald-700" role="status">{contactMessage}</p>}
            {contactError && <p className="text-sm text-destructive" role="alert">{contactError}</p>}
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? "Saving..." : "Save contact information"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 8 characters. You stay signed in after changing it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="acct-current-pw">Current password</Label>
              <Input
                id="acct-current-pw"
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => { setCurrentPw(e.target.value); clearPwNotes(); }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="acct-new-pw">New password</Label>
                <Input
                  id="acct-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => { setNewPw(e.target.value); clearPwNotes(); }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acct-confirm-pw">New password again</Label>
                <Input
                  id="acct-confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => { setConfirmPw(e.target.value); clearPwNotes(); }}
                />
              </div>
            </div>
            {pwMessage && <p className="text-sm text-emerald-700" role="status">{pwMessage}</p>}
            {pwError && <p className="text-sm text-destructive" role="alert">{pwError}</p>}
            <Button type="submit" disabled={changingPw}>
              {changingPw ? "Changing..." : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
