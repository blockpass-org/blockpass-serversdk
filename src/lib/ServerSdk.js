// @flow
import type {
  RawDataUploadDataRequest,
  MobileAppKycRecordStatus,
  BlockpassMobileResponsePayload,
  FindKycByIdHandler,
  CreateKycHandler,
  UpdateKycHandler,
  QueryKycStatusHandler,
  ReSubmitCheckHandler,
  GenerateSsoPayloadHandler,
  GenerateRedirectPayloadHandler,
  ConstructorParams
} from './flowTypes.js'

const EventEmitter = require('events')
const BlockPassHttpProvider = require('./BlockPassHttpProvider')
const jwt = require('jsonwebtoken')

/**
 * @class Class ServerSdk
 */
class ServerSdk extends EventEmitter {
  findKycById: FindKycByIdHandler
  createKyc: CreateKycHandler
  updateKyc: UpdateKycHandler
  queryKycStatus: QueryKycStatusHandler
  onResubmitKycData: ?ReSubmitCheckHandler
  generateSsoPayload: ?GenerateSsoPayloadHandler
  redirectAfterCompletedRegisterPayload: ?GenerateRedirectPayloadHandler
  blockPassProvider: any
  serviceMetaData: any
  requiredFields: [string]
  optionalFields: [string]
  certs: [string]
  secretId: string
  clientId: string
  encodeSessionData: ?(payload: any) => string
  decodeSessionData: ?(token: string) => ?Object
  debug: boolean
  autoFetchMetadata: boolean

  /**
   *
   * @param {ConstructorParams} params
   */
  constructor ({
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
  }: ConstructorParams) {
    super()
    if (clientId == null) {
      throw new Error('Missing clientId or secretId')
    }

    if (
      findKycById == null ||
      (findKycById != null && typeof findKycById !== 'function')
    ) {
      throw new Error('findKycById should be null or function')
    }

    if (
      createKyc == null ||
      (createKyc != null && typeof createKyc !== 'function')
    ) {
      throw new Error('createKyc should be null or function')
    }

    if (
      updateKyc == null ||
      (updateKyc != null && typeof updateKyc !== 'function')
    ) {
      throw new Error('updateKyc should be null or function')
    }

    if (
      queryKycStatus == null ||
      (queryKycStatus != null && typeof queryKycStatus !== 'function')
    ) {
      throw new Error('queryKycStatus should be null or function')
    }

    this.findKycById = findKycById
    this.createKyc = createKyc
    this.updateKyc = updateKyc
    this.queryKycStatus = queryKycStatus

    this.onResubmitKycData = onResubmitKycData
    this.generateSsoPayload = generateSsoPayload
    this.redirectAfterCompletedRegisterPayload = redirectAfterCompletedRegisterPayload
    this.encodeSessionData = encodeSessionData
    this.decodeSessionData = decodeSessionData

    this.blockPassProvider = new BlockPassHttpProvider({
      baseUrl,
      clientId,
      secretId
    })
    this.clientId = clientId
    this.secretId = secretId
    this.requiredFields = requiredFields
    this.optionalFields = optionalFields
    this.certs = certs
    this.debug = debug
    this.autoFetchMetadata = autoFetchMetadata

    this.fetchMetadata()
  }

  /**
   * Refresh service Metadata
   */
  async fetchMetadata () {
    // Disable auto fetch
    if (!this.autoFetchMetadata) {
      setImmediate(() => {
        this.emit('onLoaded')
      })
      return null
    }

    const serviceMetaData = await this.blockPassProvider.queryServiceMetadata()

    if (!serviceMetaData) {
      return this.emit('onError', {
        code: 404,
        msg: 'Client id not found'
      })
    }

    this.serviceMetaData = serviceMetaData.data
    this.requiredFields = this.serviceMetaData.identities.map(itm => itm.slug)
    this.certs = this.serviceMetaData.certRequirement

    return this.emit('onLoaded')
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
  async loginFow ({
    code,
    sessionCode,
    refId
  }: {
    code: string,
    sessionCode: string,
    refId?: string
  }): Promise<BlockpassMobileResponsePayload> {
    if (code == null || sessionCode == null) {
      throw new Error('Missing code or sessionCode')
    }

    const kycToken = await this.blockPassProvider.doHandShake(code, sessionCode)
    if (kycToken == null) throw new Error('Handshake failed')

    this._activityLog('[BlockPass]', kycToken)

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken)
    if (kycProfile == null) throw new Error('Sync info failed')

    this._activityLog('[BlockPass]', kycProfile)

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id))
    const isNewUser = kycRecord == null
    if (!isNewUser) throw new Error('User has already registered')

    kycRecord = await Promise.resolve(
      this.createKyc({ kycProfile, kycToken, refId })
    )

    const payload = {}
    payload.nextAction = 'upload'
    payload.requiredFields = this.requiredFields
    payload.optionalFields = this.optionalFields
    payload.certs = this.certs

    // Request upload data
    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        sessionCode,
        redirectForm: 'login'
      }),
      ...payload
    }
  }

  /**
   * -----------------------------------------------------------------------------------
   * Handle user data upload and fill-up kycRecord
   *  - Step 1: restore session from accessToken
   *  - Step 2: validate required fields provided by client vs serviceMetaData(required / optional)
   *  - Step 3: update raw data to kycRecord
   * @param {RawDataUploadDataRequest} params
   */
  async updateDataFlow ({
    accessToken,
    slugList,
    ...userRawData
  }: {
    accessToken: string,
    slugList: [string],
    userRawData: RawDataUploadDataRequest
  }): Promise<BlockpassMobileResponsePayload> {
    if (!slugList) throw new Error('Missing slugList')

    const decodeData = this._decodeDataFromToken(accessToken)
    if (!decodeData) throw new Error('Invalid Access Token')
    const {
      kycId,
      kycToken,
      sessionCode,
      redirectForm,
      ...uploadSessionData
    } = decodeData

    let kycRecord = await Promise.resolve(this.findKycById(kycId))
    if (!kycRecord) throw new Error('Kyc record could not found')

    // query kyc profile
    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken)
    if (kycProfile == null) throw new Error('Sync info failed')

    // matching existing record
    kycRecord = await Promise.resolve(
      this.updateKyc({
        kycRecord,
        kycProfile,
        kycToken,
        userRawData,
        uploadSessionData
      })
    )

    const payload = {
      nextAction: 'none',
      message: 'welcome back'
    }

    // Handle post-upload behavior
    //  from: Login -> ssoNotify
    //  from: Register -> open-web
    if (redirectForm === 'login') {
      const ssoData = await Promise.resolve(
        this.generateSsoPayload
          ? this.generateSsoPayload({
            kycProfile,
            kycRecord,
            kycToken,
            payload
          })
          : {}
      )
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      )
      this._activityLog('[BlockPass] login success', res)
    } else if (redirectForm === 'register' || redirectForm === 'resubmit') {
      // Redirect to website
      if (this.redirectAfterCompletedRegisterPayload) {
        const redirectParams = await this.redirectAfterCompletedRegisterPayload(
          {
            kycProfile,
            kycRecord,
            kycToken,
            payload
          }
        )

        if (redirectParams) {
          return {
            nextAction: 'redirect',
            ...redirectParams
          }
        }
      }
    }

    return {
      ...payload
    }
  }

  /**
   * -----------------------------------------------------------------------------------
   * Register flow, receiving user sign-up infomation and creating KycProcess.
   * This behaves the same as loginFlow except for it does not require sessionCode input
   * @param {Object} params
   */
  async registerFlow ({
    code,
    refId
  }: {
    code: string,
    refId?: string
  }): Promise<BlockpassMobileResponsePayload> {
    if (code == null) throw new Error('Missing code or sessionCode')

    const kycToken = await this.blockPassProvider.doHandShake(code)
    if (kycToken == null) throw new Error('Handshake failed')

    this._activityLog('[BlockPass]', kycToken)

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken)
    if (kycProfile == null) throw new Error('Sync info failed')

    this._activityLog('[BlockPass]', kycProfile)

    let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id))
    const isNewUser = kycRecord == null
    if (!isNewUser) throw new Error('User has already registered')

    kycRecord = await Promise.resolve(
      this.createKyc({ kycProfile, kycToken, refId })
    )

    const payload = {}
    payload.nextAction = 'upload'
    payload.requiredFields = this.requiredFields
    payload.optionalFields = this.optionalFields
    payload.certs = this.certs

    return {
      accessToken: this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        redirectForm: 'register'
      }),
      ...payload
    }
  }

  /**
   * -----------------------------------------------------------------------------------
   * Query status of kyc record
   * @param {Object} params
   */
  async queryStatusFlow ({
    code,
    sessionCode
  }: {
    code: string,
    sessionCode: ?string
  }): Promise<MobileAppKycRecordStatus> {
    if (code == null) throw new Error('Missing code or sessionCode')

    const handShakePayload = [code]

    if (sessionCode) handShakePayload.push(sessionCode)

    const kycToken = await this.blockPassProvider.doHandShake(
      ...handShakePayload
    )
    if (kycToken == null) throw new Error('Handshake failed')

    this._activityLog('[BlockPass]', kycToken)

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken)
    if (kycProfile == null) throw new Error('Sync info failed')

    this._activityLog('[BlockPass]', kycProfile)

    const kycRecord = await Promise.resolve(this.findKycById(kycProfile.id))

    if (!kycRecord) {
      return {
        status: 'notFound',
        ...this._serviceRequirement()
      }
    }

    const kycStatus = await Promise.resolve(this.queryKycStatus({ kycRecord }))

    // checking fields
    const { status, identities } = kycStatus

    if (!status) {
      throw new Error('[queryKycStatus] return missing fields: status')
    }
    if (!identities) {
      throw new Error('[queryKycStatus] return missing fields: identities')
    }

    // Notify sso complete
    const payload = {}
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
      )
      const res = await this.blockPassProvider.notifyLoginComplete(
        kycToken,
        sessionCode,
        ssoData
      )
      this._activityLog('[BlockPass] login success', res)
    }

    return {
      ...kycStatus
    }
  }

  /**
   * -----------------------------------------------------------------------------------
   * Resubmit data flow
   * @param {Object} params
   */
  async resubmitDataFlow ({
    code,
    fieldList,
    certList
  }: {
    code: string,
    fieldList: [string],
    certList: [string]
  }) {
    if (code == null) throw new Error('Missing code')
    if (!fieldList || !certList) {
      throw new Error('Missing fieldList or certList')
    }

    const fieldCheck = fieldList.every(
      itm => this.requiredFields.indexOf(itm) !== -1
    )
    const cerCheck = certList.every(itm => this.certs.indexOf(itm) !== -1)
    if (!fieldCheck || !cerCheck) {
      throw new Error('Invalid fieldList or certList name')
    }

    const handShakePayload = [code]

    const kycToken = await this.blockPassProvider.doHandShake(
      ...handShakePayload
    )
    if (kycToken == null) throw new Error('Handshake failed')

    this._activityLog('[BlockPass]', kycToken)

    const kycProfile = await this.blockPassProvider.doMatchingData(kycToken)
    if (kycProfile == null) throw new Error('Sync info failed')

    this._activityLog('[BlockPass]', kycProfile)

    const kycRecord = await Promise.resolve(this.findKycById(kycProfile.id))

    if (!kycRecord) {
      throw new Error('[BlockPass][resubmitDataFlow] kycRecord not found')
    }

    let payload = {
      nextAction: 'upload',
      requiredFields: fieldList,
      certs: certList
    }

    if (this.onResubmitKycData) {
      payload = await Promise.resolve(
        this.onResubmitKycData({
          kycProfile,
          kycRecord,
          kycToken,
          payload,
          fieldList,
          certList
        })
      )
    }

    let accessToken = null
    if (payload.nextAction === 'upload') {
      accessToken = this._encodeDataIntoToken({
        kycId: kycProfile.id,
        kycToken,
        redirectForm: 'resubmit',
        reSubmitInfo: {
          fieldList,
          certList
        }
      })
    }

    return {
      accessToken,
      ...payload
    }
  }

  // -----------------------------------------------------------------------------------
  /**
   * Reject a given Certificate
   */
  async userNotify ({
    message,
    action = '',
    bpToken,
    type // info | success | warning
  }: {
    message: string,
    action: string,
    bpToken: any,
    type: 'info' | 'success' | 'warning'
  }) {
    const res = await this.blockPassProvider.notifyUser(
      bpToken,
      message,
      action,
      type
    )
    return res
  }

  // -----------------------------------------------------------------------------------
  /**
   * Deactivate connection with user
   */
  async deactivateUser ({ bpToken }: { bpToken: any }) {
    const res = await this.blockPassProvider.deactivateUser(bpToken)
    return res
  }

  // -----------------------------------------------------------------------------------
  _activityLog (...args: any) {
    if (this.debug) console.log(...args)
  }

  _encodeDataIntoToken (payload: Object) {
    const { encodeSessionData } = this
    if (encodeSessionData) return encodeSessionData(payload)

    return jwt.sign(payload, this.secretId)
  }

  _decodeDataFromToken (accessToken: string): any {
    try {
      const { decodeSessionData } = this
      if (decodeSessionData) return decodeSessionData(accessToken)

      return jwt.verify(accessToken, this.secretId)
    } catch (error) {
      return null
    }
  }

  _serviceRequirement (): Object {
    const { requiredFields, certs } = this

    const identities = requiredFields.map(itm => ({
      slug: itm,
      status: ''
    }))

    const certificates = certs.map(itm => ({
      slug: itm,
      status: ''
    }))

    return {
      identities,
      certificates
    }
  }
}

module.exports = ServerSdk
