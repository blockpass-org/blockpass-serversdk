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

async function needRecheckExitingKyc({ kycProfile, kycRecord, payload }) {

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


function createIns({ find, create, update, reCheck, ssoPayload } = {}) {
    return new ServerSdk({
        baseUrl: FAKE_BASEURL,
        clientId: FAKE_CLIENTID,
        secretId: FAKE_SECRETID,
        requiredFields: REQUIRED_FIELDS,
        optionalFields: OPTIONAL_FIELDS,

        // Custom implement
        findKycById: findKycById || find,
        createKyc: createKyc || create,
        updateKyc: updateKyc || update,
        needRecheckExitingKyc: needRecheckExitingKyc || reCheck,
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

    it("register[exiting record]", async () => {
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

    it("register[missing critical fields]", async () => {
        const bpFakeUserId = Date.now().toString();

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

        const ins = createIns();

        const step1 = await ins.registerFlow({code: bpFakeUserId})
        expect(step1.nextAction).toEqual('upload')
        expect(step1.requiredFields).toEqual(REQUIRED_FIELDS)


        const rawData = {
           
        }
        
        const step2 = ins.updateDataFlow({
            accessToken: step1.accessToken,
            slugList: step1.requiredFields,
            ...rawData
        })
        expect(step2).rejects.toEqual(new Error('Missing critical slug'))
        

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })
    
    it("register[missing match slug]", async () => {
        const bpFakeUserId = Date.now().toString();

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

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
        
        const step2 = ins.updateDataFlow({
            accessToken: step1.accessToken,
            slugList: [],
            ...rawData
        })
        expect(step2).rejects.toEqual(new Error('Missing critical slug'))
        

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

});
