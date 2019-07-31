import * as bitcoin from 'bitcoinjs-lib'
import BigNumber from 'bignumber.js'
import Provider from '@atomicloans/provider'
import { addressToString, sleep } from '@liquality/utils'
import networks from '@liquality/bitcoin-networks'
import {
  calculateFee
} from '@liquality/bitcoin-utils'
import {
  hash160,
  sha256
} from '@liquality/crypto'

import { version } from '../package.json'

const OPS = bitcoin.script.OPS

export default class BitcoinCollateralProvider extends Provider {
  constructor (chain = { network: networks.bitcoin }, mode = { script: 'p2sh_p2wsh', address: 'p2sh_p2wpkh' }) {
    super()
    this._network = chain.network
    if (!['p2wsh', 'p2sh_p2wsh', 'p2sh'].includes(mode.script)) {
      throw new Error('Mode must be one of p2wsh, p2sh_p2wsh, p2sh')
    }
    if (!['p2wpkh', 'p2sh_p2wpkh', 'p2pkh'].includes(mode.address)) {
      throw new Error('Mode must be one of p2wpkh, p2sh_p2wpkh, p2pkh')
    }
    this._mode = mode
    if (this._network.name === networks.bitcoin.name) {
      this._bitcoinJsNetwork = bitcoin.networks.mainnet
    } else if (this._network.name === networks.bitcoin_testnet.name) {
      this._bitcoinJsNetwork = bitcoin.networks.testnet
    } else if (this._network.name === networks.bitcoin_regtest.name) {
      this._bitcoinJsNetwork = bitcoin.networks.regtest
    }
  }

  getPubKeyHash (address) {
    // TODO: wrapped segwit addresses not supported. Not possible to derive pubkeyHash from address
    try {
      const bech32 = bitcoin.address.fromBech32(address)
      return bech32.data
    } catch (e) {
      const base58 = bitcoin.address.fromBase58Check(address)
      return base58.hash
    }
  }

  pubKeyToAddress (pubkey) {
    const network = this._bitcoinJsNetwork
    if (this._mode.address === 'p2pkh') {
      return (bitcoin.payments.p2pkh({ pubkey, network })).address
    } else if (this._mode.address === 'p2sh_p2wpkh') {
      return (bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network })).address
    } else if (this._mode.address === 'p2wpkh') {
      return (bitcoin.payments.p2wpkh({ pubkey, network })).address
    }
  }

  getCollateralOutput (pubKeys, secretHashes, expirations, seizable) {
    const { borrowerPubKey, lenderPubKey, agentPubKey }            = pubKeys
    const { secretHashA1, secretHashA2 }                           = secretHashes
    const { secretHashB1, secretHashB2 }                           = secretHashes
    const { secretHashC1, secretHashC2 }                           = secretHashes
    const { loanExpiration, biddingExpiration, seizureExpiration } = expirations

    const borrowerPubKeyHash = hash160(borrowerPubKey)
    const lenderPubKeyHash = hash160(lenderPubKey)

    const seizablePubKeyHash = seizable ? lenderPubKeyHash : borrowerPubKeyHash

    return bitcoin.script.compile([
      OPS.OP_IF,
        OPS.OP_SIZE,
        bitcoin.script.number.encode(32),
        OPS.OP_EQUAL,
        OPS.OP_SWAP,
        OPS.OP_SHA256,
        Buffer.from(secretHashB1, 'hex'),
        OPS.OP_EQUAL,
        OPS.OP_ADD,
        OPS.OP_2,
        OPS.OP_EQUAL,
        OPS.OP_SWAP,
        OPS.OP_SIZE,
        bitcoin.script.number.encode(32),
        OPS.OP_EQUAL,
        OPS.OP_SWAP,
        OPS.OP_SHA256,
        Buffer.from(secretHashC1, 'hex'),
        OPS.OP_EQUAL,
        OPS.OP_ADD,
        OPS.OP_2,
        OPS.OP_EQUAL,
        OPS.OP_ADD,
        OPS.OP_1,
        OPS.OP_GREATERTHANOREQUAL,
        OPS.OP_VERIFY,
        OPS.OP_DUP,
        OPS.OP_HASH160,
        Buffer.from(borrowerPubKeyHash, 'hex'),
        OPS.OP_EQUALVERIFY,
        OPS.OP_CHECKSIG,
      OPS.OP_ELSE,
        OPS.OP_IF,
          OPS.OP_SIZE,
          bitcoin.script.number.encode(32),
          OPS.OP_LESSTHANOREQUAL,
          OPS.OP_VERIFY,
          OPS.OP_SHA256,
          Buffer.from(secretHashA2, 'hex'),
          OPS.OP_EQUAL,
          OPS.OP_SWAP,
          OPS.OP_SIZE,
          bitcoin.script.number.encode(32),
          OPS.OP_LESSTHANOREQUAL,
          OPS.OP_VERIFY,
          OPS.OP_SHA256,
          Buffer.from(secretHashB2, 'hex'),
          OPS.OP_EQUAL,
          OPS.OP_ADD,
          OPS.OP_SWAP,
          OPS.OP_SIZE,
          bitcoin.script.number.encode(32),
          OPS.OP_LESSTHANOREQUAL,
          OPS.OP_VERIFY,
          OPS.OP_SHA256,
          Buffer.from(secretHashC2, 'hex'),
          OPS.OP_EQUAL,
          OPS.OP_ADD,
          OPS.OP_2,
          OPS.OP_GREATERTHANOREQUAL,
          OPS.OP_VERIFY,
          bitcoin.script.number.encode(loanExpiration),
          OPS.OP_CHECKLOCKTIMEVERIFY,
          OPS.OP_DROP,
          OPS.OP_2,
          Buffer.from(borrowerPubKey, 'hex'),
          Buffer.from(lenderPubKey, 'hex'),
          Buffer.from(agentPubKey, 'hex'),
          OPS.OP_3,
          OPS.OP_CHECKMULTISIG,
        OPS.OP_ELSE,
          OPS.OP_IF,
            OPS.OP_SIZE,
            bitcoin.script.number.encode(32),
            OPS.OP_EQUALVERIFY,
            OPS.OP_SHA256,
            Buffer.from(secretHashA1, 'hex'),
            OPS.OP_EQUALVERIFY,
            bitcoin.script.number.encode(biddingExpiration),
            OPS.OP_CHECKLOCKTIMEVERIFY,
            OPS.OP_DROP,
            OPS.OP_DUP,
            OPS.OP_HASH160,
            Buffer.from(seizablePubKeyHash, 'hex'),
            OPS.OP_EQUALVERIFY,
            OPS.OP_CHECKSIG,
          OPS.OP_ELSE,
            bitcoin.script.number.encode(seizureExpiration),
            OPS.OP_CHECKLOCKTIMEVERIFY,
            OPS.OP_DROP,
            OPS.OP_DUP,
            OPS.OP_HASH160,
            Buffer.from(borrowerPubKeyHash, 'hex'),
            OPS.OP_EQUALVERIFY,
            OPS.OP_CHECKSIG,
          OPS.OP_ENDIF,
        OPS.OP_ENDIF,
      OPS.OP_ENDIF
    ])
  }

  getCollateralInput (sigs, period, secrets, pubKey) {
    if (!Array.isArray(sigs)) { sigs = [sigs]}

    let ifBranch
    if (period === 'loanPeriod') {
      ifBranch = [ OPS.OP_TRUE ]
    } else if (period === 'biddingPeriod') {
      ifBranch = [ OPS.OP_TRUE, OPS.OP_0 ]
    } else if (period === 'seizurePeriod') {
      ifBranch = [ OPS.OP_TRUE, OPS.OP_FALSE, OPS.OP_FALSE ]
    } else if (period === 'refundPeriod') {
      ifBranch = [ OPS.OP_FALSE, OPS.OP_FALSE, OPS.OP_FALSE ]
    }

    let secretParams = []
    for (let secret of secrets) {
      secretParams.unshift(secret === null ? Buffer.from('00', 'hex') : Buffer.from(secret, 'hex'))
    }

    const pubKeyParam = pubKey === null ? [] : [pubKey]
    const multisigParams = period === 'biddingPeriod' ? [OPS.OP_0] : []

    return bitcoin.script.compile([
      ...multisigParams,
      ...sigs,
      ...pubKeyParam,
      ...secretParams,
      ...ifBranch
    ])
  }

  getCollateralPaymentVariants (collateralOutput) {
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: { output: collateralOutput, network: this._bitcoinJsNetwork },
      network: this._bitcoinJsNetwork
    })
    const p2sh_p2wsh = bitcoin.payments.p2sh({
      redeem: p2wsh, network: this._bitcoinJsNetwork
    })
    const p2sh = bitcoin.payments.p2sh({
      redeem: { output: collateralOutput, network: this._bitcoinJsNetwork },
      network: this._bitcoinJsNetwork
    })

    return { p2wsh, p2sh_p2wsh, p2sh }
  }

  async lock (values, pubKeys, secretHashes, expirations) {
    const { refundableValue, seizableValue } = values

    const refundableOutput = this.getCollateralOutput(pubKeys, secretHashes, expirations, true)
    const seizableOutput = this.getCollateralOutput(pubKeys, secretHashes, expirations, false)

    const refundableAddress = this.getCollateralPaymentVariants(refundableOutput)[this._mode.script].address
    const seizableAddress = this.getCollateralPaymentVariants(seizableOutput)[this._mode.script].address

    return this.getMethod('sendBatchTransaction')([
      { to: refundableAddress, value: refundableValue },
      { to: seizableAddress, value: seizableValue }
    ])
  }

  async refund(txHash, pubKeys, secret, secretHashes, expirations) {
    const { secretHashB1, secretHashC1 } = secretHashes

    let secrets
    if      (sha256(secret) === secretHashB1) { secrets = [secret, null] }
    else if (sha256(secret) === secretHashC1) { secrets = [null, secret]}
    else                                      { throw new Error('Secret must match one of secretHashB1 or secretHashC1') }

    return this._refundAll(txHash, pubKeys, secrets, secretHashes, expirations, 'loanPeriod')
  }

  async multisigSign (txHash, pubKeys, secretHashes, expirations, party, to) {
    return this._multisigSign(txHash, pubKeys, secretHashes, expirations, party, to)
  }

  async multisigSend (txHash, sigs, pubKeys, secrets, secretHashes, expirations, to) {
    const { secretHashA2, secretHashB2, secretHashC2 } = secretHashes

    if (secrets.length !== 2) { throw new Error('You should only provide 2 secrets') }

    let orderedSecrets = [null, null, null]
    for (let secret of secrets) {
      if (sha256(secret) === secretHashA2) { orderedSecrets[0] = secret }
      if (sha256(secret) === secretHashB2) { orderedSecrets[1] = secret }
      if (sha256(secret) === secretHashC2) { orderedSecrets[2] = secret }
    }

    return this._multisigSend(txHash, sigs, pubKeys, orderedSecrets, secretHashes, expirations, to)
  }

  async _refundAll (initiationTxHash, pubKeys, secrets, secretHashes, expirations, period) {
    const { borrowerPubKey, lenderPubKey, agentPubKey } = pubKeys
    const network = this._bitcoinJsNetwork

    const pubKey = (period === 'seizurePeriod') ? lenderPubKey : borrowerPubKey
    const address = this.pubKeyToAddress(Buffer.from(pubKey, 'hex'))

    const wif = await this.getMethod('dumpPrivKey')(address)
    const wallet = bitcoin.ECPair.fromWIF(wif, network)

    const initiationTxRaw = await this.getMethod('getRawTransactionByHash')(initiationTxHash)
    const initiationTx = await this.getMethod('decodeRawTransaction')(initiationTxRaw)

    let ref = {} // Refundable Object
    let sei = {} // Seizable Object

    ref.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, true)
    sei.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, false)

    ref.colPaymentVariants = this.getCollateralPaymentVariants(ref.output)
    sei.colPaymentVariants = this.getCollateralPaymentVariants(sei.output)

    this.setPaymentVariants(initiationTx, ref)
    this.setPaymentVariants(initiationTx, sei)

    ref.colVout.txid = initiationTxHash
    sei.colVout.txid = initiationTxHash

    const tx = this.buildFullColTx(period, ref, sei, expirations, address)

    this.setHashForSigOrWit(tx, ref, 0)
    this.setHashForSigOrWit(tx, sei, 1)

    const refundableSig = bitcoin.script.signature.encode(wallet.sign(ref.sigHash), bitcoin.Transaction.SIGHASH_ALL)
    const seizableSig = bitcoin.script.signature.encode(wallet.sign(sei.sigHash), bitcoin.Transaction.SIGHASH_ALL)

    ref.colInput = this.getCollateralInput(refundableSig, period, secrets, pubKey)
    sei.colInput = this.getCollateralInput(seizableSig, period, secrets, pubKey)

    this.setHashForSigOrWit(tx, ref, 0)
    this.setHashForSigOrWit(tx, sei, 1)

    this.finalizeTx(tx, ref, 0)
    this.finalizeTx(tx, sei, 1)

    return this.getMethod('sendRawTransaction')(tx.toHex())
  }

  async _multisigSign (initiationTxHash, pubKeys, secretHashes, expirations, party, to) {
    const { borrowerPubKey, lenderPubKey, agentPubKey } = pubKeys
    const { loanExpiration, biddingExpiration, seizureExpiration } = expirations
    const period = 'biddingPeriod'
    const network = this._bitcoinJsNetwork

    const pubKey = party === 'lender' ? lenderPubKey : party === 'borrower' ? borrowerPubKey : agentPubKey
    const address = this.pubKeyToAddress(Buffer.from(pubKey, 'hex'))

    const wif = await this.getMethod('dumpPrivKey')(address)
    const wallet = bitcoin.ECPair.fromWIF(wif, network)

    const initiationTxRaw = await this.getMethod('getRawTransactionByHash')(initiationTxHash)
    const initiationTx = await this.getMethod('decodeRawTransaction')(initiationTxRaw)

    let ref = {} // Refundable Object
    let sei = {} // Seizable Object

    ref.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, true)
    sei.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, false)

    ref.colPaymentVariants = this.getCollateralPaymentVariants(ref.output)
    sei.colPaymentVariants = this.getCollateralPaymentVariants(sei.output)

    this.setPaymentVariants(initiationTx, ref)
    this.setPaymentVariants(initiationTx, sei)

    ref.colVout.txid = initiationTxHash
    sei.colVout.txid = initiationTxHash

    const tx = this.buildFullColTx(period, ref, sei, expirations, to)

    this.setHashForSigOrWit(tx, ref, 0)
    this.setHashForSigOrWit(tx, sei, 1)

    const refundableSig = (bitcoin.script.signature.encode(wallet.sign(ref.sigHash), bitcoin.Transaction.SIGHASH_ALL)).toString('hex')
    const seizableSig = (bitcoin.script.signature.encode(wallet.sign(sei.sigHash), bitcoin.Transaction.SIGHASH_ALL)).toString('hex')

    return { refundableSig, seizableSig }
  }

  async _multisigSend (initiationTxHash, sigs, pubKeys, secrets, secretHashes, expirations, to) {
    const { borrowerPubKey, lenderPubKey, agentPubKey } = pubKeys
    const period = 'biddingPeriod'
    const network = this._bitcoinJsNetwork

    const initiationTxRaw = await this.getMethod('getRawTransactionByHash')(initiationTxHash)
    const initiationTx = await this.getMethod('decodeRawTransaction')(initiationTxRaw)

    let ref = {} // Refundable Object
    let sei = {} // Seizable Object

    ref.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, true)
    sei.output = this.getCollateralOutput(pubKeys, secretHashes, expirations, false)

    ref.colPaymentVariants = this.getCollateralPaymentVariants(ref.output)
    sei.colPaymentVariants = this.getCollateralPaymentVariants(sei.output)

    this.setPaymentVariants(initiationTx, ref)
    this.setPaymentVariants(initiationTx, sei)

    ref.colVout.txid = initiationTxHash
    sei.colVout.txid = initiationTxHash

    const tx = this.buildFullColTx(period, ref, sei, expirations, to)

    ref.colInput = this.getCollateralInput(sigs.refundable, period, secrets, null)
    sei.colInput = this.getCollateralInput(sigs.seizable, period, secrets, null)

    this.setHashForSigOrWit(tx, ref, 0)
    this.setHashForSigOrWit(tx, sei, 1)

    this.finalizeTx(tx, ref, 0)
    this.finalizeTx(tx, sei, 1)

    return this.getMethod('sendRawTransaction')(tx.toHex())
  }

  setPaymentVariants (initiationTx, col) {
    for (const voutIndex in initiationTx._raw.data.vout) {
      const vout = initiationTx._raw.data.vout[voutIndex]
      const paymentVariantEntry = Object.entries(col.colPaymentVariants).find(([, payment]) => payment.output.toString('hex') === vout.scriptPubKey.hex)
      if (paymentVariantEntry) {
        col.paymentVariantName = paymentVariantEntry[0]
        col.paymentVariant = paymentVariantEntry[1]
        col.colVout = vout
      }
    }
  }

  buildFullColTx (period, ref, sei, expirations, to) {
    const { loanExpiration, biddingExpiration, seizureExpiration } = expirations
    const network = this._bitcoinJsNetwork

    ref.colVout.vSat = ref.colVout.value * 1e8
    sei.colVout.vSat = sei.colVout.value * 1e8

    const txb = new bitcoin.TransactionBuilder(network)

    if (period === 'biddingPeriod') {
      txb.setLockTime(loanExpiration)
    } else if (period === 'seizurePeriod') {
      txb.setLockTime(biddingExpiration)
    } else if (period === 'refundPeriod') {
      txb.setLockTime(seizureExpiration)
    }

    ref.prevOutScript = ref.paymentVariant.output
    sei.prevOutScript = sei.paymentVariant.output

    // TODO: Implement proper fee calculation that counts bytes in inputs and outputs
    // TODO: use node's feePerByte
    const txfee = calculateFee(6, 6, 14)

    txb.addInput(ref.colVout.txid, ref.colVout.n, 0, ref.prevOutScript)
    txb.addInput(sei.colVout.txid, sei.colVout.n, 0, sei.prevOutScript)
    txb.addOutput(addressToString(to), ref.colVout.vSat + sei.colVout.vSat - txfee)

    return txb.buildIncomplete()
  }

  setHashForSigOrWit (tx, col, i) {
    const network = this._bitcoinJsNetwork
    const needsWitness = col.paymentVariantName === 'p2wsh' || col.paymentVariantName === 'p2sh_p2wsh'

    if (needsWitness) {
      col.sigHash = tx.hashForWitnessV0(i, col.colPaymentVariants.p2wsh.redeem.output, col.colVout.vSat, bitcoin.Transaction.SIGHASH_ALL) // AMOUNT NEEDS TO BE PREVOUT AMOUNT
    } else {
      col.sigHash = tx.hashForSignature(i, col.paymentVariant.redeem.output, bitcoin.Transaction.SIGHASH_ALL)
    }
  }

  finalizeTx (tx, col, i) {
    const network = this._bitcoinJsNetwork
    const needsWitness = col.paymentVariantName === 'p2wsh' || col.paymentVariantName === 'p2sh_p2wsh'

    col.paymentParams = { redeem: { output: col.output, input: col.colInput, network }, network }

    col.paymentWithInput = needsWitness
      ? bitcoin.payments.p2wsh(col.paymentParams)
      : bitcoin.payments.p2sh(col.paymentParams)

    if (needsWitness) {
      tx.setWitness(i, col.paymentWithInput.witness)
    }

    if (col.paymentVariantName === 'p2sh_p2wsh') {
      // Adds the necessary push OP (PUSH34 (00 + witness script hash))
      col.inputScript = bitcoin.script.compile([col.colPaymentVariants.p2sh_p2wsh.redeem.output])
      tx.setInputScript(i, col.inputScript)
    } else if (col.paymentVariantName === 'p2sh') {
      tx.setInputScript(i, col.paymentWithInput.input)
    }
  }
}

BitcoinCollateralProvider.version = version
