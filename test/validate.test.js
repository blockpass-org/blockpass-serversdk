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

const PROOF_LIST = {
    "phone": [
        {
            "parent": "8fe3d939a77cf7431f81f5c90293444e96b30417fab43d67674566af0f0d302b",
            "left": "cd5ea2c19e4e01ac28345749bc48882c299e2dbb2398b23e82531583f22fe59f",
            "right": "1fb9acd13760f238e64ea7bc87b776799c55a4a0b94bb68a7fc9be4930b1b1af"
        },
        {
            "parent": "672276ede571a3e4b461b53057b766b287c3d0e05bb003222c84a9a96bd72651",
            "left": "8fe3d939a77cf7431f81f5c90293444e96b30417fab43d67674566af0f0d302b",
            "right": "5b43a0086ddc5aca1aae722ac5a8a328b8539af5e83ce7232802f075d718a696"
        },
        {
            "parent": "05d72fa347994a3ae0228d898ee55054975b2dfd7a6a30592e8ee06c0cfde1ac",
            "left": "6dbdc13d7bc9d2776211398e7059f2bd1870083a2a29448456a30adcc1c4ce00",
            "right": "672276ede571a3e4b461b53057b766b287c3d0e05bb003222c84a9a96bd72651"
        },
        {
            "parent": "01edf3645eef35d41b315523b5f62849f3ca0dbc07b3562d9245d9c7ce88a2bb",
            "left": "05d72fa347994a3ae0228d898ee55054975b2dfd7a6a30592e8ee06c0cfde1ac",
            "right": "a28adb8671b32df77db8150fbfc5eb4ee98007abf2e2169e48f64ba06a9322d5"
        }
    ]
}
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
        needRecheckExistingKyc: needRecheckExistingKyc || reCheck,
        generateSsoPayload: generateSsoPayload || ssoPayload
    })
}

describe("validate", () => {

    beforeEach(() => {
        KYCModel.reset();
    })

    it("validate proof of path", async () => {
        const kycId = '5addc3a70476a51e3c3f4290';

        blockpassApiMock.mockQueryProofOfPath(FAKE_BASEURL, {
            status: 'success',
            proofList: PROOF_LIST
        });

        const ins = createIns();

        const kycRecord = await KYCModel.findById(kycId)

        // Query proof path
        const step1 = await ins.queryProofOfPath({
            kycToken: kycRecord.bpToken,
            slugList: ['phone']
        })
        const {proofOfPath, bpToken} = step1;

        // Check-again with root hash
        const validateRes = ins.merkleProofCheckSingle(kycRecord.rootHash, kycRecord.phone, proofOfPath.proofList['phone'])

        expect(validateRes).toEqual(true);

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

    it("validate proof of path and accessToken refresh", async () => {
        const kycId = '5ad967142219d02223ae44b3';

        blockpassApiMock.mockQueryProofOfPath(FAKE_BASEURL, {
            status: 'success',
            proofList: PROOF_LIST
        });
        blockpassApiMock.mockQueryRefreshToken(FAKE_BASEURL)

        const ins = createIns();

        const kycRecord = await KYCModel.findById(kycId)

        // Query proof path
        const step1 = await ins.queryProofOfPath({
            kycToken: kycRecord.bpToken,
            slugList: ['phone']
        })
        const {proofOfPath, bpToken} = step1;

        expect(proofOfPath).not.toBeNull();
        expect(bpToken).not.toBeNull();

        blockpassApiMock.checkPending();
        blockpassApiMock.clearAll();
    })

});
