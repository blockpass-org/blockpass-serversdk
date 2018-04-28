const request = require('superagent');
const jwt = require('jsonwebtoken');
const api = require('./config').api;

let _baseUrl;
let _clientId;
let _secretId;

function init(options = {}) {
    _baseUrl = options.baseUrl
    _clientId = options.clientId
    _secretId = options.secretId
}

//params: 
//  code {string}: authCode
//return 
// @bpToken: 
// {
//     access_token: 'ya29.{....long content....}',
//     token_type: 'Bearer',
//     expires_in: 3600,
//     refresh_token: '1/Ry68f95c1f0936ea9444a12a1e4975407b92'
// }
async function doHandShake(code, session_code) {
    try {

        const handShakeResponse = await request
            .post(_baseUrl + api.HAND_SHAKE_PATH)
            .send({
                client_id: _clientId,
                client_secret: _secretId,
                code: code,
                grant_type: "authoriaztioncode",
                session_code
            })

        if (handShakeResponse.status != 200) {
            console.log("[BlockPass] Handshake Error", handShakeResponse.text)
            return null;
        }

        return handShakeResponse.body;

    } catch (error) {
        console.error('Handshake failed: ', error)
        return null;
    }
}

// @userProfile:
// {
//     id: '...',
//     smartContractId,
//     rootHash,
//     isSynching,
//     smartContractAddress:,
//     network:
// }
async function doMatchingData(handShakeToken) {
    try {
        const userProfileResponse = await request
            .post(_baseUrl + api.MATCHING_INFO_PATH)
            .set({
                Authorization: handShakeToken.access_token
            })
            .send();

        // Todo: Activity log. Should be wrong secret ID 
        if (userProfileResponse.status != 200) {
            console.log("[BlockPass] UserProfile Response Error", userProfileResponse.text)
            return null;
        }

        return userProfileResponse.body;

    } catch (error) {
        console.log('Query Profile failed: ', error)
        return null;
    }
}

async function notifyCertificate(bpId, cert) {
    console.log('Send cert to bpServer')
}

async function notifyNeedMoreInfo(bpId, message) {
    console.log('Send query more info to bpServer')
}

async function notifyLoginComplete(bpToken, sessionData, extraData) {
    console.log('Send notify login to bpServer', { sessionData, extraData })
    const ssoCompleteResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
            Authorization: bpToken.access_token
        })
        .send({
            result: 'success',
            custom_data: JSON.stringify({
                sessionData,
                extraData
            })
        })

    if (ssoCompleteResponse.status != 200) {
        console.log("[BlockPass] SSoComplete Error", ssoCompleteResponse.text)
        return null;
    }

    return ssoCompleteResponse.body;
}

async function notifyLoginFailed(bpToken, error) {
    console.log('Send notify login failed to bpServer', { error })
    const ssoFailedResponse = await request
        .post(_baseUrl + api.SSO_COMPETE_PATH)
        .set({
            Authorization: bpToken.access_token
        })
        .send({
            result: 'failed',
            custom_data: JSON.stringify({
                error
            })
        })

    if (ssoFailedResponse.status != 200) {
        console.log("[BlockPass] SSoComplete Error", ssoFailedResponse.text)
        return null;
    }

    return ssoFailedResponse.body;
}

// Reset access token if it expired
async function _checkAndRefreshAccessToken(bpToken) {
    const now = new Date();
    if (bpToken.expires_in > now)
        return bpToken

    const { access_token, refresh_token } = bpToken;
    const refreshTokenResponse = await request
        .post(_baseUrl + api.REFRESH_TOKEN_PATH)
        .send({
            stoc: access_token,
            stoc_refresh: refresh_token,
            client_secret: _secretId
        })

    if (refreshTokenResponse.status != 200) {
        console.log("[BlockPass] Refreshkyc Error", refreshTokenResponse.text)
        return null;
    }

    return refreshTokenResponse.body

}
// queryProofOfPath for fields
// Response:
// {
//     "status": "success",
//         "proofList": {
//         "phone": [
//             {
//                 "parent": "...",
//                 "left": "...",
//                 "right": "..."
//             }
//         ]
//     }
// }
async function queryProofOfPath(bpToken, slug_list) {
    // check refresh bpToken
    bpToken = await _checkAndRefreshAccessToken(bpToken)

    try {
        const ssoQueryPathResponse = await request
            .post(_baseUrl + api.GET_PROOF_OF_PATH)
            .set({
                Authorization: bpToken.access_token
            })
            .send({
                slug_list
            })

        if (ssoQueryPathResponse.status != 200) {
            console.log("[BlockPass] queryProofOfPath Error", ssoQueryPathResponse.text)
            return null;
        }

        return {
            proofOfPath: ssoQueryPathResponse.body,
            bpToken
        };
    } catch (error) {
        console.log(error)
    }
}

function encodeDataIntoToken(payload) {
    return jwt.sign(payload, _secretId)
}

function decodeDataFromToken(accessToken) {
    try {
        return jwt.verify(accessToken, _secretId);
    } catch (error) {
        return null;
    }

}


//----------------------------------------------------------------//
//  exports
//----------------------------------------------------------------//

module.exports.init = init;
module.exports.doHandShake = doHandShake;
module.exports.doMatchingData = doMatchingData;
module.exports.encodeDataIntoToken = encodeDataIntoToken;
module.exports.decodeDataFromToken = decodeDataFromToken;
module.exports.notifyCertificate = notifyCertificate;
module.exports.notifyNeedMoreInfo = notifyNeedMoreInfo;

module.exports.notifyLoginComplete = notifyLoginComplete;
module.exports.notifyLoginFailed = notifyLoginFailed;
module.exports.queryProofOfPath = queryProofOfPath;