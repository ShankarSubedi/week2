//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root
    uint public leafCount = 8;

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        /* our merkle tree looks like this..leaves are at the front 
           and combined hashes are appended  to the array
          [ leafnodes+ lower level nodes + .... + root ]
        */
        hashes = new uint256[](2 * 8 - 1);
        for (uint i = 0; i < leafCount; i++) {
            hashes[i] = 0;
        }
        for (uint i = 0; i < leafCount-1; i++) {
            hashes[leafCount + i] = PoseidonT3.poseidon([hashes[2*i], hashes[2*i+1]]);
        }

        root = hashes[hashes.length - 1];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        hashes[index] = hashedLeaf;
        //recompute the flattened merkel tree
        for (uint i = 0; i < leafCount-1; i++) {
            hashes[leafCount + i] = PoseidonT3.poseidon([hashes[2*i], hashes[2*i+1]]);
        }
        root = hashes[hashes.length - 1];
        return root;
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root
         return Verifier.verifyProof(a, b, c, input);
    }
}
