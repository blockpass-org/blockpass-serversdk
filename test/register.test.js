const faker = require('faker');
const ServerSdk = require('../src')
const Memories = require('./utils/Memories');
const blockpassApiMock = require('./utils/_unitTestMock');
const { KYCModel, FileStorage } = Memories;

const FAKE_CLIENTID = "unitTest"
const FAKE_SECRETID = "unitTest"
const FAKE_BASEURL = "http://mockapi"
const REQUIRED_FIELDS = ['phone']
const OPTIONAL_FIELDS = []
const OPTIONAL_CERTS = ['onfido']

//-------------------------------------------------------------------------
//  Logic Handler
//-------------------------------------------------------------------------
async function findKycById(kycId) {
    return await KYCModel.findOne({ blockPassID: kycId })
}

//-------------------------------------------------------------------------
async function createKyc({ kycProfile }) {
    const { id, smartContractId, rootHash, isSynching } = kycProfile;
    const newIns = new KYCModel({
        blockPassID: id,
        rootHash,
        smartContractId,
        isSynching
    })

    return await newIns.save()
}

//-------------------------------------------------------------------------
async function updateKyc({
    kycRecord,
    kycProfile,
    kycToken,
    userRawData
}) {
    const { id, smartContractId, rootHash, isSynching } = kycProfile;

    const jobs = Object.keys(userRawData).map(async (key) => {
        const metaData = userRawData[key];

        if (metaData.type == 'string')
            return kycRecord[key] = metaData.value

        const { buffer, originalname } = metaData;
        const ext = originalname.split('.')[1];
        const fileName = `${id}_${key}.${ext}`;
        const fileHandler = await FileStorage.writeFile({
            fileName,
            mimetype: `image/${ext}`,
            fileBuffer: buffer
        })

        return kycRecord[key] = fileHandler._id
    })

    const waitingJob = await Promise.all(jobs);

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

//-------------------------------------------------------------------------
async function queryKycStatus({ kycRecord }) {
    const status = kycRecord.status

    return {
        status,
        message: '',
        createdDate: new Date(),
        identities: [],
        certificates: []
    }
}

async function needRecheckExistingKyc({ kycProfile, kycRecord, payload }) {

    // if (!(kycRecord.fristName && kycRecord.phone && kycRecord.lastName))
    //     return {
    //         ...payload,
    //         nextAction: 'upload',
    //         requiredFields: REQUIRED_FIELDS,
    //         optionalFields: OPTIONAL_FIELDS,
    //     }

    return payload;
}

//-------------------------------------------------------------------------
async function generateSsoPayload({ kycProfile, kycRecord, kycToken, payload }) {
    return {
        _id: kycRecord._id,
    }
}


function createIns({ find, create, update, reCheck, query, ssoPayload } = {}) {
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

describe("register", () => {

    beforeEach(() => {
        KYCModel.reset();
    })

    it("register[new record]", async () => {
        const bpFakeUserId = Date.now().toString();

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 2)

        const ins = createIns();

        const step1 = await ins.registerFlow({code: bpFakeUserId})
        expect(step1.nextAction).toEqual('upload')
        expect(step1.requiredFields).toEqual(REQUIRED_FIELDS)


        const rawData = {
            "phone": {
                type: "string",
                value: faker.phone.phoneNumber()
            }
        }
        const step2 = await ins.updateDataFlow({
            accessToken: step1.accessToken,
            slugList: step1.requiredFields,
            ...rawData
        })

        expect(step2.nextAction).toEqual('none')

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("register[existing record]", async () => {
        const bpFakeUserId = '1522257024962';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

        const ins = createIns();

        const step1 = await ins.registerFlow({code: bpFakeUserId})
        expect(step1.nextAction).toEqual('none')

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

});
