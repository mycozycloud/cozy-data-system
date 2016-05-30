// Generated by CoffeeScript 1.10.0
var _, checkDocType, checkDocTypeSync, checkSharingRule, checkSharingRuleSync, feed, fs, hasEmptyField;

fs = require('fs');

feed = require('../lib/feed');

checkDocType = require('../lib/token').checkDocType;

checkDocTypeSync = require('../lib/token').checkDocTypeSync;

checkSharingRule = require('../lib/token').checkSharingRule;

checkSharingRuleSync = require('../lib/token').checkSharingRuleSync;

_ = require('lodash');

module.exports.deleteFiles = function(files) {
  var file, key, results;
  if ((files != null) && Object.keys(files).length > 0) {
    results = [];
    for (key in files) {
      file = files[key];
      results.push(fs.unlinkSync(file.path));
    }
    return results;
  }
};

hasEmptyField = module.exports.hasEmptyField = function(obj, keys) {
  var i, key, value;
  i = 0;
  while ((key = keys[i]) != null) {
    value = obj[key];
    if (!((value != null) && ((!_.isEmpty(value)) || (_.isBoolean(value)) || (_.isNumber(value))))) {
      return true;
    }
    i++;
  }
  return false;
};

module.exports.hasIncorrectStructure = function(set, keys) {
  var i, obj;
  i = 0;
  while ((obj = set[i]) != null) {
    if (hasEmptyField(obj, keys)) {
      return true;
    }
    i++;
  }
  return false;
};

module.exports.checkPermissions = function(req, permission, next) {
  var authHeader;
  authHeader = req.header('authorization') || req.query.authorization;
  return checkDocType(authHeader, permission, function(err, appName, isAuthorized) {
    if (!appName) {
      err = new Error("Application is not authenticated");
      err.status = 401;
      return next(err);
    } else if (!isAuthorized) {
      err = new Error("Application is not authorized");
      err.status = 403;
      return next(err);
    } else {
      feed.publish('usage.application', appName);
      req.appName = appName;
      return next();
    }
  });
};

module.exports.checkReplicationPermissions = function(req, permission, next) {
  var auth;
  auth = req.header('authorization');
  return checkDocType(auth, permission != null ? permission.docType : void 0, function(err, login, isAuthorized) {
    if (!login) {
      return checkSharingRule(auth, permission, function(err, sharing, isAuthorized) {
        if (!sharing) {
          err = new Error("Requester is not authenticated");
          err.status = 401;
          return next(err);
        } else if (!isAuthorized) {
          err = new Error(sharing + " is not authorized");
          err.status = 403;
          return next(err);
        } else {
          feed.publish('usage.sharing', sharing);
          req.sharing = sharing;
          return next();
        }
      });
    } else if (!isAuthorized) {
      err = new Error("Device " + login + " is not authorized");
      err.status = 403;
      return next(err);
    } else {
      feed.publish('usage.application', login);
      req.appName = login;
      return next();
    }
  });
};

module.exports.checkReplicationPermissionsSync = function(req, permission) {
  var auth, err, isAuthorized, login, ref, ref1, sharing;
  auth = req.header('authorization');
  ref = checkDocTypeSync(auth, permission != null ? permission.docType : void 0), err = ref[0], login = ref[1], isAuthorized = ref[2];
  if (!login) {
    ref1 = checkSharingRuleSync(auth, permission), err = ref1[0], sharing = ref1[1], isAuthorized = ref1[2];
    if (!sharing) {
      err = new Error("Requester is not authenticated");
      err.status = 401;
      return err;
    } else if (!isAuthorized) {
      err = new Error(sharing + " is not authorized");
      err.status = 403;
      return err;
    } else {
      feed.publish('usage.sharing', sharing);
      req.sharing = sharing;
    }
  } else if (!isAuthorized) {
    err = new Error("Device " + login + " is not authorized");
    err.status = 403;
    return err;
  } else {
    feed.publish('usage.application', login);
    req.appName = login;
  }
};
