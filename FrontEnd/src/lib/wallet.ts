// The investor's own wallet: address, network, and per lot how many tokens were
// bought, whether they were delivered, and what the wallet holds on-chain.
// Sends the login token; the server works out who is asking from the token.
import { getAuthToken } from "@/context/AuthContext";

export class WalletApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type WalletDeliveryStatus = "delivered" | "sending" | "retrying" | "waiting" | "not_on_chain";

export type WalletPurchase = {
  transactionId: string;
  tokens: number;
  status: WalletDeliveryStatus;
  txHash: string | null;
  txUrl: string | null;
  purchasedAt: string;
};

export type WalletLot = {
  poolId: string;
  herdId: string | null;
  herdName: string;
  contractAddress: string | null;
  contractUrl: string | null;
  tokensPurchased: number;
  tokensDelivered: number;
  onChainBalance: number | null;
  purchases: WalletPurchase[];
};

export type MyWallet = {
  asOfIso: string;
  hasWallet: boolean;
  address: string | null;
  addressUrl: string | null;
  network: { chainId: number; name: string; isTestNetwork: boolean; explorerBase: string | null } | null;
  chainReachable: boolean;
  lots: WalletLot[];
};

export async function getMyWallet(): Promise<MyWallet> {
  const token = getAuthToken();
  const res = await fetch("/api/my-wallet", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep the default message */
    }
    throw new WalletApiError(res.status, msg);
  }
  return res.json() as Promise<MyWallet>;
}
