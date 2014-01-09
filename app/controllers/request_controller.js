// Generated by CoffeeScript 1.6.3
var async, checkDocType, db, encryption, request;

load('application');

async = require("async");

db = require('./helpers/db_connect_helper').db_connect();

checkDocType = require('./lib/token').checkDocType;

request = require('./lib/request');

encryption = require('./lib/encryption');

before('permissions', function() {
  var auth,
    _this = this;
  auth = req.header('authorization');
  return checkDocType(auth, params.type, function(err, appName, isAuthorized) {
    if (!appName) {
      err = new Error("Application is not authenticated");
      return send({
        error: err
      }, 401);
    } else if (!isAuthorized) {
      err = new Error("Application is not authorized");
      return send({
        error: err
      }, 403);
    } else {
      _this.appName = appName;
      compound.app.feed.publish('usage.application', appName);
      return next();
    }
  });
}, {
  except: ['doctypes']
});

before('lock request', function() {
  var _this = this;
  this.lock = "" + params.type;
  return compound.app.locker.runIfUnlock(this.lock, function() {
    compound.app.locker.addLock(_this.lock);
    return next();
  });
}, {
  only: ['definition', 'remove']
});

after('unlock request', function() {
  return compound.app.locker.removeLock(this.lock);
}, {
  only: ['definition', 'remove']
});

action('doctypes', function() {
  var out, query;
  query = {
    group: true
  };
  out = [];
  return db.view("doctypes/all", query, function(err, res) {
    if (err) {
      return send(500, {
        err: JSON.stringify(err)
      });
    } else {
      res.forEach(function(key, row, id) {
        return out.push(key);
      });
      return send(200, out);
    }
  });
});

action('results', function() {
  var _this = this;
  return request.get(this.appName, params, function(path) {
    return db.view(("" + params.type + "/") + path, body, function(err, res) {
      if (err) {
        if (err.error === "not_found") {
          return send({
            error: "not found"
          }, 404);
        } else {
          console.log("[Results] err: " + JSON.stringify(err));
          return send({
            error: err.message
          }, 500);
        }
      } else {
        res.forEach(function(value) {
          delete value._rev;
          if ((value.password != null) && !((value.docType != null) && (value.docType.toLowerCase() === "application" || value.docType.toLowerCase() === "user"))) {
            return encryption.decrypt(value.password, function(err, password) {
              if (err == null) {
                return value.password = password;
              }
            });
          }
        });
        return send(res);
      }
    });
  });
});

action('removeResults', function() {
  var delFunc, removeAllDocs, removeFunc,
    _this = this;
  removeFunc = function(res, callback) {
    return db.remove(res.value._id, res.value._rev, callback);
  };
  removeAllDocs = function(res) {
    return async.forEachSeries(res, removeFunc, function(err) {
      if (err) {
        return send({
          error: err.message
        }, 500);
      } else {
        return delFunc();
      }
    });
  };
  delFunc = function() {
    var query;
    query = JSON.parse(JSON.stringify(body));
    return request.get(_this.appName, params, function(path) {
      path = ("" + params.type + "/") + path;
      return db.view(path, query, function(err, res) {
        if (err) {
          return send({
            error: "not found"
          }, 404);
        } else {
          if (res.length > 0) {
            return removeAllDocs(res);
          } else {
            return send({
              success: true
            }, 204);
          }
        }
      });
    });
  };
  return delFunc();
});

action('definition', function() {
  var _this = this;
  return db.get("_design/" + params.type, function(err, res) {
    var design_doc, views;
    if (err && err.error === 'not_found') {
      design_doc = {};
      design_doc[params.req_name] = body;
      return db.save("_design/" + params.type, design_doc, function(err, res) {
        if (err) {
          console.log("[Definition] err: " + JSON.stringify(err));
          return send({
            error: err.message
          }, 500);
        } else {
          return send({
            success: true
          }, 200);
        }
      });
    } else if (err) {
      return send({
        error: err.message
      }, 500);
    } else {
      views = res.views;
      return request.create(_this.appName, params, views, body, function(err, path) {
        views[path] = body;
        return db.merge("_design/" + params.type, {
          views: views
        }, function(err, res) {
          if (err) {
            console.log("[Definition] err: " + JSON.stringify(err));
            return send({
              error: err.message
            }, 500);
          } else {
            return send({
              success: true
            }, 200);
          }
        });
      });
    }
  });
});

action('remove', function() {
  var _this = this;
  return db.get("_design/" + params.type, function(err, res) {
    var views;
    if (err && err.error === 'not_found') {
      return send({
        error: "not found"
      }, 404);
    } else if (err) {
      return send({
        error: err.message
      }, 500);
    } else {
      views = res.views;
      return request.get(_this.appName, params, function(path) {
        if (path === ("" + params.req_name)) {
          return send({
            success: true
          }, 204);
        } else {
          delete views["" + path];
          return db.merge("_design/" + params.type, {
            views: views
          }, function(err, res) {
            if (err) {
              console.log("[Definition] err: " + JSON.stringify(err));
              return send({
                error: err.message
              }, 500);
            } else {
              return send({
                success: true
              }, 204);
            }
          });
        }
      });
    }
  });
});
