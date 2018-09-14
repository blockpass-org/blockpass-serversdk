# Blockpass Server SDK

## Working Flow:

![flow](doc/mobile-app-endpoints.png)

## Terms:

* **Endpoints**:

  * `/status`: Kyc status endpoints. Called by mobile app. Response **KycRecordStatus**
  * `/login`: SSO endpoints. Called by mobile app. Triggered by scanning qr code or opening Applink
  * `/register`: Registration or re-new certificate request (later). Triggered by pressing **Register** button on mobile application
  * `/resubmit`: Update data for existing KYC record
  * `/upload`: Upload user rawData. Triggered when mobile application receives **nextAction=upload** returned by `/login`, `/register` or `/resubmit`

* **KycProfile**: User profile object returned by Blockpass Api
* **KycToken**: Access token object. Use to exchange data between Services and Blockpass API (each user will have different token)
* **KycRecord**: Object stored kyc data, managed by Services. It usually contains 3 parts(BlockpassKycProfile + RawData + Service Extra Info)

Example:

```javascript
{
    //
    //[Blockpass-KycProfile]
    //

    blockpassId: 'service_udid',// udid of user ( unique for each services )
    kycToken: {...}, // kycToken for this user
    rootHash: 'sha3-hash' // user root of merke tree
    isSynching: "syncing" | "complete" // status of smartcontract syncing

    //
    //[Blockpass-RawData]
    //

    phone: xxx,
    email: yyy,
    [cer]onfido: '....',

    //
    //[Service Extra info]
    //
    etherAddress: '....'
}
```

* **KycRecordStatus**: Object stored kycRecord status following Mobile App format

```javascript
// Format
{
    status: 'notFound|waiting|inreview|approved',
    message: 'summary current status',
    createdDate: 'DateTime KycRecord created',
    allowResubmit: true|false
    identities: [
        {
            slug: 'slug name',
            status: 'received|rejected| approved|missing',
            comment: 'reviewer comment'
        },
        //....
    ],
    certificates: [
        {
            slug: 'slug name',
            status: 'received|rejected| approved|missing',
            comment: 'reviewer comment'
        },
        //....
    ]
}
```

## Getting Started

* **Step 1**: Declare logic handler

  1.  `findKycById`: Find and return KycRecord
  2.  `createKyc`: Create new kycRecord
  3.  `updateKyc`: Update kycRecord
  4.  `queryKycStatus`: Query KycRecord status
  5.  `generateSsoPayload`: Generate SSo payload (this custom data will be sent to web-client)

```javascript
const sdk = new ServerSdk({

    // Developer dashboard fields
    baseUrl: BLOCKPASS_BASEURL,
    clientId: SERVICE_CLIENTID,
    secretId: SERVICE_SECRETID,
    autoFetchMetadata: true

    // Custom implement
    findKycById: findKycById ,
    createKyc: createKyc,
    updateKyc: updateKyc,
    queryKycStatus: queryKycStatus,
    generateSsoPayload: generateSsoPayload
})

sdk.once('onLoaded', _ => {
    // Sdk loaded
})

sdk.once('onError' _ => {
    // Sdk init error
})

//-------------------------------------------------------------------------
// lookup blockpassId -> kycRecord
//-------------------------------------------------------------------------
async function findKycById(blockpassId) {
    return await KYCModel.findOne({ blockPassID })
}

//-------------------------------------------------------------------------
// Update create new kycRecord
//-------------------------------------------------------------------------
async function createKyc({ kycProfile, refId }) {
    const { id, smartContractId, rootHash, isSynching } = kycProfile;
    const newIns = new KYCModel({
        blockPassID: id,
        refId,
        rootHash,
        smartContractId,
        isSynching
    })

    return await newIns.save()
}

//-------------------------------------------------------------------------
// Update rawData -> kycRecord
//-------------------------------------------------------------------------
async function updateKyc({
    kycRecord,
    kycProfile,
    kycToken,
    userRawData
}) {
    const { id, smartContractId, rootHash, isSynching } = kycProfile;

    // Store file and raw data fields -> kycRecord
    const jobs = Object.keys(userRawData).map(async (key) => {
        const metaData = userRawData[key];

        if (metaData.type === 'string')
            return kycRecord[key] = metaData.value

        if (metaData.type === 'file') {
            const { buffer, originalname } = metaData;
            const ext = originalname.split('.')[1];
            const fileName = `${id}_${key}.${ext}`;

            // store file somewhere
            const fileHandler = await FileStorage.writeFile({
                fileName,
                mimetype: `image/${ext}`,
                fileBuffer: buffer
            })

            return kycRecord[key] = fileHandler._id
        }
    })

    await Promise.all(jobs);

    // [Advanced] - Link kyc record with existing user data in your database
    // Example: This email|phone contained in our database

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
// Return KycRecord Status for Mobile application
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

//-------------------------------------------------------------------------
// Kyc successfull. Generate services token for client
//-------------------------------------------------------------------------
async function generateSsoPayload({ kycProfile, kycRecord, kycToken, payload }) {
    return {
        _id: kycRecord._id,
        serviceToken: '...' // AccessToken for services
    }
}
```

* **Step 2**: Create api:
  1.  /login -> sdk.loginFow(...)
  2.  /upload -> sdk.updateDataFlow(...)
  3.  /register -> sdk.registerFlow(...)
  4.  /status -> sdk.queryStatusFlow(...)
  5.  /resubmit -> sdk.resubmitDataFlow(...)


    Ps: See express `examples`

## Development Commands

```sh
$ npm test # run tests with Jest
$ npm run coverage # run tests with coverage and open it on browser
$ npm run lint # lint code
$ npm run docs # generate docs
$ npm run build # generate docs and transpile code
```

## API Documents

[Documents](./doc/api.md)

## License

ApacheV2
