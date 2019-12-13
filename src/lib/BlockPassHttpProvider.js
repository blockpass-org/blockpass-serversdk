const request = require('superagent')
const { api, SDKAuthCode } = require('./config')

class BlockpassHttpProvider {
  constructor (options) {
    const { baseUrl, clientId, secretId } = options || {}
    if (!baseUrl || !clientId || !secretId) {
      throw new Error(
        'Missing argument. Must have fields: baseUrl, clientId, secretId'
      )
    }
    this._baseUrl = baseUrl
    this._clientId = clientId
    this._secretId = secretId
  }

  async queryPublicKey (hash) {
    try {
      // remove begin slash
      if (hash.startsWith('/')) hash = hash.substr(1, hash.length)

      const { _baseUrl } = this

      const pubKeyResponse = await request.get(
        _baseUrl + api.PUBKEY_PATH + hash
      )

      if (pubKeyResponse.status !== 200) {
        console.error('[BlockPass] queryPublicKey Error', pubKeyResponse.text)
        return null
      }

      return pubKeyResponse.body
    } catch (error) {
      console.error('queryPublicKey failed: ', error)
      return null
    }
  }

  async queryServiceMetadata () {
    try {
      const { _secretId, _baseUrl } = this

      const metaDataResponse = await request
        .get(_baseUrl + api.META_DATA_PATH + this._secretId)
        .set({
          Authorization: SDKAuthCode,
          'x-client-secret': _secretId
        })

      if (metaDataResponse.status !== 200) {
        console.error(
          '[BlockPass] queryServiceMetadata Error',
          metaDataResponse.text
        )
        return null
      }

      return metaDataResponse.body
    } catch (error) {
      console.error('queryServiceMetadata failed: ', error)
      return null
    }
  }

  async queryCertificateSchema (cerId) {
    try {
      const { _baseUrl } = this

      const url = _baseUrl + api.CERTIFICATE_SCHEMA + cerId
      const metaDataResponse = await request.get(url)

      if (metaDataResponse.status !== 200) {
        console.error(
          '[BlockPass] queryCertificateSchema Error',
          metaDataResponse.text
        )
        return null
      }

      const schemaContent = metaDataResponse.body

      schemaContent.url = url
      return schemaContent
    } catch (error) {
      console.error('queryCertificateSchema failed: ', error)
      return null
    }
  }

  async doHandShake (code, session_code) {
    try {
      const { _clientId, _secretId, _baseUrl } = this

      const handShakeResponse = await request
        .post(_baseUrl + api.HAND_SHAKE_PATH)
        .send({
          client_id: _clientId,
          client_secret: _secretId,
          code,
          grant_type: 'authoriaztioncode',
          session_code
        })

      if (handShakeResponse.status !== 200) {
        console.error('[BlockPass] Handshake Error', handShakeResponse.text)
        return null
      }

      return handShakeResponse.body.data
    } catch (error) {
      console.error('Handshake failed: ', error)
      return null
    }
  }

  async doMatchingData (handShakeToken) {
    try {
      const { _baseUrl } = this

      const userProfileResponse = await request
        .get(_baseUrl + api.MATCHING_INFO_PATH)
        .set({
          Authorization: handShakeToken.access_token
        })
        .send()

      if (userProfileResponse.status !== 200) {
        console.error(
          '[BlockPass] UserProfile Response Error',
          userProfileResponse.text
        )
        return null
      }

      return userProfileResponse.body.data
    } catch (error) {
      console.error('Query Profile failed: ', error)
      return null
    }
  }

  async notifyLoginComplete (bpToken, sessionData, extraData) {
    try {
      const { _baseUrl } = this

      const ssoCompleteResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          result: 'success',
          custom_data: JSON.stringify({
            sessionData,
            extraData
          })
        })

      if (ssoCompleteResponse.status !== 200) {
        console.error('[BlockPass] SSoComplete Error', ssoCompleteResponse.text)
        return null
      }

      return ssoCompleteResponse.body
    } catch (error) {
      console.error('notifyLoginComplete failed: ', error)
      return null
    }
  }

  async notifyLoginFailed (bpToken, errorData) {
    try {
      const { _baseUrl } = this

      const ssoCompleteResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          result: 'failed',
          custom_data: JSON.stringify({
            errorData
          })
        })

      if (ssoCompleteResponse.status !== 200) {
        console.error('[BlockPass] SSoComplete Error', ssoCompleteResponse.text)
        return null
      }

      return ssoCompleteResponse.body
    } catch (error) {
      console.error('notifyLoginComplete failed: ', error)
      return null
    }
  }

  async _checkAndRefreshAccessToken (bpToken) {
    try {
      const { _secretId, _baseUrl } = this

      const now = new Date()
      if (bpToken.expires_at && bpToken.expires_at > now) return bpToken

      const { access_token, refresh_token } = bpToken
      const refreshTokenResponse = await request
        .post(_baseUrl + api.REFRESH_TOKEN_PATH)
        .send({
          stoc: access_token,
          stoc_refresh: refresh_token,
          client_secret: _secretId
        })

      if (refreshTokenResponse.status !== 200) {
        console.error('[BlockPass] Refreshkyc Error', refreshTokenResponse.text)
        return null
      }

      return refreshTokenResponse.body.data
    } catch (error) {
      console.error('_checkAndRefreshAccessToken failed: ', error)
      return null
    }
  }

  async queryProofOfPath (bpToken, slug_list) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const ssoQueryPathResponse = await request
        .post(_baseUrl + api.GET_PROOF_OF_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          slug_list
        })

      if (ssoQueryPathResponse.status !== 200) {
        console.log(
          '[BlockPass] queryProofOfPath Error',
          ssoQueryPathResponse.text
        )
        return null
      }

      return {
        proofOfPath: ssoQueryPathResponse.body.data,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async acceptCertificate (bpToken, cerDocument) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const putCertResponse = await request
        .put(_baseUrl + api.CERTIFICATE_ACCEPT_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send(cerDocument)

      if (putCertResponse.status !== 200) {
        console.log('[BlockPass] acceptCertificate Error', putCertResponse.text)
        return null
      }

      return {
        res: putCertResponse.body.data,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async notifyUser (bpToken, msg, action = '', type = 'info') {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const putCertResponse = await request
        .post(_baseUrl + api.NOTIFICATION_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          type,
          action,
          mssg: msg
        })

      if (putCertResponse.status !== 200) {
        console.log('[BlockPass] notifyUser Error', putCertResponse.text)
        return null
      }

      return {
        res: putCertResponse.body,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async deactivateUser (bpToken) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const deactiveResponse = await request
        .post(_baseUrl + api.DEACTIVE_USER_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send()

      if (deactiveResponse.status !== 200) {
        console.log('[BlockPass] deactivateUser Error', deactiveResponse.text)
        return null
      }

      return {
        res: deactiveResponse.body,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async fetchCertPromise (bpToken) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const certPromiseResponse = await request
        .get(_baseUrl + api.FETCH_CERT_PROMISE_PATH)
        .set({
          Authorization: bpToken.access_token
        })

      if (certPromiseResponse.status !== 200) {
        console.log(
          '[BlockPass] fetchCertPromise Error',
          certPromiseResponse.text
        )
        return null
      }

      return {
        res: certPromiseResponse.body,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async pullCertPromise (bpToken, certPromiseId) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this

    try {
      const certPromiseResponse = await request
        .get(_baseUrl + api.PULL_CERT_PROMISE_PATH + '/' + certPromiseId)
        .set({
          Authorization: bpToken.access_token
        })

      if (certPromiseResponse.status !== 200) {
        console.log(
          '[BlockPass] pullCertPromise Error',
          certPromiseResponse.text
        )
        return null
      }

      return {
        res: certPromiseResponse.body,
        bpToken
      }
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async checkCertificateHash ({ bpToken, certHash }) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken)
    const { _baseUrl } = this
    try {
      const certHashResponse = await request
        .get(_baseUrl + api.CHECK_CERT_HASH_PATH + '/' + certHash)
        .set({
          Authorization: bpToken.access_token
        })
      if (certHashResponse.status !== 200) {
        console.log(
          '[BlockPass] checkCertificateHash Error',
          certHashResponse.text
        )
        return null
      }

      return {
        res: certHashResponse.body,
        bpToken
      }
    } catch (error) {
      console.error(error)
      throw error
    }
  }
}

module.exports = BlockpassHttpProvider
