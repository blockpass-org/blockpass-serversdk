const api = {
  CERTIFICATE_SCHEMA: '/api/schema/',

  HAND_SHAKE_PATH: '/api/3rdService/token/generate',
  MATCHING_INFO_PATH: '/api/3rdService/user',
  REFRESH_TOKEN_PATH: '/api/3rdService/token/renew',
  SSO_COMPETE_PATH: '/api/3rdService/register/complete',
  GET_PROOF_OF_PATH: '/api/3rdService/user/identityProof',
  CERTIFICATE_ACCEPT_PATH: '/api/3rdService/certificate/issue',
  NOTIFICATION_PATH: '/api/3rdService/feedBack',
  DEACTIVE_USER_PATH: '/api/3rdService/user/deactivate',

  PUBKEY_PATH: '/api/v0.3/service/pubKeyHash/',
  META_DATA_PATH: '/api/3rdService/service/detail/'
}
module.exports.api = api
module.exports.SDKAuthCode =
  'wY4GMh2s6HfsszxMYgpvH2Jk4cNszHPxtywEkN96AMNFeJbUp3Hn7pZUNbuGguDK'
