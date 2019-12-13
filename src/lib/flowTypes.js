// @flow

/**
 * --------------------------------------------------------
 * KYC Records
 * @type {object}
 */
export type KycRecord = any

/**
 *
 * String fields from Mobile App
 * @type {Object}
 */
export type RawDataString = {
  type: 'string',
  value: string,
}

/**
 *
 * Binary fields from Mobile App
 * @type {Object}
 */
export type RawDataFile = {
  type: 'file',
  buffer: Buffer,
  originalName?: string,
}

/**
 * --------------------------------------------------------
 * Currently KycRecord status: "notFound" | "waiting" | "inreview" | "approved"
 * @type {string}
 */
export type RecordStatus = 'notFound' | 'waiting' | 'inreview' | 'approved'

/**
 * --------------------------------------------------------
 * Status for invidual fields: "received" | "approved" | "rejected" | "missing";
 * @type {string}
 */
export type InvidualFieldStatus =
  | 'received'
  | 'approved'
  | 'rejected'
  | 'missing'

/**
 * --------------------------------------------------------
 * Kyc Profile 's syncing status: "syncing" | "complete"
 * @type {string}
 */
export type SyncStatus = 'syncing' | 'complete'

/**
 * --------------------------------------------------------
 * KYC Record 's Field Status
 * @type {object}
 */
export type RecordFieldStatus = {
  slug: string,
  status: InvidualFieldStatus,
  comment: string,
}

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
export type RawDataUploadDataRequest = {
  [key: string]: RawDataFile | RawDataString,
}
/**
 * --------------------------------------------------------
 * KYC Record Status
 * @type {object}
 */
export type MobileAppKycRecordStatus = {
  status: RecordStatus,
  allowCertPromise?: Boolean,
  message?: string,
  createdDate?: Date,
  identities?: [RecordFieldStatus],
  certificates?: [RecordFieldStatus],
}

/**
 * --------------------------------------------------------
 * Blockpass Kyc Profile object
 * @type {object}
 */
export type KycProfile = {
  id: string,
  smartContractId: string,
  rootHash: string,
  isSynching: SyncStatus,
}

/**
 * --------------------------------------------------------
 * Blockpass KycToken object
 * @type {object}
 */
export type KycToken = {
  access_token: string,
  expires_in: Number,
  refresh_token: string,
}

/**
 * --------------------------------------------------------
 * Client Next action: "none" | "upload"
 * @type {string}
 */
export type NextActionType = 'none' | 'upload'

/**
 * --------------------------------------------------------
 * Blockpass Mobile Response
 * @type {object}
 */
export type BlockpassMobileResponsePayload = {
  nextAction: NextActionType,
  message?: string,
  accessToken?: string,
  requiredFields?: [string],
  optionalFields?: [string],
}

/**
 * --------------------------------------------------------
 * Handler function to query Kyc record by Id
 * @callback
 * @param {string} kycId
 * @return {Promise<KycRecord>}
 */
export type FindKycByIdHandler = (kycId: string) => Promise<KycRecord>

/**
 * --------------------------------------------------------
 * Handler function to create new KycRecord
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @returns {Promise<KycRecord>}
 */
export type CreateKycHandler = ({
  kycProfile: KycProfile,
}) => Promise<KycRecord>

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
export type UpdateKycHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  userRawData: Object,
}) => Promise<KycRecord>

/**
 * --------------------------------------------------------
 * Handler function to summary status of KycRecord
 * @callback
 * @param {Object} params
 * @param {KycRecord} params.kycRecord
 * @returns {Promise<MobileAppKycRecordStatus>}
 */
export type QueryKycStatusHandler = ({
  kycRecord: KycRecord,
}) => Promise<MobileAppKycRecordStatus>

/**
 * --------------------------------------------------------
 * Handler function processing user resubmit request
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>}
 */
export type ReSubmitCheckHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: BlockpassMobileResponsePayload,
}) => Promise<BlockpassMobileResponsePayload>

/**
 * --------------------------------------------------------
 * Handler function to generate SSo payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<BlockpassMobileResponsePayload>}
 */
export type GenerateSsoPayloadHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object,
}) => Promise<BlockpassMobileResponsePayload>

/**
 * --------------------------------------------------------
 * Handler function to generate Redirect payload
 * @callback
 * @param {Object} params
 * @param {KycProfile} params.kycProfile
 * @param {KycRecord} params.kycRecord
 * @param {KycToken} params.kycToken
 * @param {Object} params.payload
 * @returns {Promise<any>} Query string values
 */
export type GenerateRedirectPayloadHandler = ({
  kycProfile: KycProfile,
  kycRecord: KycRecord,
  kycToken: KycToken,
  payload: Object,
}) => Promise<any>

/**
 * --------------------------------------------------------
 * @type {Object}
 */
export type ConstructorParams = {
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
  onResubmitKycData: ?ReSubmitCheckHandler,
  generateSsoPayload?: GenerateSsoPayloadHandler,
  redirectAfterCompletedRegisterPayload?: GenerateRedirectPayloadHandler,
  encodeSessionData?: ?(payload: any) => string,
  decodeSessionData?: ?(payload: string) => any,
  debug: boolean,
  autoFetchMetadata: boolean,
}

/**
 * --------------------------------------------------------
 * Blockpass Certpromise Response object
 * @type {object}
 */
export type CertPromiseResponse = {
  slug: string,
  raw: string,
}
