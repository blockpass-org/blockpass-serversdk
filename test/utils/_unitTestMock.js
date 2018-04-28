const nock = require('nock')
const api = require('../config').api

module.exports.clearAll = function () {
    nock.cleanAll()
}

module.exports.checkPending = function () {
    const pendings = nock.pendingMocks();
    if (nock.pendingMocks().length > 0)
        throw new Error('Pending Mock Http ' + pendings)
}

module.exports.mockHandShake = function (baseUrl, code, response = null) {
    response = response || {
        access_token: 'fake',
        token_type: 'fake',
        expires_in: 3600,
        refresh_token: 'fake_also',
        _fakeId: code
    }
    nock(baseUrl)
        .post(api.HAND_SHAKE_PATH, (body) => {
            console.log(body, code)
            return body.code === code
        })
        .reply(200, response)
}

module.exports.mockMatchingData = function (baseUrl, fakeId, response = null, numCall = 1) {
    response = response || {
        id: fakeId || Date.now().toString()
    }
    
    nock(baseUrl)
        .matchHeader('Authorization', 'fake')
        .post(api.MATCHING_INFO_PATH, (body) => {
            return true
        })
        .times(numCall)
        .reply(200, response)
}

module.exports.mockSSoComplete = function (baseUrl, response = null) {
    response = response || {
        status: 'success'
    }

    nock(baseUrl)
        .matchHeader('Authorization', 'fake')
        .post(api.SSO_COMPETE_PATH, (body) => {
            return true
        })
        .reply(200, response)
}

module.exports.mockQueryProofOfPath = function (baseUrl, response = null) {
    response = response || {
        status: 'success',
        proofList: {}
    }

    nock(baseUrl)
        .post(api.GET_PROOF_OF_PATH, (body) => {
            return true
        })
        .reply(200, response)
}

module.exports.mockQueryRefreshToken = function (baseUrl, response = null) {
    response = response || {
        access_token: 'fake',
        token_type: 'fake',
        expires_in: 3600,
        refresh_token: 'fake_also',
    }

    nock(baseUrl)
        .post(api.REFRESH_TOKEN_PATH, (body) => {
            return true
        })
        .reply(200, response)
}