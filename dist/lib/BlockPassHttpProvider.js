"use strict";

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const request = require("superagent");
const api = require("./config").api;

class BlockpassHttpProvider {
  constructor(options) {
    var _ref = options || {};

    const baseUrl = _ref.baseUrl,
          clientId = _ref.clientId,
          secretId = _ref.secretId;

    if (!baseUrl || !clientId || !secretId) throw new Error("Missing argument. Must have fields: baseUrl, clientId, secretId");
    this._baseUrl = baseUrl;
    this._clientId = clientId;
    this._secretId = secretId;
  }

  doHandShake(code, session_code) {
    var _this = this;

    return _asyncToGenerator(function* () {
      try {
        const _clientId = _this._clientId,
              _secretId = _this._secretId,
              _baseUrl = _this._baseUrl;


        const handShakeResponse = yield request.post(_baseUrl + api.HAND_SHAKE_PATH).send({
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
    })();
  }

  doMatchingData(handShakeToken) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      try {
        const _clientId = _this2._clientId,
              _secretId = _this2._secretId,
              _baseUrl = _this2._baseUrl;


        const userProfileResponse = yield request.post(_baseUrl + api.MATCHING_INFO_PATH).set({
          Authorization: handShakeToken.access_token
        }).send();

        if (userProfileResponse.status != 200) {
          console.error("[BlockPass] UserProfile Response Error", userProfileResponse.text);
          return null;
        }

        return userProfileResponse.body;
      } catch (error) {
        console.error("Query Profile failed: ", error);
        return null;
      }
    })();
  }

  notifyLoginComplete(bpToken, sessionData, extraData) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      try {
        const _clientId = _this3._clientId,
              _secretId = _this3._secretId,
              _baseUrl = _this3._baseUrl;


        const ssoCompleteResponse = yield request.post(_baseUrl + api.SSO_COMPETE_PATH).set({
          Authorization: bpToken.access_token
        }).send({
          result: "success",
          custom_data: JSON.stringify({
            sessionData,
            extraData
          })
        });

        if (ssoCompleteResponse.status != 200) {
          console.error("[BlockPass] SSoComplete Error", ssoCompleteResponse.text);
          return null;
        }

        return ssoCompleteResponse.body;
      } catch (error) {
        console.error("notifyLoginComplete failed: ", error);
        return null;
      }
    })();
  }

  notifyLoginFailed(bpToken, error) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      try {
        const _clientId = _this4._clientId,
              _secretId = _this4._secretId,
              _baseUrl = _this4._baseUrl;


        const ssoCompleteResponse = yield request.post(_baseUrl + api.SSO_COMPETE_PATH).set({
          Authorization: bpToken.access_token
        }).send({
          result: "failed",
          custom_data: JSON.stringify({
            sessionData,
            extraData
          })
        });

        if (ssoCompleteResponse.status != 200) {
          console.error("[BlockPass] SSoComplete Error", ssoCompleteResponse.text);
          return null;
        }

        return ssoCompleteResponse.body;
      } catch (error) {
        console.error("notifyLoginComplete failed: ", error);
        return null;
      }
    })();
  }

  _checkAndRefreshAccessToken(bpToken) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      try {
        const _clientId = _this5._clientId,
              _secretId = _this5._secretId,
              _baseUrl = _this5._baseUrl;


        const now = new Date();
        if (bpToken.expires_in > now) return bpToken;

        const access_token = bpToken.access_token,
              refresh_token = bpToken.refresh_token;

        const refreshTokenResponse = yield request.post(_baseUrl + api.REFRESH_TOKEN_PATH).send({
          stoc: access_token,
          stoc_refresh: refresh_token,
          client_secret: _secretId
        });

        if (refreshTokenResponse.status != 200) {
          console.error("[BlockPass] Refreshkyc Error", refreshTokenResponse.text);
          return null;
        }

        return refreshTokenResponse.body;
      } catch (error) {
        console.error("_checkAndRefreshAccessToken failed: ", error);
        return null;
      }
    })();
  }

  queryProofOfPath(bpToken, slug_list) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      // check refresh bpToken
      bpToken = yield _this6._checkAndRefreshAccessToken(bpToken);
      const _clientId = _this6._clientId,
            _secretId = _this6._secretId,
            _baseUrl = _this6._baseUrl;


      try {
        const ssoQueryPathResponse = yield request.post(_baseUrl + api.GET_PROOF_OF_PATH).set({
          Authorization: bpToken.access_token
        }).send({
          slug_list
        });

        if (ssoQueryPathResponse.status != 200) {
          console.log("[BlockPass] queryProofOfPath Error", ssoQueryPathResponse.text);
          return null;
        }

        return {
          proofOfPath: ssoQueryPathResponse.body,
          bpToken
        };
      } catch (error) {
        console.error(error);
      }
    })();
  }
}

module.exports = BlockpassHttpProvider;