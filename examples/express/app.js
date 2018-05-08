const express = require('express')
const bodyParser = require('body-parser');
const cors = require('cors')
const multer = require('multer');
const ServerSDK = require('../../dist');
const { KYCModel, FileStorage } = require('./SimpleStorage');

const config = {
    BASE_URL: 'http://api.sandbox.blockpass.org',
    BLOCKPASS_CLIENT_ID: 'test',
    BLOCKPASS_SECRET_ID: 'test',
    REQUIRED_FIELDS: ['phone'],
    OPTIONAL_FIELDS: [],
    OPTIONAL_CERTS: ['onfido']
}


//-------------------------------------------------------------------------
//  Blockpass Server SDK
//-------------------------------------------------------------------------
const serverSdk = new ServerSDK({
    baseUrl: config.BASE_URL,
    clientId: config.BLOCKPASS_CLIENT_ID,
    secretId: config.BLOCKPASS_SECRET_ID,
    requiredFields: config.REQUIRED_FIELDS,
    optionalFields: config.OPTIONAL_FIELDS,
    certs: config.OPTIONAL_CERTS

    // Custom implement
    findKycById: findKycById,
    createKyc: createKyc,
    updateKyc: updateKyc,
    queryKycStatus: queryKycStatus,
    needRecheckExistingKyc: needRecheckExistingKyc,
    generateSsoPayload: generateSsoPayload

})

//-------------------------------------------------------------------------
//  Logic Handler
//-------------------------------------------------------------------------
async function findKycById(kycId) {
    return await KYCModel.findOne({ blockPassID: kycId })
}

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

    return payload;
}

async function generateSsoPayload({ kycProfile, kycRecord, kycToken, payload }) {
    return {
        _id: kycRecord._id,
    }
}

async function queryKycStatus({ kycRecord }) {
    const status = kycRecord.status

    return {
        status,
        message: 'This process usually take 2 working days',
        createdDate: new Date(),
        identities: [{
            slug: 'phone',
            status: 'received', //"received" | "approved" | "rejected" | "missing"
            comment: ''
        }],
        certificates: []
    }
}

//-------------------------------------------------------------------------
// Express app
//-------------------------------------------------------------------------
const app = express()
const upload = multer();


// Allow access origin
app.use(cors({}));
app.disable('x-powered-by');

// middleware
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

const router = express.Router();
app.use(router);

router.get('/', (req, res) => {
    res.json("hello")
})

//-------------------------------------------------------------------------
// Api
//-------------------------------------------------------------------------
router.post('/api/uploadData',
    upload.any(),
    async (req, res) => {
        try {
            const { accessToken, slugList, ...userRawFields } = req.body;
            const files = req.files || [];

            // Flattern user data
            const userRawData = {}

            Object.keys(userRawFields).forEach(key => {
                userRawData[key] = {
                    type: 'string',
                    value: userRawFields[key]
                }
            })

            files.forEach(itm => {
                userRawData[itm.fieldname] = {
                    type: 'file',
                    ...itm
                }
            })

            const payload = await serverSdk.updateDataFlow({ accessToken, slugList, ...userRawData })
            return res.json(payload)

        } catch (ex) {
            console.error(ex)
            return res.status(500).json({
                err: 500,
                msg: ex.message,
            })
        }
    })

//-------------------------------------------------------------------------
router.post('/api/login', async (req, res) => {
    try {
        const { code, sessionCode } = req.body;

        const payload = await serverSdk.loginFow({ code, sessionCode })
        return res.json(payload)
    } catch (ex) {
        console.error(ex)
        return res.status(500).json({
            err: 500,
            msg: ex.message,
        })
    }
})

//-------------------------------------------------------------------------
router.post('/api/register', async (req, res) => {
    try {
        const { code } = req.body;

        const payload = await serverSdk.registerFlow({ code })
        return res.json(payload)
    } catch (ex) {
        console.error(ex)
        return res.status(500).json({
            err: 500,
            msg: ex.message,
        })
    }
})

//-------------------------------------------------------------------------
router.post('/api/status', async (req, res) => {
    try {
        const { code, sessionCode } = req.body

        const payload = await serverSdk.queryStatusFlow({ code, sessionCode })
        return res.json(payload)
    } catch (ex) {
        console.error(ex)
        return res.status(500).json({
            err: 500,
            msg: ex.message,
        })
    }
})

const port = process.env.SERVER_PORT || 3000
let server = app.listen(port, '0.0.0.0', function () {
    console.log(`Listening on port ${port}...`)
})

// gracefull shutdown
app.close = _ => server.close();

module.exports = app;