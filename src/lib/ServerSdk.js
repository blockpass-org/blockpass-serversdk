// @flow
const BlockPassHttpProvider = require("./BlockPassHttpProvider");
const jwt = require("jsonwebtoken");
const merkleTreeHelper = require("./utils/MerkleHelper");

/**
 * @class Class ServerSdk
 */
class ServerSdk {
  findKycById: FindKycByIdHandler;
  createKyc: CreateKycHandler;
  updateKyc: UpdateKycHandler;
  queryKycStatus: QueryKycStatusHandler;
  needRecheckExistingKyc: ?ReCheckKycRecordHandler;
  generateSsoPayload: ?GenerateSsoPayloadHandler;
  blockPassProvider: any;
  requiredFields: [string];
  optionalFields: [string];
  certs: [string];
  secretId: string;
  encodeSessionData: ?(payload: any) => string;
  decodeSessionData: ?(token: string) => ?Object;

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
  }: ConstructorParams) {
    if (clientId == null || secretId == null)
      throw new Error("Missing clientId or secretId");

    if (
      findKycById == null ||
      (findKycById != null && typeof findKycById !== "function")
    )
      throw new Error("findKycById should be null or function");

    if (
      createKyc == null ||
      (createKyc != null && typeof createKyc !== "function")
    )
      throw new Error("createKyc should be null or function");

    if (
      updateKyc == null ||
      (updateKyc != null && typeof updateKyc !== "function")
    )
      throw new Error("updateKyc should be null or function");

    if (
      queryKycStatus == null ||
      (queryKycStatus != null && typeof queryKycStatus !== "function")
    )
      throw new Error("queryKycStatus should be null or function");

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
  async loginFow({
    code,
    sessionCode
  }: {
    code: string,
    sessionCode: string
  }): Promise<BlockpassMobileResponsePayload> {
    if (code == null || sessionCode == null)
      throw new Error("Missing code or sessionCode");

    const kycToken = await this.blockPassProvider.doHandShake(
      code,
      sessionCode
    );
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
    const isNewUser = kycRecord == null;
    if (isNewUser)
      kycRecord = await Promise.resolve(this.createKyc({ kycProfile }));

    let payload = {};
    if (isNewUser) {
      payload.nextAction = "upload";
      payload.requiredFields = this.requiredFields;
      payload.optionalFields = this.optionalFields;
      payload.certs = this.certs;
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExistingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        })
      );
    }

    // Nothing need to update. Notify sso complete
    if (payload.nextAction === "none") {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
              kycProfile,
              kycRecord,
              kycToken,
              payload
            })
          : {}
      );
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      );
      this._activityLog("[BlockPass] login success", res);
    }

    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        sessionCode
      }),
      ...payload
    };
  }

  //-----------------------------------------------------------------------------------
  /**
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {...ServerSdk#UploadDataRequest} params
   */
  async updateDataFlow({
    accessToken,
    slugList,
    ...userRawData
  }: {
    accessToken: string,
    slugList: [string],
    userRawData: Object
  }): Promise<BlockpassMobileResponsePayload> {
    if (!slugList) throw new Error("Missing slugList");

    const decodeData = this._decodeDataFromToken(accessToken);
    if (!decodeData) throw new Error("Invalid Access Token");
    const { kycId, kycToken, sessionCode } = decodeData;

    let kycRecord = await Promise.resolve(this.findKycById(kycId));
    if (!kycRecord) throw new Error("Kyc record could not found");

    const criticalFieldsCheck = this.requiredFields.every(
      val => slugList.indexOf(val) !== -1 && userRawData[val] != null
    );

    if (!criticalFieldsCheck) throw new Error("Missing critical slug");

    // query kyc profile
    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    // matching existing record
    kycRecord = await Promise.resolve(
      this.updateKyc({
        kycRecord,
        kycProfile,
        kycToken,
        userRawData
      })
    );

    const payload = {
      nextAction: "none",
      message: "welcome back"
    };

    // Notify sso complete
    if (sessionCode) {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
              kycProfile,
              kycRecord,
              kycToken,
              payload
            })
          : {}
      );
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      );
      this._activityLog("[BlockPass] login success", res);
    }

    return {
      ...payload
    };
  }

  //-----------------------------------------------------------------------------------
  /**
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
   */
  async registerFlow({
    code
  }: {
    code: string
  }): Promise<BlockpassMobileResponsePayload> {
    if (code == null) throw new Error("Missing code or sessionCode");

    const kycToken = await this.blockPassProvider.doHandShake(code);
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
    const isNewUser = kycRecord == null;
    if (isNewUser)
      kycRecord = await Promise.resolve(this.createKyc({ kycProfile }));

    let payload = {};
    if (isNewUser) {
      payload.nextAction = "upload";
      payload.requiredFields = this.requiredFields;
      payload.optionalFields = this.optionalFields;
      payload.certs = this.certs;
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExistingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExistingKyc({
          kycProfile,
          kycRecord,
          kycToken,
          payload
        })
      );
    }

    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken
      }),
      ...payload
    };
  }

  //-----------------------------------------------------------------------------------
  /**
   * Query status of kyc record
   *
   */
  async queryStatusFlow({ code }: { code: string }): Promise<KycRecordStatus> {
    if (code == null) throw new Error("Missing code or sessionCode");

    const kycToken = await this.blockPassProvider.doHandShake(code);
    if (kycToken == null) throw new Error("Handshake failed");

    this._activityLog("[BlockPass]", kycToken);

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
    if (kycProfile == null) throw new Error("Sync info failed");

    this._activityLog("[BlockPass]", kycProfile);

    const kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));

    if (!kycRecord)
      return {
        status: "notFound"
      };

    const kycStatus = await Promise.resolve(this.queryKycStatus({ kycRecord }));

    // checking fields
    const { status, identities } = kycStatus;

    if (!status)
      throw new Error("[queryKycStatus] return missing fields: status");
    if (!identities)
      throw new Error("[queryKycStatus] return missing fields: identities");

    return {
      ...kycStatus
    };
  }

  //-----------------------------------------------------------------------------------
  /**
   * Sign new Certificate and send to Blockpass
   */
  async signCertificate({
    id,
    kycRecord
  }: {
    id: string,
    kycRecord: KycRecord
  }): Promise<boolean> {
    // Todo: Implement in V2
    return false;
  }

  //-----------------------------------------------------------------------------------
  /**
   * Reject a given Certificate
   */
  async rejectCertificate({
    profileId,
    message
  }: {
    profileId: string,
    message: string
  }): Promise<boolean> {
    // Todo: Implement in V2
    return false;
  }

  //-----------------------------------------------------------------------------------
  /**
   * Query Merkle proof for a given slugList
   */
  async queryProofOfPath({
    kycToken,
    slugList
  }: {
    kycToken: KycToken,
    slugList: [string]
  }) {
    const res = await this.blockPassProvider.queryProofOfPath(
      kycToken,
      slugList
    );
    return res;
  }

  //-----------------------------------------------------------------------------------
  _activityLog(...args: any) {
    console.log("\x1b[32m%s\x1b[0m", "[info]", ...args);
  }

  _encodeDataIntoToken(payload: any): string {
    const { encodeSessionData } = this;
    if (encodeSessionData) return encodeSessionData(payload);

    return jwt.sign(payload, this.secretId);
  }

  _decodeDataFromToken(accessToken: string): ?Object {
    try {
      const { decodeSessionData } = this;
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
  merkleProofCheckSingle(
    rootHash: string,
    rawData: string | Buffer,
    proofList: any
  ) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

module.exports = ServerSdk;

/**
 * ------------------------------------------------------
 *
 */

/**
 * KYC Record Object
 * @typedef {Object} ServerSdk#kycRecord
 */

declare type ConstructorParams = {
  baseUrl: string,
  clientId: string,
  secretId: string,
  requiredFields: [string],
  optionalFields: [string],
  certs: [string],
  findKycById: FindKycByIdHandler,
  createKyc: CreateKycHandler,
  updateKyc: UpdateKycHandler,
  queryKycStatus: QueryKycStatusHandler,
  needRecheckExistingKyc?: ReCheckKycRecordHandler,
  generateSsoPayload?: GenerateSsoPayloadHandler,
  encodeSessionData?: ?(payload: any) => string,
  decodeSessionData?: ?(payload: string) => any
};
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

declare type FindKycByIdHandler = (kycId: string) => Promise<KycRecord>;
/**
 * Handler function to query Kyc record by Id
 * @callback ServerSdk#findKycByIdHandler
 * @async
 * @param {string} kycId
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

declare type CreateKycHandler = ({ kycProfile: KycProfile }) => Promise<
  KycRecord
>;
/**
 * Handler function to create new KycRecord
 * @callback ServerSdk#createKycHandler
 * @async
 * @param {ServerSdk#kycProfile} kycProfile
 * @returns {Promise<ServerSdk#kycRecord>} Kyc Record
 */

declare type UpdateKycHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  userRawData: Object
}) => Promise<KycRecord>;
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

declare type QueryKycStatusHandler = ({
  kycRecord: KycRecord
}) => Promise<KycRecordStatus>;
/**
 * Handler function to summary status of KycRecord
 * @callback ServerSdk#QueryKycStatusHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @returns {Promise<ServerSdk#KycRecordStatus>} Kyc Record
 */

declare type ReCheckKycRecordHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object
}) => Promise<Object>;
/**
 * Handler function return whether a KYC existing check is required
 * @callback ServerSdk#needRecheckExistingKycHandler
 * @async
 * @param {ServerSdk#kycRecord} kycRecord
 * @param {ServerSdk#kycProfile} kycProfile
 * @param {Object} payload
 * @returns {Promise<Object>} Payload return to client
 */

declare type GenerateSsoPayloadHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object
}) => Promise<BlockpassMobileResponsePayload>;
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

declare type KycRecord = any;

declare type RecordStatus = "notFound" | "waiting" | "inreview" | "approved";
declare type RecordFieldStatus = {
  slug: string,
  status: string,
  comment: string
};
/**
 * KYC Record 's Field Status
 * @typedef {Object} ServerSdk#KycRecordStatus#KycRecordFieldStatus
 * @property {string} slug: Slug name
 * @property {string} status: Approve status (recieved | recieved | approved)
 * @property {string} comment: Comment from reviewer
 */

declare type KycRecordStatus = {
  status: RecordStatus,
  message?: string,
  createdDate?: Date,
  identities?: [RecordFieldStatus],
  certificates?: [RecordFieldStatus]
};
/**
 * KYC Record Status Object
 * @typedef {Object} ServerSdk#KycRecordStatus
 * @property {string} status: Status of KycRecord
 * @property {string} message: Summary text for currently KycRecord
 * @property {[ServerSdk#KycRecordStatus#KycRecordFieldStatus]} identities: Identities status
 * @property {[ServerSdk#KycRecordStatus#KycRecordFieldStatus]} certificates: Certificate status
 * @property {string('syncing'|'complete')} isSynching: Smartcontract syncing status
 */

declare type SyncStatus = "syncing" | "complete";
declare type KycProfile = {
  id: string,
  smartContractId: string,
  rootHash: string,
  isSynching: SyncStatus
};
/**
 * KYC Profile Object
 * @typedef {Object} ServerSdk#kycProfile
 * @property {string} id: Udid of kycProfile (assigned by blockpass)
 * @property {string} smartContractId: SmartContract user ID ( using to validate rootHash via Sc)
 * @property {string} rootHash: Currently Root Hash
 * @property {string('syncing'|'complete')} isSynching: Smartcontract syncing status
 */

declare type KycToken = {
  access_token: string,
  expires_in: Number,
  refresh_token: string
};
/**
 * @typedef {Object} ServerSdk#kycToken
 * @property {string} access_token: AccessToken string
 * @property {Number} expires_in: Expired time in seconds
 * @property {string} refresh_token: Refresh token
 */

declare type NextActionType = "none" | "upload";
declare type BlockpassMobileResponsePayload = {
  nextAction: NextActionType,
  message?: string,
  accessToken?: string,
  requiredFields?: [string],
  optionalFields?: [string]
};

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
