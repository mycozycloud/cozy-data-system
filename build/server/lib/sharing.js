// Generated by CoffeeScript 1.10.0
var User, addProtocol, async, changes, checkDomain, db, getDomain, handleNotifyResponse, log, onChange, replications, replicator, request, user;

db = require('../helpers/db_connect_helper').db_connect();

replicator = require('../helpers/db_connect_helper').db_replicator_connect();

async = require('async');

request = require('request-json');

log = require('printit')({
  prefix: 'sharing'
});

User = require('./user');

user = new User();

replications = {};

addProtocol = function(url) {
  if ((url != null ? url.indexOf("://") : void 0) === -1) {
    url = "https://" + url;
  }
  return url;
};

onChange = function(change) {
  var cb;
  if (replications[change.id] != null) {
    cb = replications[change.id];
    delete replications[change.id];
    return replicator.get(change.id, function(err, doc) {
      if (err != null) {
        return cb(err);
      } else if (doc._replication_state === "error") {
        err = "Replication failed";
        return cb(err);
      } else {
        return cb(null, change.id);
      }
    });
  }
};

getDomain = function(callback) {
  return db.view('cozyinstance/all', function(err, instance) {
    var domain, ref;
    if (err != null) {
      return callback(err);
    }
    if ((instance != null ? (ref = instance[0]) != null ? ref.value.domain : void 0 : void 0) != null) {
      domain = instance[0].value.domain;
      if (!(domain.indexOf('http') > -1)) {
        domain = "https://" + domain + "/";
      }
      return callback(null, domain);
    } else {
      return callback(null);
    }
  });
};

checkDomain = function(url, callback) {
  if (url == null) {
    return getDomain(function(err, domain) {
      if ((err != null) || (domain == null)) {
        return callback(new Error('No instance domain set'));
      } else {
        return callback(err, domain);
      }
    });
  } else {
    return callback(null, url);
  }
};

handleNotifyResponse = function(err, result, body, callback) {
  if (err != null) {
    return callback(err);
  } else if ((result != null ? result.statusCode : void 0) == null) {
    err = new Error("Bad request");
    err.status = 400;
    return callback(err);
  } else if ((body != null ? body.error : void 0) != null) {
    err = new Error(body.error);
    err.status = result.statusCode;
    return callback(err);
  } else if ((result != null ? result.statusCode : void 0) !== 200) {
    err = new Error("The request has failed");
    err.status = result.statusCode;
    return callback(err);
  } else {
    return callback();
  }
};

module.exports.notifyRecipient = function(url, path, params, callback) {
  return checkDomain(params.sharerUrl, function(err, domain) {
    if (err != null) {
      return err;
    }
    params.sharerUrl = domain;
    return user.getUser(function(err, userInfos) {
      var remote;
      if (err != null) {
        return err;
      }
      params.sharerName = userInfos.public_name;
      if ((params.sharerName == null) || (params.sharerName === '')) {
        params.sharerName = params.sharerUrl.replace("https://", "");
      }
      url = addProtocol(url);
      remote = request.createClient(url);
      return remote.post(path, params, function(err, result, body) {
        return handleNotifyResponse(err, result, body, callback);
      });
    });
  });
};

module.exports.notifySharer = function(url, path, params, callback) {
  return checkDomain(params.recipientUrl, function(err, domain) {
    var remote;
    if (err != null) {
      return err;
    }
    params.recipientUrl = domain;
    remote = request.createClient(url);
    return remote.post(path, params, function(err, result, body) {
      return handleNotifyResponse(err, result, body, callback);
    });
  });
};

module.exports.sendRevocation = function(url, path, params, callback) {
  var remote;
  url = addProtocol(url);
  remote = request.createClient(url);
  return remote.del(path, params, function(err, result, body) {
    return handleNotifyResponse(err, result, body, callback);
  });
};

module.exports.replicateDocs = function(params, callback) {
  var auth, couch, couchAuth, couchCred, err, replication, source, url;
  if (!((params.target != null) && (params.docIDs != null) && (params.id != null))) {
    err = new Error('Parameters missing');
    err.status = 400;
    return callback(err);
  } else {
    auth = params.id + ":" + params.target.token;
    url = addProtocol(params.target.recipientUrl);
    url = url.replace("://", "://" + auth + "@");
    if (url.charAt(url.length - 1) === '/') {
      url = url.substring(0, url.length - 1);
    }
    couchCred = db.connection;
    couch = [couchCred.host, couchCred.port];
    if (couchCred.auth != null) {
      couchAuth = couchCred.auth.username + ":" + couchCred.auth.password;
      source = "http://" + couchAuth + "@" + couch[0] + ":" + couch[1] + "/cozy";
    } else {
      source = "http://" + couch[0] + ":" + couch[1] + "/cozy";
    }
    replication = {
      source: source,
      target: url + "/services/sharing/replication/",
      continuous: params.continuous || false,
      doc_ids: params.docIDs
    };
    if (replication.continuous) {
      return replicator.save(replication, function(err, body) {
        if (err != null) {
          return callback(err);
        } else if (!body.ok) {
          err = "Replication failed";
          return callback(err);
        } else {
          return replications[body.id] = callback;
        }
      });
    } else {
      return db.replicate(replication.target, replication, function(err, body) {
        if (err != null) {
          return callback(err);
        } else if (!body.ok) {
          err = "Replication failed";
          return callback(err);
        } else {
          return callback(null);
        }
      });
    }
  }
};

module.exports.cancelReplication = function(replicationID, callback) {
  var err;
  if (replicationID == null) {
    err = new Error('Parameters missing');
    err.status = 400;
    return callback(err);
  } else {
    return replicator.remove(replicationID, function(err) {
      return callback(err);
    });
  }
};

changes = replicator.changes({
  since: 'now'
});

changes.on('change', onChange);

changes.on('error', function(err) {
  return log.error("Replicator feed error : " + err.stack);
});
