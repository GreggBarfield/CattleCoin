import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyWallet, WalletApiError } from "@/lib/wallet";
import type { MyWallet, WalletDeliveryStatus } from "@/lib/wallet";

const STATUS_LABEL: Record<WalletDeliveryStatus, { text: string; className: string }> = {
  delivered: { text: "In your wallet", className: "bg-green-50 text-green-700 border-green-200" },
  sending: { text: "Sending", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  retrying: { text: "Will retry", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  waiting: { text: "Waiting", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  not_on_chain: { text: "Ledger only", className: "bg-slate-50 text-slate-600 border-slate-200" },
};

function shortAddress(a: string) {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function fmtTokens(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "");
}

// Rolls a lot's purchases up to one status: anything not yet delivered wins.
function lotStatus(purchases: { status: WalletDeliveryStatus }[]): WalletDeliveryStatus {
  const order: WalletDeliveryStatus[] = ["retrying", "waiting", "sending", "not_on_chain", "delivered"];
  for (const s of order) if (purchases.some((p) => p.status === s)) return s;
  return "delivered";
}

/**
 * Investor dashboard: the investor's wallet - address, network, and what each lot
 * holds. Loads its own data. Hidden entirely for anyone who is not an investor.
 */
export function WalletPanel() {
  const [wallet, setWallet] = useState<MyWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyWallet()
      .then((w) => alive && setWallet(w))
      .catch((err) => {
        if (!alive) return;
        // not an investor (or not logged in): this panel simply does not apply
        if (err instanceof WalletApiError && (err.status === 401 || err.status === 403)) setHidden(true);
        else setError("Could not load your wallet right now.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (hidden) return null;

  async function copyAddress() {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available - the full address is still on screen */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My Wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : wallet && !wallet.hasWallet ? (
          <p className="text-slate-600">
            Your wallet is created automatically with your first purchase. Once you buy tokens, the address and
            your tokens will show here.
          </p>
        ) : wallet ? (
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Wallet address</p>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <code className="font-mono text-xs break-all" data-testid="wallet-address">
                  {wallet.address}
                </code>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="px-2 py-1 text-xs rounded border bg-slate-50 hover:bg-slate-100"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                {wallet.addressUrl && (
                  <a
                    href={wallet.addressUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View on block explorer
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {wallet.network
                  ? `Network: ${wallet.network.name}.${wallet.network.isTestNetwork ? " Test tokens only - no real money." : ""}`
                  : "Network status unavailable right now."}
                {wallet.network && !wallet.network.explorerBase &&
                  " This network is private, so there is no public explorer page to link to."}
              </p>
            </div>

            {!wallet.chainReachable && wallet.lots.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                We could not reach the blockchain just now, so live balances are not shown. Your purchases below
                are safe in the ledger.
              </p>
            )}

            {wallet.lots.length === 0 ? (
              <p className="text-slate-600">No tokens yet. Tokens you buy will be sent to this wallet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1 pr-3 font-medium">Lot</th>
                      <th className="py-1 pr-3 font-medium text-right">Bought</th>
                      <th className="py-1 pr-3 font-medium text-right">In wallet now</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 font-medium">Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {wallet.lots.map((lot) => {
                      const st = STATUS_LABEL[lotStatus(lot.purchases)];
                      const hashes = lot.purchases.filter((p) => p.txHash);
                      return (
                        <tr key={lot.poolId} data-testid="wallet-lot">
                          <td className="py-2 pr-3">
                            <div className="font-medium">{lot.herdName}</div>
                            {lot.contractAddress && (
                              <div className="text-xs text-slate-500">
                                Token contract:{" "}
                                {lot.contractUrl ? (
                                  <a href={lot.contractUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                    {shortAddress(lot.contractAddress)}
                                  </a>
                                ) : (
                                  <span className="font-mono">{shortAddress(lot.contractAddress)}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right">{fmtTokens(lot.tokensPurchased)}</td>
                          <td className="py-2 pr-3 text-right">
                            {lot.onChainBalance == null ? "-" : fmtTokens(lot.onChainBalance)}
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`inline-block px-2 py-0.5 text-xs rounded border ${st.className}`}>
                              {st.text}
                            </span>
                          </td>
                          <td className="py-2 text-xs">
                            {hashes.length === 0 ? (
                              <span className="text-slate-400">-</span>
                            ) : (
                              hashes.map((p) =>
                                p.txUrl ? (
                                  <a key={p.transactionId} href={p.txUrl} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline">
                                    Transaction {p.txHash!.slice(0, 10)}...
                                  </a>
                                ) : (
                                  <span key={p.transactionId} className="block font-mono" title={p.txHash!}>
                                    Tx {p.txHash!.slice(0, 10)}...
                                  </span>
                                )
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
