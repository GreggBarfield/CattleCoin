import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertCircle, Lock } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/common/StageBadge";
import { getHerdForInvest } from "@/lib/api";
import type { HerdInvestInfo } from "@/lib/types";
import { formatUsd } from "@/lib/utils";
import { price } from "@/lib/marketplace";
import { useAuth } from "@/context/AuthContext";

// Stripe singleton — initialised once outside render
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

// ── Card element styles to match the app's design system ──────────────────────
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "14px",
      color: "#0f172a",
      fontFamily: "inherit",
      "::placeholder": { color: "#94a3b8" },
    },
    invalid: { color: "#ef4444" },
  },
};

// ── Inner form — must be inside <Elements> to access useStripe/useElements ────
interface PaymentFormProps {
  herd: HerdInvestInfo;
  investorSlug: string;
  tokens: number;
  onSuccess: (message: string) => void;
}

function PaymentForm({ herd, investorSlug, tokens, onSuccess }: PaymentFormProps) {
  const stripe   = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const totalCost = tokens * herd.pricePerToken;

  async function handlePay(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    try {
      // Step 1 — ask backend to create a PaymentIntent
      const intentRes = await fetch("/api/invest/create-payment-intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ herdId: herd.herdId, investorSlug, tokensToBuy: tokens }),
      });
      if (!intentRes.ok) {
        const body = await intentRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create payment");
      }
      const { clientSecret } = await intentRes.json();

      // Step 2 — confirm card payment with Stripe
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: { card: cardElement } }
      );

      if (stripeError) throw new Error(stripeError.message ?? "Payment failed");
      if (paymentIntent?.status !== "succeeded") throw new Error("Payment not completed");

      // Step 3 — tell backend to record the investment (verifies with Stripe)
      const confirmRes = await fetch("/api/invest/confirm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to record investment");
      }
      const result = await confirmRes.json();
      onSuccess(result.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handlePay} className="space-y-5">
      {/* Investing as */}
      <div className="rounded-md bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
        <span className="text-muted-foreground">Investing as</span>
        <span className="font-medium">{investorSlug}</span>
      </div>

      {/* Card input */}
      <div className="space-y-1.5">
        <Label>Card details</Label>
        <div className="rounded-md border border-input bg-background px-3 py-2.5">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Lock className="h-3 w-3" /> Secured by Stripe — test card: 4242 4242 4242 4242
        </p>
      </div>

      {/* Total */}
      <div className="rounded-lg bg-slate-50 p-4 flex justify-between items-center">
        <span className="text-sm text-slate-600">Total charge</span>
        <span className="text-xl font-bold">{price(totalCost)}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-green-600 hover:bg-green-700 text-white"
      >
        {submitting ? "Processing…" : `Pay ${price(totalCost)}`}
      </Button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function InvestPage() {
  const { herdId }        = useParams<{ herdId: string }>();
  const navigate          = useNavigate();
  const { currentUser }   = useAuth();
  const investorSlug      = currentUser?.slug ?? "";

  const [herd, setHerd]           = useState<HerdInvestInfo | null>(null);
  const [loadingHerd, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tokens, setTokens]       = useState(1);
  const [success, setSuccess]     = useState<string | null>(null);
  // Controls whether the card form is shown (after user picks token count)
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    if (!herdId) return;
    setLoading(true);
    getHerdForInvest(herdId)
      .then((data) => { if (!data) setLoadError("Herd not found."); else setHerd(data); })
      .catch(() => setLoadError("Failed to load herd data."))
      .finally(() => setLoading(false));
  }, [herdId]);

  const handleSuccess = useCallback((message: string) => {
    setSuccess(message);
    setTimeout(() => navigate(`/investor/${investorSlug}/dashboard`), 3000);
  }, [navigate, investorSlug]);

  const tokensAvailable = herd?.tokensAvailable ?? 0;
  const inputInvalid    = tokens < 1 || tokens > tokensAvailable;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loadingHerd) {
    return (
      <div className="max-w-lg mx-auto p-8 space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (loadError || !herd) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
        <p className="text-slate-700">{loadError ?? "Herd not found."}</p>
        <Link to=".."><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
      </div>
    );
  }

  // ── Sold out ─────────────────────────────────────────────────────────────
  if (!herd.isAvailable) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center space-y-4">
        <Badge variant="outline" className="bg-slate-50 text-slate-600">Sold Out</Badge>
        <p className="text-slate-700"><strong>{herd.herdName}</strong> has no tokens remaining.</p>
        <Link to=".."><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1" />Back to Holdings</Button></Link>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
        <h2 className="text-xl font-semibold">Investment Confirmed!</h2>
        <p className="text-slate-600">{success}</p>
        <p className="text-sm text-slate-400">Redirecting to your dashboard…</p>
      </div>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <Link
        to={`/investor/${investorSlug}/holdings/${herd.herdId}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Herd Detail
      </Link>

      {/* Herd summary */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="text-lg">{herd.herdName}</CardTitle>
            <StageBadge stage={herd.dominantStage} />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-slate-500">Listing Price</span>
          <span className="font-medium">{formatUsd(herd.listingPrice)}</span>

          <span className="text-slate-500">Price per Token</span>
          <span className="font-medium">{price(herd.pricePerToken)}</span>

          <span className="text-slate-500">Tokens Available</span>
          <span className="font-medium">
            {herd.tokensAvailable.toLocaleString()} / {herd.investorAllocation.toLocaleString()}
          </span>

          {herd.investorPct != null && (
            <>
              <span className="text-slate-500">Investor Allocation</span>
              <span className="font-medium">{herd.investorPct}% of herd</span>
            </>
          )}

          <span className="text-slate-500">Risk Score</span>
          <span className="font-medium">
            {herd.riskScore != null ? herd.riskScore : "N/A"}
            <span className="text-xs text-slate-400 ml-1">(0 = low)</span>
          </span>
        </CardContent>
      </Card>

      {/* Step 1 — pick token count */}
      {!showPayment && (
        <Card>
          <CardHeader><CardTitle className="text-base">How many tokens?</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="tokens">
                Number of Tokens
                <span className="text-slate-400 font-normal ml-1">
                  (max {tokensAvailable.toLocaleString()})
                </span>
              </Label>
              <Input
                id="tokens"
                type="number"
                min={1}
                max={tokensAvailable}
                value={tokens}
                onChange={(e) => setTokens(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className={inputInvalid ? "border-red-400" : ""}
              />
              {inputInvalid && tokens > tokensAvailable && (
                <p className="text-xs text-red-500">
                  Only {tokensAvailable.toLocaleString()} tokens available.
                </p>
              )}
            </div>

            <div className="rounded-lg bg-slate-50 p-4 flex justify-between items-center">
              <span className="text-sm text-slate-600">Total cost</span>
              <span className="text-xl font-bold">{price(tokens * herd.pricePerToken)}</span>
            </div>

            <Button
              className="w-full"
              disabled={inputInvalid}
              onClick={() => setShowPayment(true)}
            >
              Proceed to Payment
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Stripe card form */}
      {showPayment && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Payment</CardTitle>
              <button
                onClick={() => setShowPayment(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Change tokens
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <Elements stripe={stripePromise}>
              <PaymentForm
                herd={herd}
                investorSlug={investorSlug}
                tokens={tokens}
                onSuccess={handleSuccess}
              />
            </Elements>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
