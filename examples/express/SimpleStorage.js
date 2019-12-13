const fs = require('fs')
const path = require('path')
const saveDbPath = path.join(__dirname, 'db.json')
if (!fs.existsSync(saveDbPath)) fs.writeFileSync(saveDbPath, '{}')

class KYCModel {
  constructor (props) {
    this._id = Date.now()
    Object.keys(props).forEach((key) => {
      this[key] = props[key]
    })
  }

  async save () {
    const itm = await KYCModel.findById(this._id)
    if (!itm) KYCModel.DB.push(this)

    fs.writeFileSync(saveDbPath, JSON.stringify(KYCModel.DB))
    return this
  }

  static async findOne (query) {
    const { blockPassID } = query
    return KYCModel.DB.find((val) => val.blockPassID === blockPassID)
  }

  static async findById (id) {
    return KYCModel.DB.find((val) => val._id === id)
  }
}

KYCModel.DB = JSON.parse(fs.readFileSync(saveDbPath).toString())

class FileStorage {
  static async writeFile ({ fileName, mimetype, fileBuffer }) {
    const _id = Date.now()
    FileStorage.Mem[_id] = { fileName, mimetype, fileBuffer }
    return {
      _id: _id
    }
  }
}

FileStorage.Mem = {}

module.exports.FileStorage = FileStorage
module.exports.KYCModel = KYCModel
