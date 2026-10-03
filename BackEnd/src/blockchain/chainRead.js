// Read-only questions to the blockchain node, for showing an investor what their
// wallet holds. Plain JSON-RPC calls with a short time limit instead of an ethers
// provider: ethers keeps retrying a node that is down (and logs about it forever),
// while a dashboard page must answer quickly either way. Never throws - when the
// node cannot be reached the answer is null and the page says so.

const TIMEOUT_MS = 4000;

async function rpc(method, params) {
  const url = process.env.AMOY_RPC_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body.result === "string" ? body.result : null;
  } catch {
    return null;
  }
}

// The network's id number (80002 = Polygon Amoy test network, 31337 = Hardhat), or null.
export async function readChainId() {
  const hex = await rpc("eth_chainId", []);
  if (!hex) return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

// Whole tokens that `address` holds in the token contract `contractAddress`
// (18 decimals, same as HerdToken), or null if it cannot be read right now.
export async function readTokenBalance({ contractAddress, address }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress || "")) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) return null;
  // balanceOf(address) = selector 0x70a08231 + the address padded to 32 bytes
  const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const hex = await rpc("eth_call", [{ to: contractAddress, data }, "latest"]);
  // "0x" back means there is no token contract at that address on this network
  // (for example the database holds an address from a different network): unknown, not zero.
  if (!hex || hex === "0x" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  const raw = BigInt(hex);
  const whole = raw / 10n ** 18n;
  const frac = raw % 10n ** 18n;
  // keep it a plain number; a fraction only appears if someone moved part of a token
  return Number(whole) + Number(frac) / 1e18;
}

// What to call the network and where (if anywhere) the public block explorer is.
// A private test network has no explorer, so no links are offered for it.
export function describeNetwork(chainId) {
  if (chainId === 80002) {
    return { chainId, name: "Polygon Amoy (public test network)", isTestNetwork: true, explorerBase: "https://amoy.polygonscan.com" };
  }
  if (chainId === 137) {
    return { chainId, name: "Polygon", isTestNetwork: false, explorerBase: "https://polygonscan.com" };
  }
  if (chainId === 31337) {
    return { chainId, name: "Private test network (demo)", isTestNetwork: true, explorerBase: null };
  }
  if (chainId == null) return null;
  return { chainId, name: `Network ${chainId}`, isTestNetwork: true, explorerBase: null };
}
