'use strict'

const URL = require('url')

function makeIlpToken (rpcUri) {

  const base64 = Buffer.from(rpcUri, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return 'ilp_secret:' + base64
}

function parseIlpToken (string) {
  if (string.indexOf('ilp_secret:') === 0) {
    string = string.replace('ilp_secret:', '')
  }
  const uri = Buffer.from(string, 'base64').toString('utf8')
  let parsed = URL.parse(uri)
  parsed.rpcUri = URL.format({
    protocol: parsed.protocol,
    host: parsed.host,
    pathname: parsed.pathname,
    search: parsed.search
  })
  const auth = parsed.auth.split(':')
  parsed.prefix = auth[0]
  parsed.token = auth[1]
  return parsed
}

exports.makeIlpToken = makeIlpToken
exports.parseIlpToken = parseIlpToken

if (!module.parent) {
  console.log(makeIlpToken(process.argv[2]))
}
