/* eslint-disable */
const nock = require('nock')
const api = require('../../src/lib/config').api

const activeScopes = []

function addNock(url) {
  const scope = nock(url)
  activeScopes.push(scope)
  return scope
}

module.exports.clearAll = function() {
  activeScopes.length = 0
  // nock.cleanAll();
}

module.exports.checkPending = function() {
  const pendings = activeScopes.filter(itm => !itm.isDone())
  if (pendings.length > 0) throw new Error(`Pending Mock Http ${pendings}`)
}

module.exports.mockHandShake = function(
  baseUrl,
  code,
  response = null,
  numCall = 1
) {
  response = response || {
    access_token: 'fake',
    token_type: 'fake',
    expires_in: 3600,
    refresh_token: 'fake_also',
    _fakeId: code
  }
  addNock(baseUrl)
    .post(api.HAND_SHAKE_PATH, body => {
      return body.code === code
    })
    .times(numCall)
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockMatchingData = function(
  baseUrl,
  fakeId,
  response = null,
  numCall = 1
) {
  response = response || {
    id: fakeId || Date.now().toString()
  }

  addNock(baseUrl)
    .matchHeader('Authorization', 'fake')
    .get(api.MATCHING_INFO_PATH, body => {
      return true
    })
    .times(numCall)
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockSSoComplete = function(baseUrl, response = null) {
  response = response || {
    status: 'success'
  }

  addNock(baseUrl)
    .matchHeader('Authorization', 'fake')
    .post(api.SSO_COMPETE_PATH, body => {
      return true
    })
    .reply(200, response)
}

module.exports.mockQueryProofOfPath = function(baseUrl, response = null) {
  response = response || {
    status: 'success',
    proofList: {}
  }

  addNock(baseUrl)
    .post(api.GET_PROOF_OF_PATH, body => {
      return true
    })
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockQueryRefreshToken = function(baseUrl, response = null) {
  response = response || {
    access_token: 'fake',
    token_type: 'fake',
    expires_in: 3600,
    refresh_token: 'fake_also'
  }

  addNock(baseUrl)
    .post(api.REFRESH_TOKEN_PATH, body => {
      return true
    })
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockNoticeUser = function(baseUrl, response = null) {
  response = response || {}

  addNock(baseUrl)
    .post(api.NOTIFICATION_PATH, body => {
      return true
    })
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockDeactiveUser = function(baseUrl, response = null) {
  response = response || {}

  addNock(baseUrl)
    .post(api.DEACTIVE_USER_PATH, body => {
      return true
    })
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockQueryServiceMetadata = function(
  baseUrl,
  serviceId,
  response
) {
  nock(baseUrl)
    .persist()
    .get(api.META_DATA_PATH + serviceId)
    .reply(200, response)
}

module.exports.mockSignCertificate = function(baseUrl, response) {
  addNock(baseUrl)
    .put(api.CERTIFICATE_ACCEPT_PATH)
    .reply(200, {
      status: 'success',
      data: response
    })
}

module.exports.mockPublicKey = function(baseUrl, hash, response) {
  addNock(baseUrl)
    .get(api.PUBKEY_PATH + hash)
    .reply(200, response)
}

module.exports.mockPnPersist = function(baseUrl) {
  addNock(baseUrl)
    .persist()
    .post(api.REFRESH_TOKEN_PATH, body => true)
    .reply(200, {
      access_token: 'fake',
      token_type: 'fake',
      expires_in: 3600,
      refresh_token: 'fake_also'
    })

  addNock(baseUrl)
    .persist()
    .post(api.NOTIFICATION_PATH, body => true)
    .reply(200, {})
}
