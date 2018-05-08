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

    kycRecord.bpToken = kycToken
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

    if (!(kycRecord.phone))
        return {
            ...payload,
            nextAction: 'upload',
            requiredFields: ['phone']
        }

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

describe("login", () => {

    beforeEach(() => {
        KYCModel.reset();
    })

    it("[not-found] query-kyc", async () => {
        const bpFakeUserId = Date.now().toString();
        const sessionCode = '1xxx';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

        const ins = createIns();

        const step1 = await ins.queryStatusFlow({ code: bpFakeUserId })
        
        expect(step1.status).toEqual('notFound')


        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("[found] query-kyc", async () => {
        const bpFakeUserId = '5ad862240a176722f25fede3';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

        const ins = createIns();

        const step1 = await ins.queryStatusFlow({ code: bpFakeUserId })

        expect(step1.status).toEqual('waiting')

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("[found][sso] query-kyc", async () => {
        const bpFakeUserId = '5ad862240a176722f25fede3';
        const sessionCode = '1';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)
        blockpassApiMock.mockSSoComplete(FAKE_BASEURL);

        const ins = createIns();

        const step1 = await ins.queryStatusFlow({ code: bpFakeUserId, sessionCode  })

        expect(step1.status).toEqual('waiting')

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

});
