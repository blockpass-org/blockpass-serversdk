const faker = require('faker')
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
async function createKyc ({ kycProfile, refId }) {
  const { id, smartContractId, rootHash, isSynching } = kycProfile
  const newIns = new KYCModel({
    blockPassID: id,
    refId,
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
  const { phone } = kycRecord
  const phoneStatus = {
    status: phone ? 'recieved' : 'missing',
    slug: 'phone'
  }
  return {
    status,
    message: '',
    createdDate: new Date(),
    identities: [phoneStatus],
    certificates: [],
    allowResubmit: true
  }
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

function createIns ({ find, create, update, reCheck, query, ssoPayload } = {}) {
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
    generateSsoPayload: generateSsoPayload || ssoPayload
  })
}

describe('login', () => {
  beforeEach(() => {
    KYCModel.reset()
  })

  test('login[missing params', async () => {
    const bpFakeUserId = Date.now().toString()

    const ins = createIns()

    const step1 = ins.loginFow({ code: bpFakeUserId })
    expect(step1).rejects.toEqual(new Error('Missing code or sessionCode'))

    blockpassApiMock.checkPending()
    blockpassApiMock.clearAll()
  })

  test('login[new record] wrong sessionToken', async () => {
    const bpFakeUserId = Date.now().toString()
    const sessionCode = '1xxx'

    // Mock API
    blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
    blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

    const ins = createIns()

    const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode })
    expect(step1.nextAction).toEqual('upload')
    expect(step1.requiredFields).toEqual(REQUIRED_FIELDS)

    const rawData = {
      phone: {
        type: 'string',
        value: faker.phone.phoneNumber()
      }
    }
    const step2 = ins.updateDataFlow({
      accessToken: 'wrong',
      slugList: step1.requiredFields,
      ...rawData
    })

    expect(step2).rejects.toEqual(new Error('Invalid Access Token'))

    blockpassApiMock.checkPending()
    blockpassApiMock.clearAll()
  })

  test('login[new record]', async () => {
    const bpFakeUserId = Date.now().toString()
    const sessionCode = '1xxx'
    const refId = 'i-am-ref-id' + Date.now().toString()

    // Mock API
    blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
    blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 2)
    blockpassApiMock.mockSSoComplete(FAKE_BASEURL)

    const ins = createIns()

    const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode, refId })
    expect(step1.nextAction).toEqual('upload')
    expect(step1.requiredFields).toEqual(REQUIRED_FIELDS)

    const rawData = {
      phone: {
        type: 'string',
        value: faker.phone.phoneNumber()
      }
    }
    const step2 = await ins.updateDataFlow({
      accessToken: step1.accessToken,
      slugList: step1.requiredFields,
      ...rawData
    })

    expect(step2.nextAction).toEqual('none')

    // check refId
    const model = await KYCModel.findOne({
      blockPassID: bpFakeUserId
    })
    expect(model.refId).toEqual(refId)

    blockpassApiMock.checkPending()
    blockpassApiMock.clearAll()
  })

  test('login[existing record] - error', async () => {
    const bpFakeUserId = '1522257024962'
    const sessionCode = '1xxx'

    // Mock API
    blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
    blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

    const ins = createIns()

    try {
      await ins.loginFow({ code: bpFakeUserId, sessionCode })
    } catch (err) {
      expect(err.message).toEqual('User has already registered')
    }

    blockpassApiMock.checkPending()
    blockpassApiMock.clearAll()
  })

  test('login[existing record not full-fill] resubmit missing data', async () => {
    const bpFakeUserId = '1522257024960'
    const sessionCode = '1xxx'

    // Mock API
    blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId, null, 2)
    blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 3)
    blockpassApiMock.mockSSoComplete(FAKE_BASEURL)

    const ins = createIns()

    // check status
    const resStatus = await ins.queryStatusFlow({
      code: bpFakeUserId,
      sessionCode
    })
    expect(resStatus.allowResubmit).toEqual(true)
    expect(resStatus.identities[0].slug).toEqual('phone')
    expect(resStatus.identities[0].status).toEqual('missing')

    // resubmit
    const step2 = await ins.resubmitDataFlow({
      code: bpFakeUserId,
      fieldList: ['phone'],
      certList: []
    })

    expect(step2.nextAction).toEqual('upload')

    // upload missing data
    const rawData = {
      phone: {
        type: 'string',
        value:
          '{"countryCode":"VNM","countryCode2":"vn","phoneNumber":"+84987543212","number":"987543212"}'
      }
    }
    const step3 = await ins.updateDataFlow({
      accessToken: step2.accessToken,
      slugList: step2.requiredFields,
      ...rawData
    })
    expect(step3.nextAction).toEqual('none')

    blockpassApiMock.checkPending()
    blockpassApiMock.clearAll()
  })
})
