import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Points at the ABI Hardhat generated when it compiled CattleNFT.sol.
// BackEnd/src/blockchain -> ../.. -> BackEnd -> Blockchain/artifacts/...
const ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../Blockchain/artifacts/contracts/CattleNFT.sol/CattleNFT.json"
);

const { abi } = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));

const { AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY, CATTLE_NFT_ADDRESS } = process.env;

let provider = null;
let signer = null;
let cattleNFT = null;

function getContract() {
  if (cattleNFT) return cattleNFT;

  if (!AMOY_RPC_URL || !DEPLOYER_PRIVATE_KEY || !CATTLE_NFT_ADDRESS) {
    throw new Error(
      "Blockchain not configured: set AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY, and CATTLE_NFT_ADDRESS in .env"
    );
  }

  provider = new ethers.JsonRpcProvider(AMOY_RPC_URL);
  signer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  cattleNFT = new ethers.Contract(CATTLE_NFT_ADDRESS, abi, signer);

  return cattleNFT;
}

// Read-only sanity check: proves the backend can actually reach the
// deployed contract, without changing anything on-chain.
export async function getBlockchainStatus() {
  const contract = getContract();

  const network = await provider.getNetwork();
  const signerAddress = await signer.getAddress();

  const [owner, nextTokenId, signerBalance] = await Promise.all([
    contract.owner(),
    contract.nextTokenId(),
    provider.getBalance(signerAddress),
  ]);

  return {
    contractAddress: CATTLE_NFT_ADDRESS,
    network: { name: network.name, chainId: Number(network.chainId) },
    contractOwnerAddress: owner,
    backendSignerAddress: signerAddress,
    backendSignerBalance: ethers.formatEther(signerBalance) + " POL",
    nextTokenId: Number(nextTokenId),
  };
}

export { getContract };