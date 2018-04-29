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

describe("login", () => {

    beforeEach(() => {
        KYCModel.reset();
    })

    it("login[missing params", async () => {
        const bpFakeUserId = Date.now().toString();

        const ins = createIns();

        const step1 = ins.loginFow({ code: bpFakeUserId })
        expect(step1).rejects.toEqual(new Error('Missing code or sessionCode'))

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("login[new record] wrong sessionToken", async () => {
        const bpFakeUserId = Date.now().toString();
        const sessionCode = '1xxx';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)

        const ins = createIns();

        const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode })
        expect(step1.nextAction).toEqual('upload')
        expect(step1.requiredFields).toEqual(REQUIRED_FIELDS)


        const rawData = {
            "phone": {
                type: "string",
                value: faker.phone.phoneNumber()
            }
        }
        const step2 = ins.updateDataFlow({
            accessToken: 'wrong',
            slugList: step1.requiredFields,
            ...rawData
        })

        expect(step2).rejects.toEqual(new Error('Invalid Access Token'))

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("login[new record]", async () => {
        const bpFakeUserId = Date.now().toString();
        const sessionCode = '1xxx';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 2)
        blockpassApiMock.mockSSoComplete(FAKE_BASEURL)

        const ins = createIns();

        const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode })
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

    it("login[exiting record]", async () => {
        const bpFakeUserId = '1522257024962';
        const sessionCode = '1xxx';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 1)
        blockpassApiMock.mockSSoComplete(FAKE_BASEURL)

        const ins = createIns();

        const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode })
        expect(step1.nextAction).toEqual('none')

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("login[exiting record not full-fill] needRecheckExitingKyc return missing data", async () => {
        const bpFakeUserId = '1522257024960';
        const sessionCode = '1xxx';

        // Mock API 
        blockpassApiMock.mockHandShake(FAKE_BASEURL, bpFakeUserId)
        blockpassApiMock.mockMatchingData(FAKE_BASEURL, bpFakeUserId, null, 2)
        blockpassApiMock.mockSSoComplete(FAKE_BASEURL)

        const ins = createIns();

        const step1 = await ins.loginFow({ code: bpFakeUserId, sessionCode })
        expect(step1.nextAction).toEqual('upload')
        expect(step1.requiredFields).toEqual(['phone'])

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

});
