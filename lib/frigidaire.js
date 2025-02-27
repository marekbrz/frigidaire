/*
 * Frigidaire Appliance Node.js Module
 *
 * Author Karl Grindley <@karlg100>
 *
 * Todo ?
 *
 */

 'use strict';

 var debug = require('debug')('frigidaire:lib');
 var extend = require('xtend');
 var request = require('request');
 var randomstring = require('randomstring');
 
 // Constants
 var REQUEST_TIMEOUT = 5000;
 var LASTUPDATE_TIMEOUT = 60000;
 var MAX_RETRIES = 10;
 
 // toggle if we should send requests (disable for testing)
 var SEND_REQUEST = true;
 
 // New vars
 var opts = {};
 
 var defaults = {
     username: null,
     password: null,
     apiUrl: 'https://api.latam.ecp.electrolux.com'
 };
 
 function Frigidaire(options) {
     if (!(this instanceof Frigidaire)) {
         return new Frigidaire(options);
     }
 
     opts = extend(defaults, options);
 
     this.username = opts.username;
     this.password = opts.password;
     this.appVersion = opts.appVersion || "4.0.2";
     this.clientId = opts.clientId || "e9c4ac73-e94e-4b37-b1fe-b956f568daa0";
     this.userAgent = opts.userAgent || 'Frigidaire/81 CFNetwork/1121.2.2 Darwin/19.2.0';
     this.basicAuthToken = opts.basicAuthToken || 'dXNlcjpwYXNz';
     this.deviceId = opts.deviceId || this.generateId();
     this.country = opts.country || 'US';
     this.brand = opts.brand || 'Frigidaire';
     this.sessionKey = opts.sessionKey || null;
     this.pollingInterval = opts.pollingInterval || 10000; // default to 10 seconds, so we don't hammer their servers
     this.disableTemp = opts.disableTemp || false;
     this.attempts = 0;
     this.deviceList = null;
     this.lastUpdate = null;
     this.updateTimer = [];
     //this.stage = false;

     // global lock for requests
     this.getBusy = false;
     this.postBusy = false;  
     this.authPending = false;
 
     // attributes
     this.VERSION = '0011';
     this.FILTER = '1021';
     // 7001 - sleep mode
     this.MODE = '1000';
     this.SETPOINT = '0432';
     this.TEMP = '0430';
     this.UNIT = '0420';
     this.FANMODE = '1002';
     this.CURRENTSTATE = '0401'
     // 7008 - Model
     // 7009 - Serial Number
     // 7010 - NIU Version
     this.COOLINGSTATE = '04A1';
     // 7013 - unknown
     // 7020 - unknown
     // 7024 - unknown
     // 7025 - unknown
     // 7026 - unknown
     // 7027 - unknown
     this.CLEANAIR = '1004';
     // 7029 - unknown
     // 7030 - unknown
     // 7031 - unknown
     // 7036 - schedule on/off
     // 7038 - unknown
     // 7046 - unknown 
     // 7047 - unknown 
     // 7048 - unknown 
     // 7049 - unknown on/off what? off
     // 7051 - unknown "Image OK" Firmware checksum?
 
     // mode values
     this.FANMODE_AUTO = 7;
     this.FANMODE_HIGH = 4;
     this.FANMODE_MED = 2;
     this.FANMODE_LOW = 1;
 
     this.CLEANAIR_ON = 1;
     this.CLEANAIR_OFF = 0;
 
     this.COOLINGSTATE_OFF = 0;
     this.COOLINGSTATE_ON = 1;
 
     this.FILTER_GOOD = 0;
     this.FILTER_CHANGE = 2;
 
     this.MODE_OFF = 0;
     this.MODE_ECON = 4;
     this.MODE_FAN = 3;
     this.MODE_COOL = 1;
 
     this.FAHRENHEIT = 1;
     this.CELSIUS = 0;

     // login and init
     this.init();
 }
 
 Frigidaire.prototype.set = function (name, value) {
     opts[name] = value;
 };
 
 Frigidaire.prototype.generateId = function () {
     return randomstring.generate({ length: 2, charset: 'hex' }).toLowerCase() + '-' +
         randomstring.generate({ length: 34, charset: 'hex' }).toLowerCase();
 }
 
 Frigidaire.prototype.parseJSON = function (result) {
     if (result) {
         try {
             var parsed = JSON.parse(result);
             //debug(parsed);
             //return {"status": "SUCCESS", "code": "success", "data": result};
             return parsed;
         } catch (e) {
             // we failed to parse the JSON, try again?
             console.error("failed to parse json: '" + body + "'");
             debug("failed to parse json: '" + body + "'");
             return {"status": "ERROR", "code": "unknown", "data": null};
         }
    } else {
        debug('parseJSON() - no result');
        return {"status": "ERROR", "code": "empty JSON string", "data": null};
    }
 }
 
 /**
  * New implementations (port of Colt JS)
  */
 //Frigidaire.prototype.get = function(endpoint, args, callback, retry = true, dataType, timeout) {
 Frigidaire.prototype.get = function (endpoint, args, callback, retry = true, dataType = 'json', timeout = REQUEST_TIMEOUT) {
 
     debug('get() - ' + endpoint);
 
     var self = this;
 
     // check for other requests
/*
     if (self.getBusy) {
         if (retry != true) {
             debug("get is already running, and told not to retry, exiting...");
             return callback(new Error('get is already running, and told not to retry, exiting...'));
         }
         var sleepTime = Math.floor(Math.random() * Math.floor(500));
         //var sleepTime = 1000;
         debug("get already running, sleeping for " + sleepTime);
         setTimeout(self.get, sleepTime, endpoint, args, callback, retry, dataType, timeout);
         //debug("get() - already running, exiting");
         return;
     } else
         self.getBusy = true;
*/
 
     if (!self.sessionKey) {
         debug('no sessionKey, starting auth sequence');
         self.getBusy = false;
         self.authStage1(function authStg1GetCallback(err, response) {
             if (err) {
                 return callback(err);
             }
             //console.log(response)
             //self.sessionKey = response
             self.get(endpoint, args, callback, retry, dataType, timeout);
         });
         return;
     }
     debug("get() - post auth stage");
     var query = {};
 
     //debug(args);
     for (var key in args) {
         if (typeof args[key] == 'string') {
             args[key] = args[key].replace(/[\\\']/g, '');
         }
 
         query[key] = args[key];
     }
 
     var url = opts.apiUrl + endpoint + args.join('/');
     var headers = {
         'x-ibm-client-id': this.clientId,
         'User-Agent': this.userAgent,
         'Content-Type': 'application/json',
         'Authorization': 'Basic ' + this.basicAuthToken
     }
     //debug(query);
 
     //var query = []
 
     headers['session_token'] = this.sessionKey;

     //applianceObj = self.getDevice(applianceSn, callback);
 
     //if (this.applianceObj) {
         //var urlQueryString = "?pnc=" + this.applianceObj.pnc + "&elc=" + this.applianceObj.elc + "&sn=" + this.applianceObj.sn + "&mac=" + this.applianceObj.mac;
         //url = url + urlQueryString
     //}
 
     //debug('url: %s', url);
     //debug('headers: %s', headers);
     //debug('form: %s', form);
     //debug('attempts: %s', self.attempts);
 
     if (!this.sessionKey) {
       debug("get() - No session key, returning");
       return;
     }

     if ('undefined' === typeof SEND_REQUEST || SEND_REQUEST) {
         request.get({ url: url, headers: headers, parameters: query, jar: true, strictSSL: false, timeout: timeout }, function (err, response, body) {

/*
             if (err) {
                 debug('request.get - error: ' + err);
                 self.init();
                 return callback(err);
             }
*/

              if (err) {
                 debug("Error " + err + " Response: " + response + " Body: " + body);
                 self.getBusy = false;
                 return callback(err);
             }
  
             //debug("testing for maximum retries");
             if (self.attempts >= MAX_RETRIES ) {
                 err = new Error('maximum retries, giving up.');
                 self.attempts = 0;
                 self.getBusy = false;
                 return callback(err);
             }
 
             ++self.attempts;
 
             //debug("testing for response");
             if (!response) {
                 // something hung up in the SSL or TCP connect session.  try again.
                 console.log('no response, retry!');
                 self.getBusy = false;
                 //return self.get(endpoint, args, callback, retry, dataType, timeout);
                 return;
             }

             //debug(body)
 
             var jsonResponse = self.parseJSON(body)
             //var jsonResponse = JSON.parse(body)
             if (jsonResponse.status === 'ERROR' && jsonResponse.code === 'ECP0105') {
                 debug("Received error ECP0105 indicating bad session token. resetting plugin state...")
                 self.getBusy = false;
                 self.init();
                 //self.sessionKey = null;
                 return;
                 //return self.get(endpoint, args, callback, retry, dataType, timeout)
             }
 
             //debug("testing for errors");
             if (response.statusCode != 200) {
                 debug(" Not a 200 status code.  Response: " + response + " Body: " + body);
                 err = new Error(response.statusCode + ' ' + response.statusMessage);
                 return;
             }

             self.getBusy = false;
             debug("get() - end request callback");
             return callback(null, body);
         });
     }
 }
 
 Frigidaire.prototype.post = function (applianceObj, endpoint, args, body, callback, authPost = false, retry = true, dataType = 'json', timeout = REQUEST_TIMEOUT) {
     debug('post()');
     //debug(applianceObj);
     var self = this;
 
/*
     if (self.postBusy) {
         if (retry != true) {
             debug("post is already running, and told not to retry, exiting...");
             return callback(new Error('post is already running, and told not to retry, exiting...'));
         }
         //var sleepTime = Math.floor(Math.random() * Math.floor(500));
         //var sleepTime = 1000;
         //debug("post already running, sleeping for " + sleepTime);
         //return setTimeout(function () { self.post(applianceObj, endpoint, args, body, callback, retry, dataType, timeout) }, sleepTime);
         debug("post() - already running, exiting");
         return;
     } else
         self.postBusy = true;
*/
 
     //dataType = dataType || 'json';
     //timeout  = timeout || REQUEST_TIMEOUT;
 
     if (!self.sessionKey && authPost != true) {
         debug('no sessionKey, starting auth sequence');
         //self.postBusy = false;
         return self.authStage1(function (err, response) {
             if (err) {
                 return callback(err);
             }
             return self.post(applianceObj, endpoint, args, body, callback, retry, dataType, timeout);
 
         });
     }
 
     var url = opts.apiUrl + endpoint + args.join('/');
     var headers = {
         'x-ibm-client-id': this.clientId,
         'User-Agent': this.userAgent,
         'Content-Type': 'application/json',
         'Authorization': 'Basic ' + this.basicAuthToken
     }
 
     if (this.sessionKey)
         headers['session_token'] = this.sessionKey;
 
     if (applianceObj) {
         var urlQueryString = "?pnc=" + applianceObj.pnc + "&elc=" + applianceObj.elc + "&sn=" + applianceObj.sn + "&mac=" + applianceObj.mac;
         url = url + urlQueryString
     }
 
     debug('url: %s', url);
     //debug('headers: %s', headers);
     //debug('form: %s', form);
     debug('attempts: %s', self.attempts);
 
     if ('undefined' === typeof SEND_REQUEST || SEND_REQUEST) {
         request.post({ url: url, headers: headers, json: body, strictSSL: false, timeout: timeout},
             function postResponseCallback(err, response, body) {
 
                 //debug(body)
 
                 debug("testing for maximum retries");
                 if (self.attempts >= MAX_RETRIES) {
                     err = new Error('maximum retries, giving up.');
                     self.attempts = 0;
                     self.postBusy = false;
                     return callback(err);
                 }
 
                 //debug("testing for response");
                 if (!response) {
                     // something hung up in the SSL or TCP connect session.  try again.
                     console.log('no response, retry!');
                     self.postBusy = false;
                     return self.post(applianceObj, endpoint, args, body, callback, authPost, retry, dataType, timeout);
                 }
 
                 //debug("get() : statusCode - "+response.statusCode);
                 //debug("get() : body - "+body);
                 //debug("get() : callback - "+callback);
/*
 
                 //debug("testing for expired session");
                 if (response.statusCode == 401 && self.stage != 1) {
                     // we were authenticated, now we are not.  reset everything and start over
                     debug('we lost our auth, reset everything and retry');
                     self.attempts = 0;
                     self.init();
                     self.getBusy = false;
                     return self.get(endpoint, args, callback, retry, dataType, timeout);
                 }
*/
 
                 //debug("testing for 401 init");
                 //if (response.statusCode == 401 && self.stage == 1) {
                 if (response.statusCode == 401) {
                     self.postBusy = false;
                     return callback(null, body);
                 } /* else if (response.statusCode == 400 && self.attempts < 3) {
                       self.sessionKey = null;
               
                       return self.get(endpoint, args, callback, retry, dataType, timeout);
                     } */
 
                 //debug("testing for errors");
                 if (!err && response.statusCode != 200) {
                     err = new Error(response.statusCode + ' ' + response.statusMessage);
                 }
 
                 if (err) {
                     debug("Error " + response.statusCode + " : " + response.statusMessage);
                     self.postBusy = false;
                     return callback(err);
                 }
 
                 debug("reseting attempts");
                 self.attempts = 0;
 
                 //debug("everything good, callback time");
                 self.postBusy = false;
                 return callback(null, body);
             }
            );
     }
 }
 
 Frigidaire.prototype.init = function () {
     debug("init()");
     var self = this
     //this.updateTimer.forEach(function (timer) {
     //clearInterval(timer);
     //});
     //this.updateTimer = [];
     this.deviceList = null;
     this.sessionKey = null;
     this.lastUpdate = null;
     this.authPending = false;
     request.jar();

     this.authStage1( function(err, data) {
         debug("init() -> authStage1 callback");
         self.getDevices( function (err, data) {
             debug("getDevices() - callback");
             if (!self.deviceList) {
                 debug("authStage1() -> getDevices() -> deviceList is empty!");
                 return;
             }
             self.deviceList.forEach((device) => {
                 debug("getDevices() - callback() - getting telem for " + device.sn);
                 self.getTelem(device.sn, function(err,data) {});
             });
             return;
         });
         return;
     });
     debug("init() - end");
     return;
 }
 
 Frigidaire.prototype.scheduleUpdates = function (applianceSn, callback) {
     var self = this;
 
     debug("scheduling callbacks....");
 
     var sleepTime = self.pollingInterval + Math.floor(Math.random() * Math.floor(500)); // we need some randomness, otherwise one will always fail to run
     //var timer = setInterval(function(){ self.getTelemUpdate(applianceId, callback); }, sleepTime);
     var timer = setInterval(function () { self.getTelem(applianceSn, callback); }, sleepTime);
     self.updateTimer.push(timer);
 }
 
 Frigidaire.prototype.authStage1 = function authStage1Callback(callback) {
     debug("authStage1()");

     if (this.authPending == true) {
         var sleepTime = 1000;
         //debug("auth already running running, calling callback in " + sleepTime);
         //return setTimeout(function () { callback(null, {}) }, sleepTime);
         debug("authStage1() - auth already running running, exiting");
         //callback(null, {})
         return;
     }

     this.authPending = true;
     var self = this;
     //debug("testing for maximum retries");
     if (self.attempts >= MAX_RETRIES) {
         var err = new Error('maximum retries, giving up.');
         self.attempts = 0;
         self.postBusy = false;
         return callback(err);
     }
     ++self.attempts;
 
     if (!this.username) {
         return callback(new Error('Missing parameter \'username\''));
     }
 
     if (!this.password) {
         return callback(new Error('Missing parameter \'password\''));
     }
 
     //this.sessionKey = this.generateId();
 
     var headers = {
         'x-ibm-client-id': this.clientId,
         'User-Agent': this.userAgent,
         'Content-Type': 'application/json',
         'Authorization': 'Basic ' + this.basicAuthToken
     }
 
     var authBody = {
         "username": this.username,
         "password": this.password,
         "brand": this.brand,
         "deviceId": this.deviceId,
         "country": this.country,
     }
 
     var authUrl = opts.apiUrl + '/authentication/authenticate'
 
     debug("authStage1() - post()");
     request.post({ url: authUrl, headers: headers, json: authBody, strictSSL: false}, function authPostCallback(err, response, body) {
         debug("authStage1() - postCallback()");
         if (err) {
             debug('auth error: ') + err;
             self.init();
             return callback(err);
         }
         var json = body;
 
         if (json.status === 'ERROR' && json.code === 'ECP0108') {
             err = new Error(json.code + ' ' + json.message);
             return callback(err)
         }
 
         try {
             self.sessionKey = json.data.sessionKey;
         } catch (e) {
             // we failed to parse the JSON, try again?
             console.error("failed to parse auth result json: '" + json + "'");
         }
 
         var sessionKey = body.data.sessionKey
         debug('Acquired new sessionKey: ' + sessionKey)
         self.attempts = 0;
 
         self.authPending = false;
         return callback(null, {})
     });
     debug("authStage1() - end");
 }
 
 Frigidaire.prototype.getDevice = function (applianceSn) {
     var self = this;
     var applianceObj = false;
     debug('getDevice() - sn: ' + applianceSn);

     if (!applianceSn)
         applianceSn = self.deviceList[0].sn;

     for (var i = 0; i < self.deviceList.length; i++) { 
         //debug(self.deviceList[i])
         if (self.deviceList[i].sn === applianceSn) {
             debug('found appliance match!')
             applianceObj = self.deviceList[i];
             break;
         }
     }
 
     if (applianceObj == false)
         debug('no appliance found! ensure correct serial number entered in config');
     return applianceObj;
 };
 
 Frigidaire.prototype.getDeviceIndex = function (applianceSn) {
     var self = this;
     debug('getDeviceIndex() - sn: ' + applianceSn);

     if (!applianceSn)
         return 0;

     for (var i = 0; i < self.deviceList.length; i++) { 
         //debug(self.deviceList[i])
         if (self.deviceList[i].sn === applianceSn) {
             debug('found appliance match!')
             return i;
         }
     }
 
     debug('no appliance found! ensure correct serial number entered in config');
     return false;
 };
 
 Frigidaire.prototype.telemPopulated = function () {
    if (!this.deviceList) {
        debug("telemPopulated() - no deviceList");
        return false;
    }
    for (var i = 0; i < this.deviceList.length; i++) { 
        if (!this.deviceList[i].telem) {
            debug("telemPopulated() - missing telementry for device " + this.deviceList[i].sn);
            return false;
        }
    }
    return true;
 }

 Frigidaire.prototype.getTelem = function (applianceSn, callback) {
     debug('getTelem() - ' + applianceSn);
     var self = this;
     if (this.lastUpdate - Math.round(Date.now() / 1000) > LASTUPDATE_TIMEOUT) {
         self.lastUpdate = Math.round(Date.now() / 1000);
         callback("getTelem() - Exceeded lastUpdate timeout " + LASTUPDATE_TIMEOUT + ", calling init()");
         this.init();
         return;
     }

     if (!this.deviceList) {
         //var sleepTime = Math.floor(Math.random() * Math.floor(500));
         //var sleepTime = 1000;
         //debug("getTelem() - waiting for deviceList to populate, sleeping for " + sleepTime);
         //return setTimeout(function () { self.getTelem(applianceSn, callback) }, sleepTime);
         debug("getTelem() - no deviceList, exiting");
         return;
     }

     var uri = '/elux-ms/appliances/latest'

     var applianceIndex = self.getDeviceIndex(applianceSn);
 
     var urlQueryString = "?pnc=" + self.deviceList[applianceIndex].pnc + "&elc=" + self.deviceList[applianceIndex].elc + "&sn=" + self.deviceList[applianceIndex].sn + "&mac=" + self.deviceList[applianceIndex].mac;
     uri = uri + urlQueryString

     self.get(uri, [], function (err, data) {
         if (err) {
             return callback(err);
         }
 
         var jsonData = self.parseJSON(data);
         if (jsonData.status === 'ERROR') {
             debug('getTelemCallback() - error parsing JSON: ' + jsonData);
             return callback('JSON parse error', null);
         }
         self.deviceList[applianceIndex].telem = jsonData.data;
 
         //debug(self.deviceList);
         self.lastUpdate = Math.round(Date.now() / 1000);
         debug('getTelemCallback() - end');
         return callback(null, jsonData.data);
     });
     debug('getTelem() - end');
 };
 
 Frigidaire.prototype.getDevices = function (callback, self = this, attempt = 0) {
     debug('getDevices()');

     if (self.authPending == true) {
         ++attempt;
         if (attempt > MAX_RETRIES) {
             debug("getDevices() - max retries reached. Not rescheduling.");
             return;
         }
         var sleepTime = 1000;
         debug("getDevices() - auth is pending, reschedluing this call in " + sleepTime);
         setTimeout(self.getDevices, sleepTime, callback, self, attempt);
         //callback(null, {})
         return;
     }

     if (self.deviceList) {
         callback(null, self.deviceList);
         return;
     }

     var query = new Array();
 
     var uri = '/user-appliance-reg/users/' + opts.username + '/appliances'
 
     self.get(uri, query, function (err, data) {
         if (err) {
             return callback(err);
         }
 
         var parsedData = self.parseJSON(data)
         //var parsedData = JSON.parse(data)
         //debug(parsedData);
         if (parsedData.status === 'ERROR') {
             debug('getTelemCallback() - error parsing JSON: ' + jsonData);
             return callback('JSON parse error', null);
         }
         debug(parsedData);
         self.deviceList = parsedData.data;
         debug(self.deviceList);
         callback(null, parsedData.data);
         return;
     });
 }

 Frigidaire.prototype.hasAttribute = function (applianceSn, attribute) {
     debug('getValue(attribute: ' + attribute + ')');
     var self = this;
 
     var applianceIndex = self.getDeviceIndex(applianceSn);
 
     if (!self.deviceList[applianceIndex].telem) {
         debug('Telementry not defined for sn: ' + applianceSn);
         return false;
     }
 
     var attr = false;
     for (var i = 0; i < self.deviceList[applianceIndex].telem.length; i++) { 
         if (self.deviceList[applianceIndex].telem[i].haclCode == attribute) {
             return true;
         }
     }
 
     debug('Attribute ' + attribute + ' not found in device telemetry');
     return false;
 }
 
 Frigidaire.prototype.getValue = function (applianceSn, attribute, callback, attempt = 0) {
     debug('getValue(attribute: ' + attribute + ')');
     var self = this;
 
     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getValue() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getValue() - no telementry, exiting", null);
         return callback("getValue() - no telementry, exiting", null);
     }

     var applianceIndex = self.getDeviceIndex(applianceSn);
 
     if (!self.deviceList[applianceIndex].telem) {
         var err = new Error('Telementry not defined for sn: ' + applianceSn);
         return callback(err, null);
     }
 
     try {
         var attr = false;
         for (var i = 0; i < self.deviceList[applianceIndex].telem.length; i++) { 
             if (self.deviceList[applianceIndex].telem[i].haclCode == attribute) {
                 attr = self.deviceList[applianceIndex].telem[i];
             }
         }
 
         //debug(attr);
         if (attr === false) {
             err = new Error('Attribute ' + attribute + ' not found in device telemetry');
             return callback(err, null);
         }
 
         if (attr.haclCode === '0430' || attr.haclCode === '0432') {
             var value = attr.containers[1].numberValue;
         }
         else {
             var value = attr.numberValue;
         }
         debug('applianceSn ' + applianceSn + ' attribute ' + attribute + ' has the value ' + value);
     } catch (e) {
         err = new Error('Error parsking attribute ' + attribute + ' for applianceSn ' + applianceSn + ': ' + e);
         return callback(err, null);
     }
     return callback(null, value);
 }
 
 // send commands/actions
 Frigidaire.prototype.sendAction = function (applianceObj, attribute, value, callback) {
     var self = this;
 
     var timestamp = Math.round(Date.now() / 1000)
 
     var components = []
     var component = { "name": attribute, "value": value }
 
     if (attribute !== '0432') {
         components.push(component)
     }
     else {
         components = [
             { "name": attribute, "value": "Container" },
             { "name": "1", "value": value },
             { "name": "3", "value": 0 },
             { "name": "0", "value": 1 }
         ]
     }
     
     var postBody = {
         "timestamp": timestamp,
         "source": "RP1",
         "components": components,
         "operationMode": "EXE",
         "destination": "AC1",
         "version": "ad"
     }
 
     return this.post(applianceObj, '/commander/remote/sendjson', [], postBody, callback);
 };
 
 /**
  * Implemented actions
  **/

 Frigidaire.prototype.getMode = function (applianceSn, callback) {
     debug("getMode()");
     var self = this;

     if (!this.telemPopulated()) {
         //debug(this.deviceList);
         debug("getMode() - no telementry, exiting");
         return callback("getMode() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
 
     //debug("getting mode for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.MODE, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.getCoolingState = function (applianceSn, callback, attempt = 0) {
     debug("getCoolingState()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getCoolingState() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getCoolingState() - no telementry, exiting");
         return callback("getCoolingState() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     debug("getting cooling state for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.COOLINGSTATE, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.mode = function (applianceSn, mode, callback, attempt = 0) {
     debug("mode()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("mode() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("mode() - no telementry, exiting");
         return callback("mode() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
 
     debug("changing mode to " + mode);
     this.sendAction(applianceObj, this.MODE, mode, callback);
 };
 
 Frigidaire.prototype.getUnit = function (applianceSn, callback, attempt = 0) {
     debug("getUnit()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getUnit() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getUnit() - no telementry, exiting");
         return callback("getUnit() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     debug("getting units for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.UNIT, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.changeUnits = function (applianceSn, unit, callback, attempt = 0) {
     debug("changeUnits()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("changeUnits() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("changeUnits() - no telementry, exiting");
         return callback("changeUnits() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
  
     debug("changing units for " + applianceObj.sn + " to " + unit);
     this.sendAction(applianceObj, this.UNIT, unit, callback);
 };
 
 Frigidaire.prototype.getCleanAir = function (applianceSn, callback, attempt = 0) {
     debug("getCleanAir()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getCleanAir() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getCleanAir() - no telementry, exiting");
         return callback("getCleanAir() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     if (!this.hasAttribute(applianceSn, this.CLEANAIR)) {
         debug("cleanAir() - No clean air attirbute, exiting gracefully...");
         return callback(null, this.CLEANAIR_OFF);
     }

     debug("getting clean air status for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.CLEANAIR, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.cleanAir = function (applianceSn, mode, callback, attempt = 0) {
     debug("cleanAir()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("cleanAir() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("cleanAir() - no telementry, exiting");
         return callback("cleanAir() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     if (!this.hasAttribute(applianceSn, this.CLEANAIR)) {
         debug("cleanAir() - No clean air attirbute, exiting gracefully...");
         return callback(null, this.CLEANAIR_OFF);
     }
  
     debug("changing clean air for " + applianceObj.sn + " to " + mode);
     this.sendAction(applianceObj, this.CLEANAIR, mode, callback);
 };

 Frigidaire.prototype.getFilter = function (applianceSn, callback, attempt = 0) {
     debug("getFilter()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getCleanAir() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getCleanAir() - no telementry, exiting");
         return callback("getCleanAir() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     if (!this.hasAttribute(applianceSn, this.FILTER)) {
         debug("getFilter() - No filter attirbute, exiting gracefully...");
         return callback(null, this.FILTER_GOOD);
     }

     debug("getting filter status for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.FILTER, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.fanMode = function (applianceSn, mode, callback, attempt = 0) {
     debug("fanMode()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("fanMode() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("fanMode() - no telementry, exiting");
         return callback("fanMode() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
  
     debug("changing fan speed for " + applianceObj.sn + " to " + mode);
     this.sendAction(applianceObj, this.FANMODE, mode, callback);
 };
 
 Frigidaire.prototype.getFanMode = function (applianceSn, callback, attempt = 0) {
     debug("getFanMode()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getFanMode() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getFanMode() - no telementry, exiting");
         return callback("getFanMode() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     debug("getting fan mode for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.FANMODE, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.setTemp = function (applianceSn, temp, callback, attempt = 0) {
     debug("setTemp()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("setTemp() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("setTemp() - no telementry, exiting");
         return callback("setTemp() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
  
     debug("changing temp for " + applianceObj.sn + " to " + temp);
     this.sendAction(applianceObj, this.SETPOINT, Math.round(temp), callback);
 };
 
 Frigidaire.prototype.getTemp = function (applianceSn, callback, attempt = 0) {
     debug("getTemp()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getTemp() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getTemp() - no telementry, exiting");
         return callback("getTemp() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);
 
     debug("getting temp for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.SETPOINT, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 Frigidaire.prototype.getRoomTemp = function (applianceSn, callback, attempt = 0) {
     debug("getRoomTemp()");
     var self = this;

     ++attempt;
     if (attempt > MAX_RETRIES) {
         callback("getRoomTemp() - max retries exceeded", null);
         return;
     }

     if (!this.telemPopulated()) {
         debug("getRoomTemp() - no telementry, exiting");
         return callback("getRoomTemp() - no telementry, exiting", null);
     }

     var applianceObj = this.getDevice(applianceSn);

     if (this.disableTemp)
         return callback(null, undefined);
 
     debug("getting room temp for " + applianceObj.sn);
     this.getValue(applianceObj.sn, this.TEMP, function (err, result) {
         if (err) {
             return callback(err);
         }
         return callback(null, result);
     });
 };
 
 module.exports = Frigidaire;
