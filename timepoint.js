var mongoose = require('mongoose'),
  mongoose_auth = require('mongoose-auth'),
  Schema = mongoose.Schema;

var TimePointSchema = new Schema({
  ll: { type: [Number], index: '2d' },
  start: Number,
  end: Number
});

var TimePoint = mongoose.model('TimePoint', TimePointSchema);

exports.TimePoint = TimePoint;