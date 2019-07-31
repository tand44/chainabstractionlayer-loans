/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
import chai, { expect } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { chains, getUnusedPubKey, getCollateralParams } from '../common'
import config from '../config'
import { hash160 } from '@liquality/crypto'
import { pubKeyToAddress } from '@liquality/bitcoin-utils'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

chai.use(chaiAsPromised)
chai.use(require('chai-bignumber')())

function testCollateral (chain) {
  it('should allow locking and refunding', async () => {
    const colParams = await getCollateralParams(chain)
    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    const { refundableTxHash, seizableTxHash } = txId

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const refundParams = [txId, colParams.pubKeys, colParams.secrets.secretB1, colParams.secretHashes, colParams.expirations]

    const txId2 = await chain.client.loan.collateral.refund(...refundParams)

    expect(true).to.equal(true)
  })

  it('should allow multisig signing', async () => {
    const colParams = await getCollateralParams(chain)

    const loanExpiration = Math.floor((new Date()).getTime() / 1000)
    colParams.expirations.loanExpiration = loanExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const to = await chain.client.getMethod('getNewAddress')('p2sh-segwit')

    const multisigParams = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations, 'borrower', to]

    const sig = await chain.client.loan.collateral.multisigSign(...multisigParams)

    expect(true).to.equal(true)
  })

  it('should allow multisig signing and sending', async () => {
    const colParams = await getCollateralParams(chain)

    const loanExpiration = Math.floor((new Date()).getTime() / 1000) - 1000
    colParams.expirations.loanExpiration = loanExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const to = await chain.client.getMethod('getNewAddress')('p2sh-segwit')

    const multisigBorrowerParams = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations, 'borrower', to]
    const borrowerSigs = await chain.client.loan.collateral.multisigSign(...multisigBorrowerParams)

    const multisigParamsLender = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations, 'lender', to]
    const lenderSigs = await chain.client.loan.collateral.multisigSign(...multisigParamsLender)

    const sigs = {
      refundable: [Buffer.from(borrowerSigs.refundableSig, 'hex'), Buffer.from(lenderSigs.refundableSig, 'hex')],
      seizable: [Buffer.from(borrowerSigs.seizableSig, 'hex'), Buffer.from(lenderSigs.seizableSig, 'hex')]
    }

    await chain.client.loan.collateral.multisigSend(txId, sigs, colParams.pubKeys, [colParams.secrets.secretA2, colParams.secrets.secretB2], colParams.secretHashes, colParams.expirations, to)

    expect(true).to.equal(true)
  })

  it('should allow seizure', async () => {
    const colParams = await getCollateralParams(chain)

    const biddingExpiration = Math.floor((new Date()).getTime() / 1000) - 1000
    colParams.expirations.biddingExpiration = biddingExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const seizeParams = [txId, colParams.pubKeys, colParams.secrets.secretA1, colParams.secretHashes, colParams.expirations]

    const txId2 = await chain.client.loan.collateral.seize(...seizeParams)
  })

  it('should allow reclaiming of seizable collateral', async () => {
    const colParams = await getCollateralParams(chain)

    const seizureExpiration = Math.floor((new Date()).getTime() / 1000) - 1000
    colParams.expirations.seizureExpiration = seizureExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const reclaimOneParams = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations, true]

    const txId2 = await chain.client.loan.collateral.reclaimOne(...reclaimOneParams)
  })

  it('should allow reclaiming of refundable collateral', async () => {
    const colParams = await getCollateralParams(chain)

    const seizureExpiration = Math.floor((new Date()).getTime() / 1000) - 1000
    colParams.expirations.seizureExpiration = seizureExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const reclaimOneParams = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations, false]

    const txId2 = await chain.client.loan.collateral.reclaimOne(...reclaimOneParams)
  })

  it('should allow reclaiming of all collateral', async () => {
    const colParams = await getCollateralParams(chain)

    const seizureExpiration = Math.floor((new Date()).getTime() / 1000) - 1000
    colParams.expirations.seizureExpiration = seizureExpiration

    const lockParams = [colParams.values, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId = await chain.client.loan.collateral.lock(...lockParams)

    await chains.bitcoinWithNode.client.chain.generateBlock(1)

    const reclaimParams = [txId, colParams.pubKeys, colParams.secretHashes, colParams.expirations]

    const txId2 = await chain.client.loan.collateral.reclaimAll(...reclaimParams)
  })
}

describe('Collateral Flow', function () {
  this.timeout(config.timeout)

  describe('Bitcoin - Node', () => {
    testCollateral(chains.bitcoinWithNode)
  })
})