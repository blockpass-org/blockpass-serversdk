const baseUrl = require('./config').baseUrl;
const BlockPassHttpProvider = require('./BlockPassServerApi');
const merkleTreeHelper = require('./utils/MerkleHelper');

class ServerSdk {

    /**
     * Constructor
     * @param {string} clientId: CliendId(from developer dashboard)
     * @param {string} secretId: SecretId(from developer dashboard)
     * @param {[string]} requiredFields: Required identities fields(from developer dashboard)
     * @param {[string]} optionalFields: Optional identities fields(from developer dashboard)
     * @param {findKycByIdCallback} findKycById: Find KycRecord by id
     * @param {createKycCallback} createKyc: Create new KycRecord
     * @param {updateKycCallback} updateKyc: Update Kyc
     * @param {needRecheckExitingKycCallback} [needRecheckExitingKyc](optinal): Perform logic to check does
     * this kycRecord need re-submit data
     * @param {generateSsoPayloadCallback} [generateSsoPayload](optinal): Return sso payload
     * . Which contains services access control( service accessToken )
     */
    constructor({ 
        clientId, 
        secretId, 
        requiredFields, 
        optionalFields,
        findKycById,
        createKyc,
        updateKyc,
        needRecheckExitingKyc,
        generateSsoPayload 
    }) {
        if (clientId == null || secretId == null)
            throw new Error('Missing clientId or secretId')

        if (findKycById != null && typeof (findKycById) !== 'function')
            throw new Error('findKycById should be null or function');

        if (createKyc != null && typeof (createKyc) !== 'function')
            throw new Error('createKyc should be null or function');

        if (updateKyc != null && typeof (updateKyc) !== 'function')
            throw new Error('updateKyc should be null or function');

        this.findKycById = findKycById;
        this.createKyc = createKyc;
        this.updateKyc = updateKyc;
        this.needRecheckExitingKyc = needRecheckExitingKyc
        this.generateSsoPayload = generateSsoPayload
        
        BlockPassHttpProvider.init({
            baseUrl: baseUrl(), 
            clientId, 
            secretId
        });
        this.blockPassProvider = BlockPassHttpProvider
        this.requiredFields = requiredFields;
        this.optionalFields = optionalFields;
    }

    /**
     * Login Flow. Which handle SSO and AppLink login from Blockpass client.
     * 
     *  Step 1: Handshake between our service and BlockPass
     *  Step 2: Sync Userprofile with Blockpass Db
     *  Step 3: Base on blockpassId. Some situation below covered 
     *      - register success ( exiting kyc already fill and validated )
     *      - need update user raw data (kyc record)
     *      - need user re-upload infomation ( some fields change / periodic check )
     * @param {string} code: blockpass access code (from blockpass client) 
     * @param {string} sessionCode: sso sessionCode
     */
    async loginFow({ code, sessionCode }) {
        if (code == null || sessionCode == null)
            throw new Error('Missing code or sessionCode');

        const kycToken = await this.blockPassProvider.doHandShake(code, sessionCode);
        if (kycToken == null)
            throw new Error('Handshake failed');

        this._activityLog("[BlockPass]", kycToken);


        const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
        if (kycProfile == null)
            throw new Error('Sync info failed');

        this._activityLog("[BlockPass]", kycProfile);

        let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
        let isNewUser = kycRecord == null;
        if (isNewUser)
            kycRecord = await Promise.resolve(this.createKyc({kycProfile}))

        let payload = {}
        if (isNewUser) {
            payload.nextAction = 'upload';
            payload.requiredFields = this.requiredFields;
            payload.optionalFields = this.optionalFields;
        }
        else{
            payload.message = 'welcome back';
            payload.nextAction = 'none';
        }
            

        if (kycRecord && this.needRecheckExitingKyc) {
            payload = await Promise.resolve(this.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload }))
        }

        // Nothing need to update. Notify sso complete 
        if (payload.nextAction === 'none') {
            const ssoData = await Promise.resolve(this.generateSsoPayload ? this.generateSsoPayload({ kycProfile, kycRecord, kycToken, payload }) : {})
            const res = await this.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
            this._activityLog("[BlockPass] login success", res)
        }

        return {
            accessToken: this.blockPassProvider.encodeDataIntoToken({
                kycId: kycProfile.id,
                kycToken,
                sessionCode
            }),
            ...payload
        }
    }

    /**
     * Recieve user raw data and fill-up kycRecord
     *  - Step1: restore accessToken
     *  - Step2: validate required fields provided by client vs serviceMetaData(required / optional)
     *  - Step3: Trying to matching kycData base on (kyc + bpId). Handle your logic in updateKyc
     *  - Example Advance Scenarios:
     *      - email / phone already used in 2 different records => conclict case should return error
     *      - user already register. Now update user data fields => revoke certificate
     * @param {sessionToken} accessToken: Store encoded data from /login or /register api
     * @param {[string]} slugList: List of identities field supplied by blockpass client
     * @param {Object} userRawData: User raw data from multiform/parts request. Following format below
     * Example: 
     * ``` json
     * {
     *  "phone": { type: 'string', value:'09xxx'},
     *  "selfie": { type: 'file', buffer: Buffer(..), originalname: 'fileOriginalName'}
     *  ....
     * }
     * ```
     */
    async updateDataFlow({ accessToken, slugList, ...userRawData }) {
        if (!slugList)
            throw new Error('Missing slugList')

        const decodeData = this.blockPassProvider.decodeDataFromToken(accessToken);
        if (!decodeData)
            throw new Error('Invalid Access Token')
        const { kycId, kycToken, sessionCode } = decodeData;

        let kycRecord = await Promise.resolve(this.findKycById(kycId));
        if (!kycRecord)
            throw new Error('Kyc record could not found')

        const criticalFieldsCheck = this.requiredFields.every(val => {
            return slugList.indexOf(val) !== -1
                && userRawData[val] != null;
        });

        if (!criticalFieldsCheck)
            throw new Error('Missing critical slug')

        // query kyc profile
        const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
        if (kycProfile == null)
            throw new Error('Sync info failed');

        // matching exiting record
        kycRecord = await Promise.resolve(this.updateKyc({
            kycRecord,
            kycProfile,
            kycToken,
            userRawData
        }))

        let payload = {
            nextAction: 'none',
            message: 'welcome back'
        }

        // Notify sso complete 
        if (sessionCode) {
            const ssoData = await Promise.resolve(this.generateSsoPayload ? this.generateSsoPayload({ kycProfile, kycRecord, kycToken, payload }) : {})
            const res = await this.blockPassProvider.notifyLoginComplete(kycToken, sessionCode, ssoData);
            this._activityLog("[BlockPass] login success", res)
        }

        return {
            ...payload
        }
    }

    /**
     * Register fow. Recieved user sign-up infomation and create KycProcess.
     * Basically this flow processing same as loginFlow. The main diffrence is without sessionCode input
     * @param {string} code: 
     */
    async registerFlow({code}) {
        if (code == null)
            throw new Error('Missing code or sessionCode');

        const kycToken = await this.blockPassProvider.doHandShake(code);
        if (kycToken == null)
            throw new Error('Handshake failed');

        this._activityLog("[BlockPass]", kycToken);


        const kycProfile = await this.blockPassProvider.doMatchingData(kycToken);
        if (kycProfile == null)
            throw new Error('Sync info failed');

        this._activityLog("[BlockPass]", kycProfile);

        let kycRecord = await Promise.resolve(this.findKycById(kycProfile.id));
        let isNewUser = kycRecord == null;
        if (isNewUser)
            kycRecord = await Promise.resolve(this.createKyc({ kycProfile }))

        let payload = {}
        if (isNewUser) {
            payload.nextAction = 'upload';
            payload.requiredFields = this.requiredFields;
            payload.optionalFields = this.optionalFields;
        }
        else {
            payload.message = 'welcome back';
            payload.nextAction = 'none';
        }


        if (kycRecord && this.needRecheckExitingKyc) {
            payload = await Promise.resolve(this.needRecheckExitingKyc({ kycProfile, kycRecord, kycToken, payload }))
        }

        return {
            accessToken: this.blockPassProvider.encodeDataIntoToken({
                kycId: kycProfile.id,
                kycToken
            }),
            ...payload
        }
    }

    /**
     * Sign Certificate and send to blockpass
     * @param {*} param0 
     */
    async signCertificate({profileId, kycRecord, serviceInfo, claim}) {
        const res = await this.blockPassProvider.notifyCertificate(profileId, {
            kycRecord,
            serviceInfo,
            claim
        })
        return res
    }

    /**
     * Reject Certificate 
     * @param {string} profileId
     * @param {string} message: Reasone reject(this message will be sent to client)
     */
    async rejectCertificate(profileId, message) {
        const res = await this.blockPassProvider.notifyNeedMoreInfo(profileId, message)
        return res;
    }

    /**
     * Query Merkle proof of path for given slugList
     * @param {kycToken} kycToken 
     * @param {[string]} slugList 
     */
    async queryProofOfPath(kycToken, slugList) {
        const res = await this.blockPassProvider.queryProofOfPath(kycToken, slugList)

        this._activityLog("[BlockPass] QueryProofPath", slugList, "->", res);
        return res;
    }

    
    _activityLog(...args) {
        console.log('\x1b[32m%s\x1b[0m', '[info]', ...arguments)
    }

    merkleProofCheckSingle(rootHash, rawData, proofList) {
        return merkleTreeHelper.validateField(rootHash, rawData, proofList)
    }
    
    
}

module.exports = ServerSdk;

/**
 * Query Kyc record by Id
 * @callback findKycByIdCallback
 * @async
 * @param {string} kycId
 * @returns {Promise<KycRecord>} Kyc Record
 */

/**
 * KYC create handler. Create new KycRecord
 * @callback createKycCallback
 * @async
 * @param {kycProfile} kycProfile 
 * @returns {Promise<KycRecord>} Kyc Record
 */

/**
 * KYC Update handler. Update KycRecord
* @callback updateKycCallback
* @async
* @param {kycRecord} kycRecord
* @param {kycProfile} kycProfile
* @param {kycToken} kycToken
* @param {Object} userRawData
* @returns {Promise<KycRecord>} Kyc Record
*/

/**
 * Check need to update new info for exiting Kyc record
 * @callback needRecheckExitingKycCallback
 * @async
 * @param {kycRecord} kycRecord
 * @param {kycProfile} kycProfile
 * @param {Object} payload
 * @returns {Promise<Object>} Payload return to client
 */


/**
 * KYC Profile Object
 * @typedef {Object} kycProfile
 * @property {string} id: Udid of kycProfile (assigned by blockpass)
 * @property {string} smartContractId: SmartContract user ID ( using to validate rootHash via Sc)
 * @property {string} rootHash: Currently Root Hash 
 * @property {string('syncing'|'complete')} isSynching: Smartcontract syncing status
 */

/**
 * @typedef {Object} kycToken
 * @property {string} access_token: AccessToken string
 * @property {Number} expires_in: Expired time in seconds
 * @property {string} refresh_token: Refresh token
 */
