import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Points at the ABI + bytecode Hardhat generated when it compiled HerdToken.sol.
const ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../Blockchain/artifacts/contracts/HerdToken.sol/HerdToken.json"
);

const { abi, bytecode } = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

const { AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

let provider = null;
let signer = null;

function getSigner() {
  if (signer) return signer;

  if (!AMOY_RPC_URL || !DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      "Blockchain not configured: set AMOY_RPC_URL and DEPLOYER_PRIVATE_KEY in .env"
    );
  }

  provider = new ethers.JsonRpcProvider(AMOY_RPC_URL);
  signer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  return signer;
}

// Turns a herd's UUID into a uint256 for the contract's on-chain herdId
// field. This is just a stable reference value stored in the contract - the
// real link between on-chain and off-chain records stays in
// token_pools.herd_id (a uuid), never in this derived number.
function herdIdToUint256(herdUuid) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(herdUuid));
  return BigInt(hash);
}

function makeSymbol(breedCode, herdUuid) {
  const prefix = (breedCode || "CTL").toUpperCase().slice(0, 3);
  const suffix = herdUuid.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `${prefix}${suffix}`;
}

// Deploys a brand-new HerdToken (ERC20) contract representing investor
// shares in one herd, minting the full initial supply to the platform's
// custodial wallet (this same signer). Individual investor allocations stay
// tracked off-chain in the `ownership` table for now, same as before this
// pass - this only gets the supply itself on-chain.
export async function deployHerdToken({ herdId, herdName, breedCode, totalSupply }) {
  const signer = getSigner();

  const name = herdName ? `CattleCoin - ${herdName}` : `CattleCoin Herd ${herdId}`;
  const symbol = makeSymbol(breedCode, herdId);
  const herdIdUint = herdIdToUint256(herdId);
  const ownerAddress = await signer.getAddress();

  // HerdToken uses the standard ERC20 18 decimals (not overridden in the
  // contract), so the raw supply needs scaling up for the on-chain total
  // supply to read as `totalSupply` whole tokens, not a near-zero fraction.
  const scaledSupply = ethers.parseUnits(String(totalSupply), 18);

  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(name, symbol, herdIdUint, scaledSupply, ownerAddress);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  return {
    contractAddress,
    txHash: deployTx ? deployTx.hash : null,
    name,
    symbol,
  };
}
// ── Sending tokens to investors ─────────────────────────────────────────────
// Only one send runs at a time. All sends come from the same platform wallet,
// and two at once would collide on the wallet's transaction counter.
let sendQueue = Promise.resolve();

const ERC20_ABI_SLICE = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

// Sends use their own connection with ethers' short-term answer cache turned off.
// With the cache on, two sends a fraction of a second apart can be given the same
// transaction number by the platform wallet, and the second one fails.
let sender = null;
function getSender() {
  if (sender) return sender;
  getSigner(); // same "Blockchain not configured" error as everywhere else
  const p = new ethers.JsonRpcProvider(AMOY_RPC_URL, undefined, { cacheTimeout: -1 });
  sender = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, p);
  return sender;
}

// Sends `tokens` whole tokens of one herd's contract from the platform wallet
// to an investor's wallet. Resolves with the transaction hash once confirmed.
export function transferHerdTokens({ contractAddress, toAddress, tokens }) {
  const run = async () => {
    const s = getSender();
    // A send to an address with no contract behind it "succeeds" on-chain but moves nothing,
    // for example when the database holds an address from a different network than this one.
    const code = await s.provider.getCode(contractAddress);
    if (!code || code === "0x") {
      throw new Error(`No token contract at ${contractAddress} on this network`);
    }
    const token = new ethers.Contract(contractAddress, ERC20_ABI_SLICE, s);
    const tx = await token.transfer(toAddress, ethers.parseUnits(String(tokens), 18));
    await tx.wait();
    return tx.hash;
  };
  const result = sendQueue.then(run, run);
  sendQueue = result.catch(() => {});
  return result;
}

// Whole-token balance of one wallet in one herd's contract (for display/checks).
export async function getHerdTokenBalance({ contractAddress, address }) {
  const s = getSigner();
  const token = new ethers.Contract(contractAddress, ERC20_ABI_SLICE, s);
  return ethers.formatUnits(await token.balanceOf(address), 18);
}
