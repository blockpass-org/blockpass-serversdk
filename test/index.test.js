const ServerSdk = require('../src')
const Memories = require('./utils/Memories')
const blockpassApiMock = require('./utils/_unitTestMock')
const { KYCModel, FileStorage } = Memories

const FAKE_CLIENTID = 'unitTest'
const FAKE_SECRETID = 'unitTest'
const FAKE_BASEURL = 'http://mockapi'
const REQUIRED_FIELDS = ['phone']
const OPTIONAL_FIELDS = []
const OPTIONAL_CERTS = ['onfido']

// -------------------------------------------------------------------------
//  Logic Handler
// -------------------------------------------------------------------------
async function findKycById (kycId) {
  return await KYCModel.findOne({ blockPassID: kycId })
}

// -------------------------------------------------------------------------
async function createKyc ({ kycProfile }) {
  const { id, smartContractId, rootHash, isSynching } = kycProfile
  const newIns = new KYCModel({
    blockPassID: id,
    rootHash,
    smartContractId,
    isSynching
  })

  return await newIns.save()
}

// -------------------------------------------------------------------------
async function updateKyc ({ kycRecord, kycProfile, kycToken, userRawData }) {
  const { id, smartContractId, rootHash, isSynching } = kycProfile

  const jobs = Object.keys(userRawData).map(async key => {
    const metaData = userRawData[key]

    if (metaData.type === 'string') return (kycRecord[key] = metaData.value)

    const { buffer, originalname } = metaData
    const ext = originalname.split('.')[1]
    const fileName = `${id}_${key}.${ext}`
    const fileHandler = await FileStorage.writeFile({
      fileName,
      mimetype: `image/${ext}`,
      fileBuffer: buffer
    })

    return (kycRecord[key] = fileHandler._id)
  })

  await Promise.all(jobs)

  // calculate token expired date from 'expires_in'
  const expiredDate = new Date(Date.now() + kycToken.expires_in * 1000)
  kycRecord.bpToken = {
    ...kycToken,
    expires_at: expiredDate
  }
  kycRecord.rootHash = rootHash
  kycRecord.smartContractId = smartContractId
  kycRecord.isSynching = isSynching

  return await kycRecord.save()
}

// -------------------------------------------------------------------------
async function queryKycStatus ({ kycRecord }) {
  const status = kycRecord.status

  return {
    status,
    message: '',
    createdDate: new Date(),
    identities: [],
    certificates: []
  }
}

// -------------------------------------------------------------------------
async function needRecheckExistingKyc ({ kycProfile, kycRecord, payload }) {
  // if (!(kycRecord.fristName && kycRecord.phone && kycRecord.lastName))
  //     return {
  //         ...payload,
  //         nextAction: 'upload',
  //         requiredFields: REQUIRED_FIELDS,
  //         optionalFields: OPTIONAL_FIELDS,
  //     }

  return payload
}

// -------------------------------------------------------------------------
async function generateSsoPayload ({
  kycProfile,
  kycRecord,
  kycToken,
  payload
}) {
  return {
    _id: kycRecord._id
  }
}

function createInsManual ({
  find,
  create,
  update,
  reCheck,
  query,
  ssoPayload
} = {}) {
  return new ServerSdk({
    baseUrl: FAKE_BASEURL,
    clientId: FAKE_CLIENTID,
    secretId: FAKE_SECRETID,
    requiredFields: REQUIRED_FIELDS,
    optionalFields: OPTIONAL_FIELDS,
    certs: OPTIONAL_CERTS,

    // Custom implement
    findKycById: findKycById || find,
    createKyc: createKyc || create,
    updateKyc: updateKyc || update,
    queryKycStatus: queryKycStatus || query,
    needRecheckExistingKyc: needRecheckExistingKyc || reCheck,
    generateSsoPayload: generateSsoPayload || ssoPayload
  })
}

function createInsWithAutoFetch ({
  find,
  create,
  update,
  reCheck,
  query,
  ssoPayload
} = {}) {
  return new ServerSdk({
    baseUrl: FAKE_BASEURL,
    clientId: FAKE_CLIENTID,
    secretId: FAKE_SECRETID,
    autoFetchMetadata: true,

    // Custom implement
    findKycById: findKycById || find,
    createKyc: createKyc || create,
    updateKyc: updateKyc || update,
    queryKycStatus: queryKycStatus || query,
    needRecheckExistingKyc: needRecheckExistingKyc || reCheck,
    generateSsoPayload: generateSsoPayload || ssoPayload
  })
}

describe('basic', () => {
  beforeEach(() => {
    KYCModel.reset()
  })

  test('init-sdk', () => {
    const ins = createInsManual()
    expect(ins).not.toBeNull()
  })

  test('init-sdk-autoFetch', done => {
    blockpassApiMock.mockQueryServiceMetadata(
      FAKE_BASEURL,
      FAKE_CLIENTID,
      require('./utils/_serviceMetadata.json')
    )

    const ins = createInsWithAutoFetch()
    expect(ins).not.toBeNull()
    ins.on('onLoaded', _ => {
      expect(ins.requiredFields).toEqual([
        'address',
        'dob',
        'email',
        'family_name',
        'given_name',
        'passport',
        'phone',
        'proof_of_address',
        'selfie'
      ])
      done()
    })
  })
})
