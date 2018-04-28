const merkle = require('merkle');
const crypto = require('crypto');

function _hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}


/**
 * Build BlockPass Merkle Tree base on list of identities
 * @constructor
 * @param {Array(Buffer | String)} identities - Sorted identities list. Dummy value for empty fields ('' or Buffer([0]))
 */
module.exports.bpTreeHash = function (identities) {
    // identities has it-self base on raw value. Prevent publish raw info for proof process
    const leaves = identities
        .map(val => _hash(val))
        .reduce((acc, val) => acc.concat(_hash(val + val)), [])
    const tree = merkle('sha256', false).sync(leaves);
    return tree
}

/**
 * Get Proof Path for given field
 * @constructor
 * @param {Array(Buffer | String)} tree - BlockPass Merkle Tree instance
 * @param {number} fieldIndex - raw data of field
 */
module.exports.bpGetProofPath = function (tree, fieldIndex) {
    if (!tree) throw new Error('missing paramaters')

    const res = tree.getProofPath(fieldIndex)
    return res;
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