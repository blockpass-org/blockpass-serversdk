"use strict";

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const BlockPassHttpProvider = require("./BlockPassHttpProvider");
const jwt = require("jsonwebtoken");
const merkleTreeHelper = require("./utils/MerkleHelper");

/**
 * @class Class ServerSdk
 */
class ServerSdk {

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
    needRecheckExistingKyc,
    generateSsoPayload,
    encodeSessionData,
    decodeSessionData
  }) {
    if (clientId == null || secretId == null) throw new Error("Missing clientId or secretId");

    if (findKycById == null || findKycById != null && typeof findKycById !== "function") throw new Error("findKycById should be null or function");

    if (createKyc == null || createKyc != null && typeof createKyc !== "function") throw new Error("createKyc should be null or function");

    if (updateKyc == null || updateKyc != null && typeof updateKyc !== "function") throw new Error("updateKyc should be null or function");

    if (queryKycStatus == null || queryKycStatus != null && typeof queryKycStatus !== "function") throw new Error("queryKycStatus should be null or function");

    this.findKycById = findKycById;
    this.createKyc = createKyc;
    this.updateKyc = updateKyc;
    this.queryKycStatus = queryKycStatus;

    this.needRecheckExistingKyc = needRecheckExistingKyc;
    this.generateSsoPayload = generateSsoPayload;
    this.encodeSessionData = encodeSessionData;
    this.decodeSessionData = decodeSessionData;

    this.blockPassProvider = new BlockPassHttpProvider({
      baseUrl,
      clientId,
      secretId
    });
    this.secretId = secretId;
    this.requiredFields = requiredFields;
    this.optionalFields = optionalFields;
    this.certs = certs;
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
    sessionCode
  }) {
    var _this = this;

    return _asyncToGenerator(function* () {
      if (code == null || sessionCode == null) throw new Error("Missing code or sessionCode");

      const kycToken = yield _this.blockPassProvider.doHandShake(code, sessionCode);
      if (kycToken == null) throw new Error("Handshake failed");

      _this._activityLog("[BlockPass]", kycToken);

      const kycProfile = yield _this.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error("Sync info failed");

      _this._activityLog("[BlockPass]", kycProfile);

      let kycRecord = yield Promise.resolve(_this.findKycById(kycProfile.id));
      const isNewUser = kycRecord == null;
      if (isNewUser) kycRecord = yield Promise.resolve(_this.createKyc({ kycProfile }));

      let payload = {};
      if (isNewUser) {
        payload.nextAction = "upload";
        payload.requiredFields = _this.requiredFields;
        payload.optionalFields = _this.optionalFields;
        payload.certs = _this.certs;
      } else {
        payload.message = "welcome back";
        payload.nextAction = "none";
      }

      if (kycRecord && _this.needRecheckExistingKyc) {
        payload = yield Promise.resolve(_this.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }));
      }

      // Nothing need to update. Notify sso complete
      if (payload.nextAction === "none") {
        const ssoData = yield Promise.resolve(_this.generateSsoPayload ? _this.generateSsoPayload({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }) : {});
        const res = yield _this.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
        _this._activityLog("[BlockPass] login success", res);
      }

      return _extends({
        accessToken: _this._encodeDataIntoToken({
          kycId: kycProfile.id,
          kycToken,
          sessionCode
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
    var _this2 = this;

    let accessToken = _ref.accessToken,
        slugList = _ref.slugList,
        userRawData = _objectWithoutProperties(_ref, ["accessToken", "slugList"]);

    return _asyncToGenerator(function* () {
      if (!slugList) throw new Error("Missing slugList");

      const decodeData = _this2._decodeDataFromToken(accessToken);
      if (!decodeData) throw new Error("Invalid Access Token");
      const kycId = decodeData.kycId,
            kycToken = decodeData.kycToken,
            sessionCode = decodeData.sessionCode;


      let kycRecord = yield Promise.resolve(_this2.findKycById(kycId));
      if (!kycRecord) throw new Error("Kyc record could not found");

      const criticalFieldsCheck = _this2.requiredFields.every(function (val) {
        return slugList.indexOf(val) !== -1 && userRawData[val] != null;
      });

      if (!criticalFieldsCheck) throw new Error("Missing critical slug");

      // query kyc profile
      const kycProfile = yield _this2.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error("Sync info failed");

      // matching existing record
      kycRecord = yield Promise.resolve(_this2.updateKyc({
        kycRecord,
        kycProfile,
        kycToken,
        userRawData
      }));

      const payload = {
        nextAction: "none",
        message: "welcome back"
      };

      // Notify sso complete
      if (sessionCode) {
        const ssoData = yield Promise.resolve(_this2.generateSsoPayload ? _this2.generateSsoPayload({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }) : {});
        const res = yield _this2.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
        _this2._activityLog("[BlockPass] login success", res);
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
    code
  }) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      if (code == null) throw new Error("Missing code or sessionCode");

      const kycToken = yield _this3.blockPassProvider.doHandShake(code);
      if (kycToken == null) throw new Error("Handshake failed");

      _this3._activityLog("[BlockPass]", kycToken);

      const kycProfile = yield _this3.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error("Sync info failed");

      _this3._activityLog("[BlockPass]", kycProfile);

      let kycRecord = yield Promise.resolve(_this3.findKycById(kycProfile.id));
      const isNewUser = kycRecord == null;
      if (isNewUser) kycRecord = yield Promise.resolve(_this3.createKyc({ kycProfile }));

      let payload = {};
      if (isNewUser) {
        payload.nextAction = "upload";
        payload.requiredFields = _this3.requiredFields;
        payload.optionalFields = _this3.optionalFields;
        payload.certs = _this3.certs;
      } else {
        payload.message = "welcome back";
        payload.nextAction = "none";
      }

      if (kycRecord && _this3.needRecheckExistingKyc) {
        payload = yield Promise.resolve(_this3.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        }));
      }

      return _extends({
        accessToken: _this3._encodeDataIntoToken({
          kycId: kycProfile.id,
          kycToken
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
    code
  }) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      if (code == null) throw new Error("Missing code or sessionCode");

      const kycToken = yield _this4.blockPassProvider.doHandShake(code);
      if (kycToken == null) throw new Error("Handshake failed");

      _this4._activityLog("[BlockPass]", kycToken);

      const kycProfile = yield _this4.blockPassProvider.doMatchingData(kycToken);
      if (kycProfile == null) throw new Error("Sync info failed");

      _this4._activityLog("[BlockPass]", kycProfile);

      const kycRecord = yield Promise.resolve(_this4.findKycById(kycProfile.id));

      if (!kycRecord) return {
        status: "notFound"
      };

      const kycStatus = yield Promise.resolve(_this4.queryKycStatus({ kycRecord }));

      // checking fields
      const status = kycStatus.status,
            identities = kycStatus.identities;


      if (!status) throw new Error("[queryKycStatus] return missing fields: status");
      if (!identities) throw new Error("[queryKycStatus] return missing fields: identities");

      return _extends({}, kycStatus);
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Sign new Certificate and send to Blockpass
   * @param {Object} params
   */
  signCertificate({
    id,
    kycRecord
  }) {
    return _asyncToGenerator(function* () {
      // Todo: Implement in V2
      return false;
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Reject a given Certificate
   * @param {Object} params
   */
  rejectCertificate({
    profileId,
    message
  }) {
    return _asyncToGenerator(function* () {
      // Todo: Implement in V2
      return false;
    })();
  }

  /**
   * -----------------------------------------------------------------------------------
   * Query Merkle proof for a given slugList
   * @param {Object} params
   */
  queryProofOfPath({
    kycToken,
    slugList
  }) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      const res = yield _this5.blockPassProvider.queryProofOfPath(kycToken, slugList);
      return res;
    })();
  }

  //-----------------------------------------------------------------------------------
  _activityLog(...args) {
    console.log("\x1b[32m%s\x1b[0m", "[info]", ...args);
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

  /**
   * -----------------------------------------------------------------------------------
   * Check Merkle proof for invidual field
   */
  merkleProofCheckSingle(rootHash, rawData, proofList) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

module.exports = ServerSdk;

/**
 * --------------------------------------------------------
 * @type {Object}
 */


/**
 * --------------------------------------------------------
 * KYC Records
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * RawData upload from Mobile App
 * @type {Object.<string, RawDataString | RawDataFile>}
 * @example
 * {
 *  // string fields
 *  "phone": { type: 'string', value:'09xxx'},
 *
 *  // buffer fields
 *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
 *
 *  // certificate fields with `[cer]` prefix
 *  "[cer]onfido": {type: 'string', value:'...'}
 *
 *  ....
 * }
 */


/**
 *
 * String fields from Mobile App
 * @type {Object}
 */


/**
 *
 * Binary fields from Mobile App
 * @type {Object}
 */


/**
 * --------------------------------------------------------
 * KYC Record Status
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * Currently KycRecord status: "notFound" | "waiting" | "inreview" | "approved"
 * @type {string}
 */


/**
 * --------------------------------------------------------
 * KYC Record 's Field Status
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * Status for invidual fields: "received" | "approved" | "rejected" | "missing";
 * @type {string}
 */


/**
 * --------------------------------------------------------
 * Blockpass Kyc Profile object
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * Kyc Profile 's syncing status: "syncing" | "complete"
 * @type {string}
 */


/**
 * --------------------------------------------------------
 * Blockpass KycToken object
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * Client Next action: "none" | "upload"
 * @type {string}
 */


/**
 * --------------------------------------------------------
 * Blockpass Mobile Response
 * @type {object}
 */


/**
 * --------------------------------------------------------
 * Handler function to query Kyc record by Id
 * @callback
 * @param {string} kycId
 * @return {Promise<KycRecord>}
 */


/**
 * --------------------------------------------------------
 * Handler function to create new KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @returns {Promise<KycRecord>}
 */


/**
 * --------------------------------------------------------
 * Handler function to update existing KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.userRawData
 * @returns {Promise<KycRecord>}
 */


/**
 * --------------------------------------------------------
 * Handler function to summary status of KycRecord
 * @callback
 * @param {Object} params
 * @param {KycRecord} params.kycRecord
 * @returns {Promise<MobileAppKycRecordStatus>}
 */


/**
 * --------------------------------------------------------
 * Handler function return whether a KYC existing check is required
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<Object>}
 */


/**
 * --------------------------------------------------------
 * Handler function to generate SSo payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>;}
 */