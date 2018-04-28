const api = {
    HAND_SHAKE_PATH: '/api/v0.3/oauth2/token/',
    MATCHING_INFO_PATH: '/api/v0.3/oauth2/profile',
    REFRESH_TOKEN_PATH: '/api/v0.3/service/renewStoc',
    SSO_COMPETE_PATH: '/api/v0.3/service/complete/',
    GET_PROOF_OF_PATH: '/api/v0.3/service/getProof',
}
module.exports.api = api;

module.exports.baseUrl = function() {
    return process.env.BLOCKPASS_BASE_URL
}