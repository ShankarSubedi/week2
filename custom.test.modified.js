// [assignment] please copy the entire modified custom.test.js here

const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
      // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    //store public key and private key of Alice
    const aliceKeypair = new Keypair() 

    // Alice deposits 0.1ETH into tornado pool--L1
    const aliceDepositAmount = utils.parseEther('0.1')
    //generate Utxo tokens
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    )
    // emulating the bridge which first sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ])

    // Alice withdraws 0.08ETH from the shielded pool---L2
    const aliceWithdrawAmount = utils.parseEther('0.08')
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),  //this subtracts amount from alice account which also requires alice keyPairs
      keypair: aliceKeypair,
    })
    await transaction({     //this transaction takes aliceDepositUtxo as input because action to be performed is deposit by alice
      tornadoPool,          //and outputs the chnage as done by aliceChangeUtxo
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
    })

    //previously receipent amount must be zero
    const receivedAmount = await token.balanceOf(recipient)
    expect(receivedAmount).to.be.equal(0)
    // Balance in the L1 omni bridge must be equal to the one send by Alice
    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(aliceWithdrawAmount)
  })

  it('[assignment] iii. see assignment doc for details', async () => {
      // [assignment] complete code here
    const { tornadoPool, token } = await loadFixture(fixture)

    // Alice deposits into tornado pool--L1
    const aliceKeypair = new Keypair();
    const aliceDepositAmount = utils.parseEther('0.13')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount ,keypair: aliceKeypair})
    await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    // Generate private and public key for Bob
    const bobKeypair = new Keypair() 

    // extract public key of bob. Bob gives Alice this to send some eth inside the shielded pool
    const bobAddress = bobKeypair.address() 

    // Alice sends some funds to Bob-- L2
    const bobSendAmount = utils.parseEther('0.06')
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(bobSendAmount),
      keypair: aliceDepositUtxo.keypair,
    })
    await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] })

    // Bob parses chain to find out incoming amount
    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)
    let bobReceiveUtxo
    try {
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      // let's decrypt another output as outputs are suffeled before sending to blockchain
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
    }
    expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)

    // Bob withdraws all his funds from the shielded pool--L2. his remaining amount is 0.06
    const bobDrawnAmount = utils.parseEther('0.06')
    const bobEtheriumAddress = '0xDeaD00000000000000000000000000000000BEEf'
    const bobChangeUtxo = new Utxo({ amount: bobSendAmount.sub(bobDrawnAmount), keypair: bobKeypair })
    await transaction({
      tornadoPool,
      inputs: [bobReceiveUtxo],
      outputs: [bobChangeUtxo],
      recipient: bobEtheriumAddress,
    })

    //withdrawn amount by bob must be equal to the amount in his A/C as he withdraw all amount
    const bobAmount = await token.balanceOf(bobEtheriumAddress)
    expect(bobAmount).to.be.equal(bobDrawnAmount)

    //alice withdraws all the remaing amount in L1 which is 0.07
    const aliceTotalBalance = utils.parseEther('0.07');
    const aliceEtheriumAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    await transaction({
      tornadoPool,
      inputs: [aliceChangeUtxo],
      recipient: aliceEtheriumAddress,
    })
    const aliceBalance = await token.balanceOf(aliceEtheriumAddress)
    expect(aliceBalance).to.be.equal(aliceTotalBalance)
  })
})
