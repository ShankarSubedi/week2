pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;
    signal input h;
    // var x=5;
    // log(x);
    // var y;
    // root <== x;
    // y <== root;
    // log(y);
    // log(555555);
    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves

    //var inputs[2**n]=[1,2,3,4 ];
    var answer[2**n][2**n];
    var level=0;

    component hashValues = Poseidon(2);

    for(var i = 0; i < leaves.length; i++){
        answer[level][i]=leaves[i];
    }

    for (var i = leaves.length/2; i > 0; i /= 2) {
        level+=1;
        for (var j = 0; j < i; j++) {
            answer[level-1][2 * j] ==> hashValues.inputs[0];
            answer[level-1][2 * j + 1] ==> hashValues.inputs[1];
            answer[level][j] = hashValues.out;
           //  answer[level][j]= answer[level-1][2 * j] + answer.[level-1][2 * j + 1];
        }
    }
     root <== answer[level][0];
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path

    var currentHash = leaf;
    component hashValues[n];// = Poseidon(2);
    for (var i = 0; i < n; i++) {
        // if (path_index[i])
        // {
        //     hashValues.inputs[0] <== currentHash;
        //     hashValues.inputs[1] <== path_elements[i];
        // }
        // else{
        //    path_elements[i] === hashValues.inputs[0];
        //    currentHash === hashValues.inputs[1];
        // }
        hashValues[i]=Poseidon(2);
        hashValues[i].inputs[0] <-- path_index[i] ? currentHash : path_elements[i];
        hashValues[i].inputs[1] <-- path_index[i] ? path_elements[i] : currentHash;

        currentHash = hashValues[i].out;
    }

    // component hashValues = Poseidon(2);
    // for (var i = 0; i < n; i++) {


    //    path_index[i] ? currentHash : path_elements[i] ==> hashValues.inputs[0];
    //    path_index[i] ? path_elements[i] : currentHash ==> hashValues.inputs[1];

    //     currentHash = hashValues.out;
    // }


    root <== currentHash;

}