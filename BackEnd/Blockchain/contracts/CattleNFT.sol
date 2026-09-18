// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CattleNFT is ERC721, Ownable {
    uint256 public nextTokenId;

    struct Cattle {
        uint256 herdId;
        string dataHash;
    }

    mapping(uint256 => Cattle) public cattleData;
    mapping(uint256 => uint256[]) public herdToCattle;
    mapping(uint256 => address) public herdToToken;

    constructor()
        ERC721("CattleCoin", "COW")
        Ownable()   // no args - OZ v4 style, owner defaults to deployer
    {}

    function createCattle(
        address to,
        uint256 herdId,
        string memory dataHash
    ) external onlyOwner {
        uint256 tokenId = nextTokenId++;
        _mint(to, tokenId);
        cattleData[tokenId] = Cattle(herdId, dataHash);
        herdToCattle[herdId].push(tokenId);
    }

    function getHerd(uint256 herdId)
        external
        view
        returns (uint256[] memory)
    {
        return herdToCattle[herdId];
    }

    function setHerdToken(uint256 herdId, address tokenAddr)
        external
        onlyOwner
    {
        herdToToken[herdId] = tokenAddr;
    }

    function transferHerd(address from, address to, uint256 herdId)
        external
    {
        uint256[] memory cattleList = herdToCattle[herdId];
        for (uint i = 0; i < cattleList.length; i++) {
            transferFrom(from, to, cattleList[i]);
        }
    }
}