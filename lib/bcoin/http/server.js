/**
 * server.js - http server for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * https://github.com/indutny/bcoin
 */

var EventEmitter = require('events').EventEmitter;
var bcoin = require('../../bcoin');
var HTTPServer = require('./http');
var utils = require('../utils');
var assert = utils.assert;

/**
 * NodeServer
 */

function NodeServer(node, options) {
  if (!options)
    options = {};

  this.options = options;
  this.node = node;
  this.walletdb = node.walletdb;
  this.pool = node.pool;
  this.loaded = false;

  this.server = new HTTPServer(options);
  this.io = null;

  this._init();
}

utils.inherits(NodeServer, EventEmitter);

NodeServer.prototype._init = function _init() {
  var self = this;

  this.use(function(req, res, next, send) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE');

    if (req.method === 'OPTIONS')
      return send(200);

    next();
  });

  this.use(function(req, res, next, send) {
    var params = utils.merge({}, req.query, req.body, req.params);
    var options = {};

    if (params.id) {
      assert(params.id !== '!all');
      options.id = params.id;
    }

    if (params.hash) {
      if (utils.isInt(params.hash))
        options.height = params.hash >>> 0;
      else
        options.hash = utils.revHex(params.hash);
    }

    if (params.index != null)
      options.index = params.index >>> 0;

    if (params.height != null)
      options.height = params.height >>> 0;

    if (params.start != null)
      options.start = params.start >>> 0;

    if (params.end != null)
      options.end = params.end >>> 0;

    if (params.limit != null)
      options.limit = params.limit >>> 0;

    if (params.changeDepth)
      options.changeDepth = params.changeDepth >>> 0;

    if (params.receiveDepth)
      options.receiveDepth = params.receiveDepth >>> 0;

    if (params.address)
      params.addresses = params.address;

    if (params.addresses) {
      if (typeof params.addresses === 'string')
        options.addresses = params.addresses.split(',');
      else
        options.addresses = params.addresses;
    }

    if (params.tx) {
      try {
        options.tx = bcoin.tx.fromRaw(params.tx, 'hex');
      } catch (e) {
        return next(e);
      }
    }

    if (params.bin)
      options.bin = true;

    req.options = options;

    next();
  });

  this.get('/', function(req, res, next, send) {
    send(200, {
      version: require('../../../package.json').version,
      network: self.node.network.type
    });
  });

  // UTXO by address
  this.get('/coin/address/:address', function(req, res, next, send) {
    self.node.getCoinByAddress(req.options.addresses, function(err, coins) {
      if (err)
        return next(err);

      if (!coins.length)
        return send(404);

      send(200, coins.map(function(coin) { return coin.toJSON(); }));
    });
  });

  // UTXO by id
  this.get('/coin/:hash/:index', function(req, res, next, send) {
    self.node.getCoin(req.options.hash, req.options.index, function(err, coin) {
      if (err)
        return next(err);

      if (!coin)
        return send(404);

      send(200, coin.toJSON());
    });
  });

  // Bulk read UTXOs
  this.post('/coin/address', function(req, res, next, send) {
    self.node.getCoinByAddress(req.body.addresses, function(err, coins) {
      if (err)
        return next(err);

      if (!coins.length)
        return send(404);

      send(200, coins.map(function(coin) { return coin.toJSON(); }));
    });
  });

  // TX by hash
  this.get('/tx/:hash', function(req, res, next, send) {
    self.node.getTX(req.options.hash, function(err, tx) {
      if (err)
        return next(err);

      if (!tx)
        return send(404);

      send(200, tx.toJSON());
    });
  });

  // TX by address
  this.get('/tx/address/:address', function(req, res, next, send) {
    self.node.getTXByAddress(req.options.addresses, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Bulk read TXs
  this.post('/tx/address', function(req, res, next, send) {
    self.node.getTXByAddress(req.body.addresses, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Block by hash/height
  this.get('/block/:hash', function(req, res, next, send) {
    var hash = req.options.hash || req.options.height;
    self.node.getFullBlock(hash, function(err, block) {
      if (err)
        return next(err);

      if (!block)
        return send(404);

      send(200, block.toJSON());
    });
  });

  // Get wallet
  this.get('/wallet/:id', function(req, res, next, send) {
    self.walletdb.getJSON(req.options.id, function(err, json) {
      if (err)
        return next(err);

      if (!json)
        return send(404);

      send(200, json);
    });
  });

  // Create/get wallet
  this.post('/wallet/:id', function(req, res, next, send) {
    self.walletdb.create(req.options, function(err, wallet) {
      var json;

      if (err)
        return next(err);

      if (!wallet)
        return send(404);

      json = wallet.toJSON();
      wallet.destroy();

      send(200, json);
    });
  });

  // Update wallet / sync address depth
  this.put('/wallet/:id', function(req, res, next, send) {
    var id = req.options.id;
    var receive = req.options.receiveDepth;
    var change = req.options.changeDepth;

    self.walletdb.setDepth(id, receive, change, function(err) {
      if (err)
        return next(err);

      send(200, { success: true });
    });
  });

  // Wallet Balance
  this.get('/wallet/:id/balance', function(req, res, next, send) {
    self.walletdb.getBalance(req.options.id, function(err, balance) {
      if (err)
        return next(err);

      if (!balance)
        return send(404);

      send(200, { balance: utils.btc(balance) });
    });
  });

  // Wallet UTXOs
  this.get('/wallet/:id/coin', function(req, res, next, send) {
    self.walletdb.getCoins(req.options.id, function(err, coins) {
      if (err)
        return next(err);

      if (!coins.length)
        return send(404);

      send(200, coins.map(function(coin) { return coin.toJSON(); }));
    });
  });

  // Wallet TX
  this.get('/wallet/:id/coin/:hash/:index', function(req, res, next, send) {
    self.walletdb.getCoin(req.options.hash, req.options.index, function(err, coin) {
      if (err)
        return next(err);

      if (!coin)
        return send(404);

      send(200, coin.toJSON());
    });
  });

  // Wallet TXs
  this.get('/wallet/:id/tx/all', function(req, res, next, send) {
    self.walletdb.getAll(req.options.id, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Wallet Pending TXs
  this.get('/wallet/:id/tx/pending', function(req, res, next, send) {
    self.walletdb.getPending(req.options.id, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Wallet TXs within time range
  this.get('/wallet/:id/tx/range', function(req, res, next, send) {
    self.walletdb.getRange(req.options.id, req.options, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Wallet TXs within time range
  this.get('/wallet/:id/tx/last', function(req, res, next, send) {
    self.walletdb.getRange(req.options.id, req.options.limit, function(err, txs) {
      if (err)
        return next(err);

      if (!txs.length)
        return send(404);

      send(200, txs.map(function(tx) { return tx.toJSON(); }));
    });
  });

  // Wallet TX
  this.get('/wallet/:id/tx/:hash', function(req, res, next, send) {
    self.walletdb.getTX(req.options.hash, function(err, tx) {
      if (err)
        return next(err);

      if (!tx)
        return send(404);

      send(200, tx.toJSON());
    });
  });

  // Broadcast TX
  this.post('/broadcast', function(req, res, next, send) {
    var tx = req.options.tx;
    self.pool.broadcast(tx);
    send(200, { success: true });
  });

  this.server.on('error', function(err) {
    self.emit('error', err);
  });

  this._initIO();

  if (this.options.port != null)
    this.listen(this.options.port, this.options.host);
};

NodeServer.prototype.open = function open(callback) {
  if (this.loaded)
    return utils.nextTick(callback);

  this.once('open', callback);
};

NodeServer.prototype._initIO = function _initIO() {
  var self = this;

  if (!this.server.io)
    return;

  this.server.on('websocket', function(socket) {
    socket.on('error', function(err) {
      self.emit('error', err);
    });
    self.emit('websocket', socket);
  });

  this.walletdb.on('tx', function(tx, map) {
    tx = tx.toJSON();
    map.all.forEach(function(id) {
      self.server.io.to(id).emit('tx', tx);
    });
    self.server.io.to('!all').emit('tx', tx, map);
  });

  this.walletdb.on('confirmed', function(tx, map) {
    tx = tx.toJSON();
    map.all.forEach(function(id) {
      self.server.io.to(id).emit('confirmed', tx);
    });
    self.server.io.to('!all').emit('confirmed', tx, map);
  });

  this.walletdb.on('updated', function(tx, map) {
    tx = tx.toJSON();
    map.all.forEach(function(id) {
      self.server.io.to(id).emit('updated', tx);
    });
    self.server.io.to('!all').emit('updated', tx, map);
  });

  this.walletdb.on('balance', function(balance, id) {
    balance = utils.btc(balance);
    self.server.io.to(id).emit('balance', balance);
    self.server.io.to('!all').emit('balance', balance, id);
  });

  this.walletdb.on('balances', function(balances) {
    Object.keys(balances).forEach(function(id) {
      balances[id] = utils.btc(balances[id]);
    });
    self.server.io.to('!all').emit('balances', balances);
  });
};

NodeServer.prototype.use = function use(path, callback) {
  return this.server.use(path, callback);
};

NodeServer.prototype.get = function get(path, callback) {
  return this.server.get(path, callback);
};

NodeServer.prototype.post = function post(path, callback) {
  return this.server.post(path, callback);
};

NodeServer.prototype.put = function put(path, callback) {
  return this.server.put(path, callback);
};

NodeServer.prototype.del = function del(path, callback) {
  return this.server.del(path, callback);
};

NodeServer.prototype.listen = function listen(port, host, callback) {
  var self = this;
  return this.server.listen(port, host, function(err) {
    if (err) {
      if (callback)
        return callback(err);
      return self.emit('error', err);
    }

    self.loaded = true;
    self.emit('open');

    if (callback)
      callback();
  });
};

/**
 * Expose
 */

module.exports = NodeServer;