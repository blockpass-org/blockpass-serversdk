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
   * @param {...ServerSdk#ConstructorParams} params
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

  //-----------------------------------------------------------------------------------
  /**
   * Login Flow, handling SSO and AppLink login from Blockpass client.
   *
   *  - Step 1: Handshake between Service and BlockPass
   *  - Step 2: Sync KycProfile with Blockpass
   *  - Step 3: Create / Update kycRecord via handler
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

  //-----------------------------------------------------------------------------------
  /**
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {...ServerSdk#UploadDataRequest} params
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

  //-----------------------------------------------------------------------------------
  /**
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
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

  //-----------------------------------------------------------------------------------
  /**
   * Query status of kyc record
   *
   */
  queryStatusFlow({ code }) {
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

  //-----------------------------------------------------------------------------------
  /**
   * Sign new Certificate and send to Blockpass
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

  //-----------------------------------------------------------------------------------
  /**
   * Reject a given Certificate
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

  //-----------------------------------------------------------------------------------
  /**
   * Query Merkle proof for a given slugList
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

  //-----------------------------------------------------------------------------------
  /**
   * Check Merkle proof for invidual field
   * @param {string} rootHash: Root hash of kycRecord
   * @param {string|Buffer} rawData: Raw data need to be check
   * @param {object} proofList: Proof introduction ( from queryProofOfPath response)
   */
  merkleProofCheckSingle(rootHash, rawData, proofList) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

/**
 * Response payload for Blockpass mobile app
 * @typedef {Object} ServerSdk#BlockpassMobileResponsePayload
 * @property {string} nextAction: Next action for mobile blockpass ("none" | "upload" | "website")
 * @property {string} [message]: Custom message to display
 * @property {string} [accessToken]: Encoded session into token ( using share data between multiple steps )
 * @property {[string]} [requiredFields]: Required identitites need to be send throught '/upload'
 * @property {[string]} [optionalFields]: Optional identitites (client can decline provide those info)
 */

/**
 * Upload data from Blockpass mobile app
 * @typedef {Object} ServerSdk#UploadDataRequest
 * @param {string} accessToken: Eencoded session data from /login or /register api
 * @param {[string]} slugList: List of identities field supplied by blockpass client
 * @param {...Object} userRawData: Rest parameters contain User raw data from multiform/parts request. Following format below:
 *
 * @example
 * {
 *  // string fields
 *  "phone": { type: 'string', value:'09xxx'},
 *
 *  // buffer fields
 *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
 *
 *  // certificate fields with `[cer]` prefix
 *  "[cer]onfido": {type: 'string', valur:'...'}
 *
 *  ....
 * }
 */
module.exports = ServerSdk;

/**
 * ------------------------------------------------------
 *
 */

/**
 * KYC Record Object
 * @typedef {Object} ServerSdk#kycRecord
 */

/**
 * @typedef {Object} ServerSdk#ConstructorParams
 * @property {string} baseUrl: Blockpass Api Url (from developer dashboard)
 * @property {string} clientId: CliendId(from developer dashboard)
 * @property {string} secretId: SecretId(from developer dashboard)
 * @property {[string]} requiredFields: Required identities fields(from developer dashboard)
 * @property {[string]} optionalFields: Optional identities fields(from developer dashboard)
 * @property {ServerSdk#findKycByIdHandler} findKycById: Find KycRecord by id
 * @property {ServerSdk#createKycHandler} createKyc: Create new KycRecord
 * @property {ServerSdk#updateKycHandler} updateKyc: Update Kyc
 * @property {ServerSdk#needRecheckExistingKycHandler} [needRecheckExistingKyc]: Performing logic to check existing kycRecord need re-submit data
 * @property {ServerSdk#generateSsoPayloadHandler} [generateSsoPayload]: Return sso payload
 * @property {function(object) : string} [encodeSessionData]: Encode sessionData to string
 * @property {function(string) : object} [decodeSessionData]: Decode sessionData from string
 */

/**
 * Handler function to query Kyc record by Id
 * @callback ServerSdk#findKycByIdHandler
 * @async
 * @param {string} kycId
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Handler function to create new KycRecord
 * @callback ServerSdk#createKycHandler
 * @async
 * @param {ServerSdk#kycProfile} kycProfile
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Handler function to update existing KycRecord
 * @callback ServerSdk#updateKycHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {ServerSdk#kycToken} kycToken
 * @param {Object} userRawData
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Handler function to summary status of KycRecord
 * @callback ServerSdk#QueryKycStatusHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @returns {Promise<ServerSdk#KycRecordStatus>} Kyc Record
 */

/**
 * Handler function return whether a KYC existing check is required
 * @callback ServerSdk#needRecheckExistingKycHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {Object} payload
 * @returns {Promise<Object>} Payload return to client
 */

/**
 * Handler function to generate SSo payload
 * @callback ServerSdk#generateSsoPayloadHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {ServerSdk#kycToken} kycToken
 * @param {Object} payload
 * @returns {Promise<{@link BlockpassMobileResponsePayload}>} Payload return to client
 */

/**
 * KYC Record 's Field Status
 * @typedef {Object} ServerSdk#KycRecordStatus#KycRecordFieldStatus
 * @property {string} slug: Slug name
 * @property {string} status: Approve status (recieved | recieved | approved)
 * @property {string} comment: Comment from reviewer
 */

/**
 * KYC Record Status Object
 * @typedef {Object} ServerSdk#KycRecordStatus
 * @property {string} status: Status of KycRecord
 * @property {string} message: Summary text for currently KycRecord
 * @property {[ServerSdk#KycRecordStatus#KycRecordFieldStatus]} identities: Identities status
 * @property {[ServerSdk#KycRecordStatus#KycRecordFieldStatus]} certificates: Certificate status
 * @property {string('syncing'|'complete')} isSynching: Smartcontract syncing status
 */

/**
 * KYC Profile Object
 * @typedef {Object} ServerSdk#kycProfile
 * @property {string} id: Udid of kycProfile (assigned by blockpass)
 * @property {string} smartContractId: SmartContract user ID ( using to validate rootHash via Sc)
 * @property {string} rootHash: Currently Root Hash
 * @property {string('syncing'|'complete')} isSynching: Smartcontract syncing status
 */

/**
 * @typedef {Object} ServerSdk#kycToken
 * @property {string} access_token: AccessToken string
 * @property {Number} expires_in: Expired time in seconds
 * @property {string} refresh_token: Refresh token
 */