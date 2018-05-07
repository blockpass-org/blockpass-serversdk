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

  /**
   * -----------------------------------------------------------------------------------
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {RawDataUploadDataRequest} params
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

  /**
   * -----------------------------------------------------------------------------------
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
   * @param {Object} params
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

  /**
   * -----------------------------------------------------------------------------------
   * Query status of kyc record
   * @param {Object} params
   */
  async queryStatusFlow({
    code
  }: {
    code: string
  }): Promise<MobileAppKycRecordStatus> {
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

  /**
   * -----------------------------------------------------------------------------------
   * Sign new Certificate and send to Blockpass
   * @param {Object} params
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

  /**
   * -----------------------------------------------------------------------------------
   * Reject a given Certificate
   * @param {Object} params
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

  /**
   * -----------------------------------------------------------------------------------
   * Query Merkle proof for a given slugList
   * @param {Object} params
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

  /**
   * -----------------------------------------------------------------------------------
   * Check Merkle proof for invidual field
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
 * --------------------------------------------------------
 * @type {Object}
 */
type ConstructorParams = {
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
 * --------------------------------------------------------
 * KYC Records
 * @type {object}
 */
type KycRecord = any;

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
type RawDataUploadDataRequest = {
  [key: string]: RawDataFile | RawDataString
};

/**
 *
 * String fields from Mobile App
 * @type {Object}
 */
type RawDataString = {
  type: "string",
  value: string
};

/**
 *
 * Binary fields from Mobile App
 * @type {Object}
 */
type RawDataFile = {
  type: "file",
  buffer: Buffer,
  originalName?: string
};

/**
 * --------------------------------------------------------
 * KYC Record Status
 * @type {object}
 */
type MobileAppKycRecordStatus = {
  status: RecordStatus,
  message?: string,
  createdDate?: Date,
  identities?: [RecordFieldStatus],
  certificates?: [RecordFieldStatus]
};

/**
 * --------------------------------------------------------
 * Currently KycRecord status: "notFound" | "waiting" | "inreview" | "approved"
 * @type {string}
 */
type RecordStatus = "notFound" | "waiting" | "inreview" | "approved";

/**
 * --------------------------------------------------------
 * KYC Record 's Field Status
 * @type {object}
 */
type RecordFieldStatus = {
  slug: string,
  status: InvidualFieldStatus,
  comment: string
};

/**
 * --------------------------------------------------------
 * Status for invidual fields: "received" | "approved" | "rejected" | "missing";
 * @type {string}
 */
type InvidualFieldStatus = "received" | "approved" | "rejected" | "missing";

/**
 * --------------------------------------------------------
 * Blockpass Kyc Profile object
 * @type {object}
 */
type KycProfile = {
  id: string,
  smartContractId: string,
  rootHash: string,
  isSynching: SyncStatus
};

/**
 * --------------------------------------------------------
 * Kyc Profile 's syncing status: "syncing" | "complete"
 * @type {string}
 */
type SyncStatus = "syncing" | "complete";

/**
 * --------------------------------------------------------
 * Blockpass KycToken object
 * @type {object}
 */
type KycToken = {
  access_token: string,
  expires_in: Number,
  refresh_token: string
};

/**
 * --------------------------------------------------------
 * Client Next action: "none" | "upload"
 * @type {string}
 */
type NextActionType = "none" | "upload";

/**
 * --------------------------------------------------------
 * Blockpass Mobile Response
 * @type {object}
 */
type BlockpassMobileResponsePayload = {
  nextAction: NextActionType,
  message?: string,
  accessToken?: string,
  requiredFields?: [string],
  optionalFields?: [string]
};

/**
 * --------------------------------------------------------
 * Handler function to query Kyc record by Id
 * @callback
 * @param {string} kycId
 * @return {Promise<KycRecord>}
 */
type FindKycByIdHandler = (kycId: string) => Promise<KycRecord>;

/**
 * --------------------------------------------------------
 * Handler function to create new KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @returns {Promise<KycRecord>}
 */
type CreateKycHandler = ({ kycProfile: KycProfile }) => Promise<KycRecord>;

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
type UpdateKycHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  userRawData: Object
}) => Promise<KycRecord>;

/**
 * --------------------------------------------------------
 * Handler function to summary status of KycRecord
 * @callback
 * @param {Object} params
 * @param {KycRecord} params.kycRecord
 * @returns {Promise<MobileAppKycRecordStatus>}
 */
type QueryKycStatusHandler = ({
  kycRecord: KycRecord
}) => Promise<MobileAppKycRecordStatus>;

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
type ReCheckKycRecordHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object
}) => Promise<Object>;

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
type GenerateSsoPayloadHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object
}) => Promise<BlockpassMobileResponsePayload>;
