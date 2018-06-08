const request = require("superagent");
const api = require("./config").api;

class BlockpassHttpProvider {
  constructor(options) {
    const { baseUrl, clientId, secretId } = options || {};
    if (!baseUrl || !clientId || !secretId)
      throw new Error(
        "Missing argument. Must have fields: baseUrl, clientId, secretId"
      );
    this._baseUrl = baseUrl;
    this._clientId = clientId;
    this._secretId = secretId;
  }

  async queryServiceMetadata() {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const metaDataResponse = await request
        .get(_baseUrl + api.META_DATA_PATH + this._clientId)

      if (metaDataResponse.status !== 200) {
        console.error("[BlockPass] queryServiceMetadata Error", metaDataResponse.text);
        return null;
      }

      return metaDataResponse.body

    } catch (error) {
      console.error("queryServiceMetadata failed: ", error);
      return null;
    }
  }
  async doHandShake(code, session_code) {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const handShakeResponse = await request
        .post(_baseUrl + api.HAND_SHAKE_PATH)
        .send({
          client_id: _clientId,
          client_secret: _secretId,
          code,
          grant_type: "authoriaztioncode",
          session_code
        });

      if (handShakeResponse.status != 200) {
        console.error("[BlockPass] Handshake Error", handShakeResponse.text);
        return null;
      }

      return handShakeResponse.body;
    } catch (error) {
      console.error("Handshake failed: ", error);
      return null;
    }
  }

  async doMatchingData(handShakeToken) {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const userProfileResponse = await request
        .post(_baseUrl + api.MATCHING_INFO_PATH)
        .set({
          Authorization: handShakeToken.access_token
        })
        .send();

      if (userProfileResponse.status != 200) {
        console.error(
          "[BlockPass] UserProfile Response Error",
          userProfileResponse.text
        );
        return null;
      }

      return userProfileResponse.body;
    } catch (error) {
      console.error("Query Profile failed: ", error);
      return null;
    }
  }

  async notifyLoginComplete(bpToken, sessionData, extraData) {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const ssoCompleteResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          result: "success",
          custom_data: JSON.stringify({
            sessionData,
            extraData
          })
        });

      if (ssoCompleteResponse.status != 200) {
        console.error(
          "[BlockPass] SSoComplete Error",
          ssoCompleteResponse.text
        );
        return null;
      }

      return ssoCompleteResponse.body;
    } catch (error) {
      console.error("notifyLoginComplete failed: ", error);
      return null;
    }
  }

  async notifyLoginFailed(bpToken, error) {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const ssoCompleteResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          result: "failed",
          custom_data: JSON.stringify({
            sessionData,
            extraData
          })
        });

      if (ssoCompleteResponse.status != 200) {
        console.error(
          "[BlockPass] SSoComplete Error",
          ssoCompleteResponse.text
        );
        return null;
      }

      return ssoCompleteResponse.body;
    } catch (error) {
      console.error("notifyLoginComplete failed: ", error);
      return null;
    }
  }

  async _checkAndRefreshAccessToken(bpToken) {
    try {
      const { _clientId, _secretId, _baseUrl } = this;

      const now = new Date();
      if (bpToken.expires_at && bpToken.expires_at > now) return bpToken;

      const { access_token, refresh_token } = bpToken;
      const refreshTokenResponse = await request
        .post(_baseUrl + api.REFRESH_TOKEN_PATH)
        .send({
          stoc: access_token,
          stoc_refresh: refresh_token,
          client_secret: _secretId
        });

      if (refreshTokenResponse.status != 200) {
        console.error(
          "[BlockPass] Refreshkyc Error",
          refreshTokenResponse.text
        );
        return null;
      }

      return refreshTokenResponse.body;
    } catch (error) {
      console.error("_checkAndRefreshAccessToken failed: ", error);
      return null;
    }
  }

  async queryProofOfPath(bpToken, slug_list) {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken);
    const { _clientId, _secretId, _baseUrl } = this;

    try {
      const ssoQueryPathResponse = await request
        .post(_baseUrl + api.GET_PROOF_OF_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          slug_list
        });

      if (ssoQueryPathResponse.status != 200) {
        console.log(
          "[BlockPass] queryProofOfPath Error",
          ssoQueryPathResponse.text
        );
        return null;
      }

      return {
        proofOfPath: ssoQueryPathResponse.body,
        bpToken
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
  async notifyUser(bpToken, msg, title = 'Information') {
    // check refresh bpToken
    bpToken = await this._checkAndRefreshAccessToken(bpToken);
    const { _clientId, _secretId, _baseUrl } = this;

    try {
      const putCertResponse = await request
        .post(_baseUrl + api.NOTIFICATION_PATH)
        .set({
          Authorization: bpToken.access_token
        })
        .send({
          noti: {
            type: 'info',
            title,
            mssg: msg
          }
        });

      if (putCertResponse.status != 200) {
        console.log(
          "[BlockPass] notifyUser Error",
          putCertResponse.text
        );
        return null;
      }

      return {
        res: putCertResponse.body,
        bpToken
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}

module.exports = BlockpassHttpProvider;
