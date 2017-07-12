'use strict'

const URL = require('url')
const crypto = require('crypto')
const Koa = require('koa')
const Router = require('koa-router')
const Parser = require('koa-bodyparser')
const Cors = require('koa-cors')
const ILP = require('ilp')
const Plugin = require('ilp-plugin-payment-channel-framework')
const { parseIlpToken } = require('./ilpToken')

const port = process.env.PORT || 3000
const ilpToken = process.env.ILP_TOKEN
const serverUrl = process.env.SERVER_URL
if (!ilpToken) {
  throw new Error('Cicadas don\'t live long, but while they do they require an ILP_TOKEN')
}
if (!serverUrl) {
  throw new Error('Cicadas don\'t live long, but while they do they need a SERVER_URL so they know where they\'re living')
}

// TODO add webhook URL

const app = new Koa()
const router = new Router()

const ilpCredentials = parseIlpToken(ilpToken)
const plugin = new Plugin(ilpCredentials)
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
      href: plugin.getInfo().prefix + 'client'
    }, {
      rel: 'https://interledger.org/rel/spsp/v2',
      href: serverUrl
    }]
  }
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.body = body
})

// RPC
router.post('/', async (ctx) => {
  console.log('got rpc request')
  const prefix = ctx.query.prefix
  const method = ctx.query.method
  const auth = ctx.request.headers.authorization

  if (typeof prefix !== 'string' || typeof auth !== 'string') {
    console.error('unauthorized rpc request', ctx.query, ctx.request.body)
    return ctx.throw(401)
  }
  if (!method) {
    return ctx.throw(400, 'method is required')
  }

  const [ , authToken ] = auth.match(/^Bearer (.+)$/) || []
  if (authToken !== ilpCredentials.token) {
    console.error('unauthorized rpc request', ctx.query, ctx.request.body)
    return ctx.throw(401)
  }

  try {
    ctx.body = await plugin.receive(method, ctx.request.body)
    console.log('sending response', ctx.body)
    ctx.status = 200
  } catch (err) {
    console.error('error processing rpc request', err)
    return ctx.throw(422, err.message)
  }
})

// SPSP
router.get('/', async (ctx) => {
  console.log('got spsp query')
  const ilpAddress = plugin.getInfo().prefix + 'client'
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
  console.log(ilpCredentials)
  await plugin.connect()
  await plugin.getInfo()
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
