/*!
 * random.js - pseudorandom byte generation for bcoin.
 * Copyright (c) 2016, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 *
 * Parts of this software are based on brorand:
 * https://github.com/indutny/brorand
 * Copyright (c) 2014, Fedor Indutny (MIT License).
 */

/* jshint worker: true */

var randomBytes, crypto, global;

try {
  crypto = require('crypto');
} catch (e) {
  ;
}

if (crypto) {
  randomBytes = function randomBytes(n) {
    return crypto.randomBytes(n);
  };
} else {
  if (typeof window !== 'undefined')
    global = window;
  else if (typeof self !== 'undefined')
    global = self;

  if (!global)
    throw new Error('Unknown global.');

  crypto = global.crypto || global.msCrypto;

  if (crypto && crypto.getRandomValues) {
    randomBytes = function randomBytes(n) {
      var data = new Uint8Array(n);
      crypto.getRandomValues(data);
      return new Buffer(data.buffer);
    };
  } else {
    // Out of luck here. Use bad randomness for now.
    // Possibly fall back to randy in the future:
    // https://github.com/deestan/randy
    randomBytes = function randomBytes(n) {
      var data = new Buffer(n);
      var i;

      for (i = 0; i < data.length; i++)
        data[i] = Math.floor(Math.random() * 256);

      return data;
    };
  }
}

function randomInt() {
  return randomBytes(4).readUInt32LE(0, true);
}

function randomRange(min, max) {
  var num = randomInt();
  return Math.floor((num / 0x100000000) * (max - min) + min);
}

/*
 * Expose
 */

exports = randomBytes;
exports.randomBytes = randomBytes;
exports.randomInt = randomInt;
exports.randomRange = randomRange;

module.exports = randomBytes;
