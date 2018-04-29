const merkle = require('merkle');
const crypto = require('crypto');

function _hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Validate fields base onf proof of path
 * @constructor
 * @param {String} rootHash - Root hash
 * @param {String | Buffer} fieldRawData - Raw data of field
 * @param {Object} proofPath - Proof Path
 */
module.exports.validateField = function (rootHash, fieldRawData, proofPath) {
    const rawHash = _hash(fieldRawData)
    const beginHash = _hash(rawHash + rawHash)

    let root = proofPath.reduce((acc, item, index) => {
        if (acc == item.left) {
            return _hash(acc + item.right)
        } else if (acc == item.right) {
            return _hash(item.left + acc)
        }

        return `wrong at ${index}`
    }, beginHash)

    return root === rootHash
}