'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const EventEmitter = require('events');

const BlockPassHttpProvider = require('./BlockPassHttpProvider');
const jwt = require('jsonwebtoken');

var _require = require('lodash');

const get = _require.get;

/**
 * @class Class ServerSdk
 */

class ServerSdk extends EventEmitter {

  /**
   *
   * @param {ConstructorParams} params
   */
  constructor({
    baseUrl,
    clientId,
    secretId,
    requiredFields,
    optionalFields,
    certs,
    findKycById,
    createKyc,
    updateKyc,
    queryKycStatus,
    onResubmitKycData,
    generateSsoPayload,
    redirectAfterCompletedRegisterPayload,
    encodeSessionData,
    decodeSessionData,
    debug,
    autoFetchMetadata
  }) {
    super();
    if (clientId == null || secretId == null) {
      throw new Error('Missing clientId or secretId');
    }

    if (findKycById == null || findKycById != null && typeof findKycById !== 'function') {
      throw new Error('findKycById should be null or function');
    }

    if (createKyc == null || createKyc != null && typeof createKyc !== 'function') {
      throw new Error('createKyc should be null or function');
    }

    if (updateKyc == null || updateKyc != null && typeof updateKyc !== 'function') {
      throw new Error('updateKyc should be null or function');
    }

    if (queryKycStatus == null || queryKycStatus != null && typeof queryKycStatus !== 'function') {
      throw new Error('queryKycStatus should be null or function');
    }

    this.findKycById = findKycById;
    this.createKyc = createKyc;
    this.updateKyc = updateKyc;
    this.queryKycStatus = queryKycStatus;

    this.onResubmitKycData = onResubmitKycData;
    this.generateSsoPayload = generateSsoPayload;
    this.redirectAfterCompletedRegisterPayload = redirectAfterCompletedRegisterPayload;
    this.encodeSessionData = encodeSessionData;
    this.decodeSessionData = decodeSessionData;

    this.blockPassProvider = new BlockPassHttpProvider({
      baseUrl,
      clientId,
      secretId
    });
    this.clientId = clientId;
    this.secretId = secretId;
    this.requiredFields = requiredFields;
    this.optionalFields = optionalFields;
    this.certs = certs;
    this.debug = debug;
    this.autoFetchMetadata = autoFetchMetadata;

    this.fetchMetadata();
  }

  /**
   * Refresh service Metadata
   */
  fetchMetadata() {
    var _this = this;

    return _asyncToGenerator(function* () {
      // Disable auto fetch
      if (!_this.autoFetchMetadata) {
        setImmediate(function () {
          _this.emit('onLoaded');
        });
        return null;
      }

      const serviceMetaData = yield _this.blockPassProvider.queryServiceMetadata();

      if (!serviceMetaData) {
        return _this.emit('onError', {
          code: 404,
          msg: 'Client id not found'
        });
      }

      _this.serviceMetaData = serviceMetaData.data;
      _this.requiredFields = _this.serviceMetaData.identities.map(function (itm) {
        return itm.slug;
      });
      _this.certs = _this.serviceMetaData.certRequirement;
      _this.allowCertPromise = !!_this.serviceMetaData.allowCertPromise;

      return _this.emit('onLoaded');
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Login Flow, handling SSO and AppLink login from Blockpass client.
   *
   *  - Step 1: Handshake between Service and BlockPass
   *  - Step 2: Sync KycProfile with Blockpass
   *  - Step 3: Create / Update kycRecord via handler
   *
   * @param {Object} params
   */
  loginFow({
    code,
    sessionCode,
    refId
  }) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      if (code == null || sessionCode == null) {
        throw new Error('Missing code or sessionCode');
      }

      const kycToken = yield _this2.blockPassProvider.doHandShake(code, sessionCode);
      if (kycToken == null) throw new Error('Handshake failed');

      _this2._activityLog('[BlockPass]', kycToken);

      const kycProfile = yield _this2.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error('Sync info failed');

      _this2._activityLog('[BlockPass]', kycProfile);

      let kycRecord = yield Promise.resolve(_this2.findKycById(kycProfile.id));
      const isNewUser = kycRecord == null;
      if (!isNewUser) throw new Error('User has already registered');

      kycRecord = yield Promise.resolve(_this2.createKyc({ kycProfile, kycToken, refId }));

      const payload = {};
      payload.nextAction = 'upload';
      payload.requiredFields = _this2.requiredFields;
      payload.optionalFields = _this2.optionalFields;
      payload.certs = _this2.certs;

      // Request upload data
      return _extends({
        accessToken: _this2._encodeDataIntoToken({
          kycId: kycProfile.id,
          kycToken,
          sessionCode,
          redirectForm: 'login'
        })
      }, payload);
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {RawDataUploadDataRequest} params
   */
  updateDataFlow(_ref) {
    var _this3 = this;

    let accessToken = _ref.accessToken,
        slugList = _ref.slugList,
        userRawData = _objectWithoutProperties(_ref, ['accessToken', 'slugList']);

    return _asyncToGenerator(function* () {
      if (!slugList) throw new Error('Missing slugList');

      const decodeData = _this3._decodeDataFromToken(accessToken);
      if (!decodeData) throw new Error('Invalid Access Token');

      const kycId = decodeData.kycId,
            kycToken = decodeData.kycToken,
            sessionCode = decodeData.sessionCode,
            redirectForm = decodeData.redirectForm,
            uploadSessionData = _objectWithoutProperties(decodeData, ['kycId', 'kycToken', 'sessionCode', 'redirectForm']);

      let kycRecord = yield Promise.resolve(_this3.findKycById(kycId));
      if (!kycRecord) throw new Error('Kyc record could not found');

      // query kyc profile
      const kycProfile = yield _this3.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error('Sync info failed');

      // matching existing record
      kycRecord = yield Promise.resolve(_this3.updateKyc({
        kycRecord,
        kycProfile,
        kycToken,
        userRawData,
        uploadSessionData
      }));

      const payload = {
        nextAction: 'none',
        message: 'welcome back'

        // Handle post-upload behavior
        //  from: Login -> ssoNotify
        //  from: Register -> open-web
      };if (redirectForm === 'login') {
        const ssoData = yield Promise.resolve(_this3.generateSsoPayload ? _this3.generateSsoPayload({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }) : {});
        const res = yield _this3.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
        _this3._activityLog('[BlockPass] login success', res);
      } else if (redirectForm === 'register' || redirectForm === 'resubmit') {
        // Redirect to website
        if (_this3.redirectAfterCompletedRegisterPayload) {
          const redirectParams = yield _this3.redirectAfterCompletedRegisterPayload({
            kycProfile,
            kycRecord,
            kycToken,
            payload
          });

          if (redirectParams) {
            return _extends({
              nextAction: 'redirect'
            }, redirectParams);
          }
        }
      }

      return _extends({}, payload);
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
   * @param {Object} params
   */
  registerFlow({
    code,
    refId
  }) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      if (code == null) throw new Error('Missing code or sessionCode');

      const kycToken = yield _this4.blockPassProvider.doHandShake(code);
      if (kycToken == null) throw new Error('Handshake failed');

      _this4._activityLog('[BlockPass]', kycToken);

      const kycProfile = yield _this4.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error('Sync info failed');

      _this4._activityLog('[BlockPass]', kycProfile);

      let kycRecord = yield Promise.resolve(_this4.findKycById(kycProfile.id));
      const isNewUser = kycRecord == null;
      if (!isNewUser) throw new Error('User has already registered');

      kycRecord = yield Promise.resolve(_this4.createKyc({ kycProfile, kycToken, refId }));

      const payload = {};
      payload.nextAction = 'upload';
      payload.requiredFields = _this4.requiredFields;
      payload.optionalFields = _this4.optionalFields;
      payload.certs = _this4.certs;

      return _extends({
        accessToken: _this4._encodeDataIntoToken({
          kycId: kycProfile.id,
          kycToken,
          redirectForm: 'register'
        })
      }, payload);
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Query status of kyc record
   * @param {Object} params
   */
  queryStatusFlow({
    code,
    sessionCode
  }) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      if (code == null) throw new Error('Missing code or sessionCode');

      const handShakePayload = [code];

      if (sessionCode) handShakePayload.push(sessionCode);

      const kycToken = yield _this5.blockPassProvider.doHandShake(...handShakePayload);
      if (kycToken == null) throw new Error('Handshake failed');

      _this5._activityLog('[BlockPass]', kycToken);

      const kycProfile = yield _this5.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error('Sync info failed');

      _this5._activityLog('[BlockPass]', kycProfile);

      const kycRecord = yield Promise.resolve(_this5.findKycById(kycProfile.id));

      if (!kycRecord) {
        return _extends({
          status: 'notFound',
          allowCertPromise: _this5.allowCertPromise
        }, _this5._serviceRequirement());
      }

      const kycStatus = yield Promise.resolve(_this5.queryKycStatus({ kycRecord }));

      // checking fields
      const status = kycStatus.status,
            identities = kycStatus.identities;


      if (!status) {
        throw new Error('[queryKycStatus] return missing fields: status');
      }
      if (!identities) {
        throw new Error('[queryKycStatus] return missing fields: identities');
      }

      // Notify sso complete
      const payload = {};
      if (sessionCode) {
        const ssoData = yield Promise.resolve(_this5.generateSsoPayload ? _this5.generateSsoPayload({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }) : {});
        const res = yield _this5.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
        _this5._activityLog('[BlockPass] login success', res);
      }

      return _extends({}, kycStatus);
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Resubmit data flow
   * @param {Object} params
   */
  resubmitDataFlow({
    code,
    fieldList,
    certList
  }) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      if (code == null) throw new Error('Missing code');
      if (!fieldList || !certList) {
        throw new Error('Missing fieldList or certList');
      }

      const fieldCheck = fieldList.every(function (itm) {
        return _this6.requiredFields.indexOf(itm) !== -1;
      });
      const cerCheck = certList.every(function (itm) {
        return _this6.certs.indexOf(itm) !== -1;
      });
      if (!fieldCheck || !cerCheck) {
        throw new Error('Invalid fieldList or certList name');
      }

      const handShakePayload = [code];

      const kycToken = yield _this6.blockPassProvider.doHandShake(...handShakePayload);
      if (kycToken == null) throw new Error('Handshake failed');

      _this6._activityLog('[BlockPass]', kycToken);

      const kycProfile = yield _this6.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error('Sync info failed');

      _this6._activityLog('[BlockPass]', kycProfile);

      const kycRecord = yield Promise.resolve(_this6.findKycById(kycProfile.id));

      if (!kycRecord) {
        throw new Error('[BlockPass][resubmitDataFlow] kycRecord not found');
      }

      let payload = {
        nextAction: 'upload',
        requiredFields: fieldList,
        certs: certList
      };

      if (_this6.onResubmitKycData) {
        payload = yield Promise.resolve(_this6.onResubmitKycData({
          kycProfile,
          kycRecord,
          kycToken,
          payload,
          fieldList,
          certList
        }));
      }

      let accessToken = null;
      if (payload.nextAction === 'upload') {
        accessToken = _this6._encodeDataIntoToken({
          kycId: kycProfile.id,
          kycToken,
          redirectForm: 'resubmit',
          reSubmitInfo: {
            fieldList,
            certList
          }
        });
      }

      return _extends({
        accessToken
      }, payload);
    })();
  }

  // -----------------------------------------------------------------------------------
  /**
   * Send user notification
   *  - IF user registerPN -> PN will send
   *  - User will recieved message in their inbox
   * @param {Object} params
   */
  userNotify({
    message,
    action = '',
    bpToken,
    type // info | success | warning
  }) {
    var _this7 = this;

    return _asyncToGenerator(function* () {
      const res = yield _this7.blockPassProvider.notifyUser(bpToken, message, action, type);
      return res;
    })();
  }

  // -----------------------------------------------------------------------------------
  /**
   * Deactivate connection with user
   * @param {Object} params
   */
  deactivateUser({ bpToken }) {
    var _this8 = this;

    return _asyncToGenerator(function* () {
      const res = yield _this8.blockPassProvider.deactivateUser(bpToken);
      return res;
    })();
  }

  // -----------------------------------------------------------------------------------
  /**
   * Check dose SHA256(CertificateRawString) still valid or not (revoked by issuer)
   *
   * @typedef {Object} Args
   * @param {KycToken} Args.bpToken
   * @param {String} Args.certHash
   */
  checkCertificateHash({
    bpToken,
    certHash
  }) {
    var _this9 = this;

    return _asyncToGenerator(function* () {
      try {
        const response = yield _this9.blockPassProvider.checkCertificateHash({
          bpToken,
          certHash
        });
        if (response) {
          const status = get(response, 'res.data.status');
          return status !== 'invalid';
        }
      } catch (error) {
        console.log('[ServerSDK] error in checkCertificateHash', error);
        throw error;
      }
    })();
  }

  // -----------------------------------------------------------------------------------
  /**
   *  Fetch all certPromise and their status for record
   *
   */
  fetchCertPromise({ bpToken }) {
    var _this10 = this;

    return _asyncToGenerator(function* () {
      const response = yield _this10.blockPassProvider.fetchCertPromise(bpToken);
      if (response) {
        return response.res.data;
      }
    })();
  }

  /**
   * Pull certPromise data
   *
   */
  pullCertPromise({
    bpToken,
    certPromiseId
  }) {
    var _this11 = this;

    return _asyncToGenerator(function* () {
      const response = yield _this11.blockPassProvider.pullCertPromise(bpToken, certPromiseId);
      if (response) {
        return response.res.data;
      }
    })();
  }

  // -----------------------------------------------------------------------------------
  _activityLog(...args) {
    if (this.debug) console.log(...args);
  }

  _encodeDataIntoToken(payload) {
    const encodeSessionData = this.encodeSessionData;

    if (encodeSessionData) return encodeSessionData(payload);

    return jwt.sign(payload, this.secretId);
  }

  _decodeDataFromToken(accessToken) {
    try {
      const decodeSessionData = this.decodeSessionData;

      if (decodeSessionData) return decodeSessionData(accessToken);

      return jwt.verify(accessToken, this.secretId);
    } catch (error) {
      return null;
    }
  }

  _serviceRequirement() {
    const requiredFields = this.requiredFields,
          certs = this.certs;


    const identities = requiredFields.map(itm => ({
      slug: itm,
      status: ''
    }));

    const certificates = certs.map(itm => ({
      slug: itm,
      status: ''
    }));

    return {
      identities,
      certificates
    };
  }
}

module.exports = ServerSdk;