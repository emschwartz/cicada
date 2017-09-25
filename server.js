'use strict'

const URL = require('url')
const crypto = require('crypto')
const Koa = require('koa')
const Router = require('koa-router')
const Parser = require('koa-bodyparser')
const Cors = require('koa-cors')
const ILP = require('ilp')
const WebSocket = require('ws')
const EventEmitter = require('events')
const btp = require('btp-packet')
const base64url = require('base64url')

const port = process.env.PORT || 3000
const btpServerUrl = process.env.BTP_SERVER_URL
const ilpCredentialsString = process.env.ILP_CREDENTIALS
const spspServerUrl = process.env.SPSP_SERVER_URL


class Plugin extends EventEmitter {
  constructor (ws) {
    super()
    this.ws = null
  }

  connect () {

  }

  getInfo () {
    return {
      prefix: 'test.blah.',
      currencyCode: 'xyz',
      currencyScale: 6
    }
  }

  getAccount () {
    return 'test.blah.server'
  }

  addSocket(stream) {
    this.ws = stream
    this.ws.on('message', (message) => this.handleMessage(message))
  }

  handleMessage (message) {
    if (!message || message.length === 0) {
      return
    }
    const packet = btp.deserialize(message)
    console.log('got packet', JSON.stringify(packet, null, 2))
    switch (packet.type) {
      case btp.TYPE_PREPARE:
        this.ws.send(btp.serializeResponse(packet.requestId, []))

        this.emit('incoming_prepare', {
          id: packet.data.transferId,
          amount: packet.data.amount,
          executionCondition: packet.data.executionCondition,
          expiresAt: packet.data.expiresAt,
          ilp: base64url(packet.data.protocolData[0].data),
          custom: {},
          noteToSelf: {}
        })
        break
      default:
        throw new Error('unknown message type')
        break
    }

  }

  fulfillCondition(transferId, fulfillment) {
    const packet = btp.serializeFulfill({
      transferId,
      fulfillment,
    }, 1, [])
    this.ws.send(packet)
    console.log('sent fulfillment', transferId, fulfillment)
    return Promise.resolve()
  }

  rejectIncomingTransfer(transferId, rejectionReason) {
    console.log('rejected transfer with reason', rejectionReason)
  }
}
const plugin = new Plugin()

// TODO add webhook URL

const app = new Koa()
const router = new Router()

const secret = crypto.randomBytes(32)

// Webfinger
router.get('/.well-known/webfinger', (ctx) => {
  const body = {
    subject: ctx.request.query.resource,
    links: [{
      rel: 'https://interledger.org/rel/ledgerUri',
      href: 'there is no ledger'
    }, {
      rel: 'https://interledger.org/rel/ilpAddress',
      href: plugin.getAccount()
    }, {
      rel: 'https://interledger.org/rel/spsp/v2',
      href: spspServerUrl
    }]
  }
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.body = body
})

// SPSP
router.get('/', async (ctx) => {
  console.log('got spsp query')
  const ilpAddress = plugin.getAccount()
  const psk = ILP.PSK.generateParams({
    destinationAccount: ilpAddress,
    receiverSecret: secret
  })

  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.body = {
    destination_account: psk.destinationAccount,
    shared_secret: psk.sharedSecret,
    maximum_destination_amount: '99999999', // TODO change this
    minimum_destination_amount: '1',
    ledger_info: {
      currency_code: plugin.getInfo().currencyCode,
      currency_scale: plugin.getInfo().currencyScale
    },
    // TODO add reciever info
    receiver_info: {
      name: 'Cicada',
      image_url: 'https://i.imgur.com/fGrYkX6.jpg',
      identifier: ''
    }
  }
})

app
  .use(Parser())
  .use(Cors({
    origin: '*',
    methods: ['GET', 'POST']
  }))
  .use(router.routes())
  .use(router.allowedMethods())

async function main () {
  const wss = new WebSocket.Server({ port: 8080 })
  wss.on('connection', (ws) => {
    plugin.addSocket(ws)
  })
  await plugin.connect()
  console.log('plugin connected')
  plugin.on('error', (err) => {
    console.error('plugin error:', err)
  })

  await ILP.PSK.listen(plugin, {
    receiverSecret: secret
  }, async (incomingPayment) => {
    // TODO add webhook
    try {
      await incomingPayment.fulfill()
    } catch (err) {
      console.error('error fulfilling incoming payment', incomingPayment, err)
    }
    console.log('got incoming payment', incomingPayment)
  })

  app.listen(port)
  console.log('cicada chirping on: ' + port)
}

main().catch(err => console.error(err))
