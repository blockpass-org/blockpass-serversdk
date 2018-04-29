// @flow
const BlockPassHttpProvider = require("./BlockPassHttpProvider");
const merkleTreeHelper = require("./utils/MerkleHelper");

class ServerSdk {
  findKycById: FindKycByIdHandler;
  createKyc: CreateKycHandler;
  updateKyc: UpdateKycHandler;
  needRecheckExitingKyc: ?ReCheckKycRecordHandler;
  generateSsoPayload: ?GenerateSsoPayloadHandler;
  blockPassProvider: any;
  requiredFields: [string];
  optionalFields: [string];

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
    generateSsoPayload
  }: ConstructorParams) {
    if (clientId == null || secretId == null)
      throw new Error("Missing clientId or secretId");

    if (findKycById != null && typeof findKycById !== "function")
      throw new Error("findKycById should be null or function");

    if (createKyc != null && typeof createKyc !== "function")
      throw new Error("createKyc should be null or function");

    if (updateKyc != null && typeof updateKyc !== "function")
      throw new Error("updateKyc should be null or function");

    this.findKycById = findKycById;
    this.createKyc = createKyc;
    this.updateKyc = updateKyc;
    this.needRecheckExitingKyc = needRecheckExitingKyc;
    this.generateSsoPayload = generateSsoPayload;

    this.blockPassProvider = new BlockPassHttpProvider({
      baseUrl,
      clientId,
      secretId
    });
    this.requiredFields = requiredFields;
    this.optionalFields = optionalFields;
  }

  /**
   * Login Flow. Which handle SSO and AppLink login from Blockpass client.
   *
   *  Step 1: Handshake between our service and BlockPass
   *  Step 2: Sync Userprofile with Blockpass Db
   *  Step 3: Base on blockpassId. Some situation below covered
   *      - register success ( exiting kyc already fill and validated )
   *      - need update user raw data (kyc record)
   *      - need user re-upload infomation ( some fields change / periodic check )
   * @param {string} code: blockpass access code (from blockpass client)
   * @param {string} sessionCode: sso sessionCode
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
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExitingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload })
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
      accessToken: this.blockPassProvider.encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        sessionCode
      }),
      ...payload
    };
  }

  /**
   * Recieve user raw data and fill-up kycRecord
   *  - Step1: restore accessToken
   *  - Step2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step3: Trying to matching kycData base on (kyc + bpId). Handle your logic in updateKyc
   *  - Example Advance Scenarios:
   *      - email / phone already used in 2 different records => conclict case should return error
   *      - user already register. Now update user data fields => revoke certificate
   * @param {sessionToken} accessToken: Store encoded data from /login or /register api
   * @param {[string]} slugList: List of identities field supplied by blockpass client
   * @param {Object} userRawData: User raw data from multiform/parts request. Following format below
   * Example:
   * ``` json
   * {
   *  "phone": { type: 'string', value:'09xxx'},
   *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
   *  ....
   * }
   * ```
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

    const decodeData = this.blockPassProvider.decodeDataFromToken(accessToken);
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

    // matching exiting record
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
   * Register fow. Recieved user sign-up infomation and create KycProcess.
   * Basically this flow processing same as loginFlow. The main diffrence is without sessionCode input
   * @param {string} code:
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
    } else {
      payload.message = "welcome back";
      payload.nextAction = "none";
    }

    if (kycRecord && this.needRecheckExitingKyc) {
      payload = await Promise.resolve(
        this.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload })
      );
    }

    return {
      accessToken: this.blockPassProvider.encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken
      }),
      ...payload
    };
  }

  /**
   * Sign Certificate and send to blockpass
   * @param {*} param0
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
   * Reject Certificate
   * @param {string} profileId
   * @param {string} message: Reasone reject(this message will be sent to client)
   */
  async rejectCertificate({
    id,
    reason
  }: {
    id: string,
    reason: string
  }): Promise<boolean> {
    // Todo: Implement in V2
    return false;
  }

  /**
   * Query Merkle proof of path for given slugList
   * @param {kycToken} kycToken
   * @param {[string]} slugList
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

  _activityLog(...args: any) {
    console.log("\x1b[32m%s\x1b[0m", "[info]", ...args);
  }

  merkleProofCheckSingle(
    rootHash: string,
    rawData: string | Buffer,
    proofList: any
  ) {
    return merkleTreeHelper.validateField(rootHash, rawData, proofList);
  }
}

module.exports = ServerSdk;

declare type ConstructorParams = {
  baseUrl: string,
  clientId: string,
  secretId: string,
  requiredFields: [string],
  optionalFields: [string],
  findKycById: any,
  createKyc: any,
  updateKyc: any,
  needRecheckExitingKyc?: any,
  generateSsoPayload?: any
};
/**
 * @typedef {Object} ConstructorParams
 * @property {string} baseUrl: Blockpass Api Url
 * @property {string} clientId: CliendId(from developer dashboard)
 * @property {string} secretId: SecretId(from developer dashboard)
 * @property {[string]} requiredFields: Required identities fields(from developer dashboard)
 * @property {[string]} optionalFields: Optional identities fields(from developer dashboard)
 * @property {findKycByIdCallback} findKycById: Find KycRecord by id
 * @property {createKycCallback} createKyc: Create new KycRecord
 * @property {updateKycCallback} updateKyc: Update Kyc
 * @property {needRecheckExitingKycCallback} [needRecheckExitingKyc]: Performing logic to check exiting kycRecord need re-submit data
 * @property {generateSsoPayloadCallback} [generateSsoPayload]: Return sso payload
 */

declare type FindKycByIdHandler = (kycId: string) => Promise<KycRecord>;
/**
 * Query Kyc record by Id
 * @callback findKycByIdCallback
 * @async
 * @param {string} kycId
 * @returns {Promise<KycRecord>} Kyc Record
 */

declare type CreateKycHandler = ({ kycProfile: KycProfile }) => Promise<
  KycRecord
>;
/**
 * KYC create handler. Create new KycRecord
 * @callback createKycCallback
 * @async
 * @param {kycProfile} kycProfile
 * @returns {Promise<KycRecord>} Kyc Record
 */

declare type UpdateKycHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  userRawData: Object
}) => Promise<KycRecord>;
/**
 * KYC Update handler. Update KycRecord
 * @callback updateKycCallback
 * @async
 * @param {kycRecord} kycRecord
 * @param {kycProfile} kycProfile
 * @param {kycToken} kycToken
 * @param {Object} userRawData
 * @returns {Promise<KycRecord>} Kyc Record
 */

declare type ReCheckKycRecordHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object
}) => Promise<Object>;
/**
 * Check need to update new info for exiting Kyc record
 * @callback needRecheckExitingKycCallback
 * @async
 * @param {kycRecord} kycRecord
 * @param {kycProfile} kycProfile
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
 * Check need to update new info for exiting Kyc record
 * @callback generateSsoPayloadCallback
 * @async
 * @param {kycRecord} kycRecord
 * @param {kycProfile} kycProfile
 * @param {kycToken} kycToken
 * @param {Object} payload
 * @returns {Promise<Object>} Payload return to client
 */

declare type KycRecord = any;
declare type SyncStatus = "syncing" | "complete";
declare type KycProfile = {
  id: string,
  smartContractId: string,
  rootHash: string,
  isSynching: SyncStatus
};
/**
 * KYC Profile Object
 * @typedef {Object} kycProfile
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
 * @typedef {Object} kycToken
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
