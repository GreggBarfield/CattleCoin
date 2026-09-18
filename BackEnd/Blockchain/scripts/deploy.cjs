const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account found. Set DEPLOYER_PRIVATE_KEY in BackEnd/Blockchain/.env"
    );
  }

  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "MATIC");

  if (balance === 0n) {
    console.warn(
      "Warning: deployer balance is 0. Deployment will fail until this " +
        "wallet is funded with testnet MATIC from a faucet."
    );
  }

  const CattleNFT = await hre.ethers.getContractFactory("CattleNFT");
  const cattleNFT = await CattleNFT.deploy();
  await cattleNFT.waitForDeployment();

  const address = await cattleNFT.getAddress();
  console.log("CattleNFT deployed to:", address);

  if (hre.network.name === "amoy") {
    console.log(
      "View on explorer:",
      `https://amoy.polygonscan.com/address/${address}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
