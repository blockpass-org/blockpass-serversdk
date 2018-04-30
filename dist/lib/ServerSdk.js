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
    findKycById,
    createKyc,
    updateKyc,
    needRecheckExitingKyc,
    generateSsoPayload,
    encodeSessionData,
    decodeSessionData
  }) {
    if (clientId == null || secretId == null) throw new Error("Missing clientId or secretId");

    if (findKycById != null && typeof findKycById !== "function") throw new Error("findKycById should be null or function");

    if (createKyc != null && typeof createKyc !== "function") throw new Error("createKyc should be null or function");

    if (updateKyc != null && typeof updateKyc !== "function") throw new Error("updateKyc should be null or function");

    this.findKycById = findKycById;
    this.createKyc = createKyc;
    this.updateKyc = updateKyc;
    this.needRecheckExitingKyc = needRecheckExitingKyc;
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
  }

  //-----------------------------------------------------------------------------------
  /**
   * Login Flow. Which handle SSO and AppLink login from Blockpass client.
   *
   *  - Step 1: Handshake between our service and BlockPass
   *  - Step 2: Sync KycProfile with Blockpass
   *  - Step 3: Create / update kycRecord via handler
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
      } else {
        payload.message = "welcome back";
        payload.nextAction = "none";
      }

      if (kycRecord && _this.needRecheckExitingKyc) {
        payload = yield Promise.resolve(_this.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload }));
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

      // matching exiting record
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
   * Register fow. Recieved user sign-up infomation and create KycProcess.
   * Basically this flow processing same as loginFlow. The main diffrence is without sessionCode input
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
      } else {
        payload.message = "welcome back";
        payload.nextAction = "none";
      }

      if (kycRecord && _this3.needRecheckExitingKyc) {
        payload = yield Promise.resolve(_this3.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload }));
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
   * Sign Certificate and send to blockpass
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
   * Reject Certificate
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
   * Query Merkle proof of path for given slugList
   */
  queryProofOfPath({
    kycToken,
    slugList
  }) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      const res = yield _this4.blockPassProvider.queryProofOfPath(kycToken, slugList);
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
   * Check merkle proof for invidual field
   * @param {string} rootHash: Root hash of kycRecord
   * @param {string|Buffer} rawData: Raw data need to be check
   * @param {object} proofList: Proof introduction ( from queryProofOfPath response)
   */
  merkleProofCheckSingle(rootHash, rawData, proofList) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

/**
 * Response payload for Blockpass mobile
 * @typedef {Object} ServerSdk#BlockpassMobileResponsePayload
 * @property {string} nextAction: Next action for mobile blockpass ("none" | "upload" | "website")
 * @property {string} [message]: Custom message to display
 * @property {string} [accessToken]: Encoded session into token ( using share data between multiple steps )
 * @property {[string]} [requiredFields]: Required identitites need to be send throught '/upload'
 * @property {[string]} [optionalFields]: Optional identitites (client can decline provide those info)
 */

/**
 * Upload data from Blockpass mobile
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
 * @property {ServerSdk#needRecheckExitingKycHandler} [needRecheckExitingKyc]: Performing logic to check exiting kycRecord need re-submit data
 * @property {ServerSdk#generateSsoPayloadHandler} [generateSsoPayload]: Return sso payload
 * @property {function(object) => string} [encodeSessionData]: Encode sessionData to string
 * @property {function(string) => object} [decodeSessionData]: Decode sessionData from string
 */

/**
 * Query Kyc record by Id
 * @callback ServerSdk#findKycByIdHandler
 * @async
 * @param {string} kycId
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Create new KycRecord
 * @callback ServerSdk#createKycHandler
 * @async
 * @param {ServerSdk#kycProfile} kycProfile
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Update exiting KycRecord
 * @callback ServerSdk#updateKycHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {ServerSdk#kycToken} kycToken
 * @param {Object} userRawData
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

/**
 * Performing check. Does need re-upload user data or not
 * @callback ServerSdk#needRecheckExitingKycHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {Object} payload
 * @returns {Promise<Object>} Payload return to client
 */

/**
 * Check need to update new info for exiting Kyc record
 * @callback ServerSdk#generateSsoPayloadHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {ServerSdk#kycToken} kycToken
 * @param {Object} payload
 * @returns {Promise<{@link BlockpassMobileResponsePayload}>} Payload return to client
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