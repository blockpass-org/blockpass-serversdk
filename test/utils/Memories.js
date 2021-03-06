const DB = require('./_mockData').KYCModel

class KYCModel {
  constructor (props) {
    this._id = Date.now()
    Object.keys(props).forEach(key => {
      this[key] = props[key]
    })
  }

  async save () {
    const itm = await KYCModel.findById(this._id)
    if (!itm) KYCModel.DB.push(this)
    return this
  }

  static async findOne (query) {
    const { blockPassID } = query
    return KYCModel.DB.find(val => val.blockPassID === blockPassID)
  }

  static async findById (id) {
    return KYCModel.DB.find(val => val._id === id)
  }

  static reset () {
    KYCModel.DB = DB.map(itm => new KYCModel(itm))
  }
}

class FileStorage {
  static Mem = {}

  static async writeFile ({ fileName, mimetype, fileBuffer }) {
    const _id = Date.now()
    FileStorage.Mem[_id] = { fileName, mimetype, fileBuffer }
    return {
      _id: _id
    }
  }
}

module.exports.FileStorage = FileStorage
module.exports.KYCModel = KYCModel
