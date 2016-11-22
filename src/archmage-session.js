import { ArchmageSocket } from './archmage-socket';
import { fromJS } from 'immutable';
import crypto from 'crypto';
import Promise from 'bluebird';

// const defaults = {
//   confAPIName: 'xiconf',
//   readUserSignal: 'readUsers',
//   confUpdateSignal: 'confUpdate',
// };

export default class ArchmageSession {

  // ------ SETUP ------ //

  constructor(url, protocols, options = {}) {
    this.authenticated = false;
    this.hasBeenConnected = false;
    this.authObj = undefined;
    this.user = undefined;

    this.socket = new ArchmageSocket(url, protocols, options);
    this.socket.ws.onOpen(::this.onOpen);
    this.socket.ws.onClose(::this.onClose);

    if (url) {
      this.connect(url, protocols, options);
    } else {
      this.setOptions(options);
    }
  }

  connect(url, protocols, options = {}) {
    this.setOptions(options);
    this.socket.connect(url, protocols, options);
  }

  setOptions(options) {
    this.reloginCallback = options.reloginCallback || this.reloginCallback;
    this.reloginFailCallback = options.reloginFailCallback || this.reloginFailCallback;
    this.userObjUpdateCallback = options.userObjUpdateCallback || this.userObjUpdateCallback;
    this.confAPIName = options.confAPIName || this.confAPIName;
    this.readUserSignal = options.readUserSignal || this.readUserSignal;
    this.confUpdateSignal = options.confUpdateSignal || this.confUpdateSignal;
  }

  // ------ INTERFACE IMPLEMENTATION ------ //

  isOpen() {
    return this.socket.isOpen() && this.authenticated;
  }

  init() {
    if (window && window.localStorage) {
      this.authObj = fromJS(JSON.parse(window.localStorage.getItem('authObj'))) || undefined;
      // console.log('authObj from localStorage', this.authObj);
      if (this.authObj) {
        return this.cachedInit();
      }
    }
    return Promise.reject(new Error('No cached credentials'));
  }

  auth(userId, password, tenant, target, signal, args) {
    const passwordHash = this.hashify(password);
    const reqInitObj = fromJS({
      userId, passwordHash, tenant, target, signal, args,
    });
    return this.socket.init(userId, passwordHash, tenant, target, signal, args)
      .then(msgObj => {
        // console.log('Login reply: ', msgObj.toJS());
        this.handleInitReply(msgObj, reqInitObj);
        return msgObj;
      });
  }

  logout() {
    this.user = undefined;
    this.authenticated = false;
    this.authObj = undefined;
    window.localStorage.removeItem('authObj');
    return this.socket.kill(true);
  }

  // ------ PRIVATE METHODS ------ //

  hashify(phrase) {
    return crypto.createHash('sha256').update(phrase).digest('hex');
  }

  handleInitReply(msgObj, reqInitObj) {
    this.authenticated = true;
    this.authObj = reqInitObj.set('rid', undefined);
    if (msgObj.get('payload') && msgObj.get('payload').get(0)) {
      this.authObj = reqInitObj.set('rid', msgObj.get('payload').get(0));
    }
    if (window && window.localStorage) {
      window.localStorage.setItem('authObj', JSON.stringify(this.authObj.toJS()));
    }
  }

  cachedInit() {
    return this.socket.init(
      this.authObj.get('userId'),
      this.authObj.get('passwordHash'),
      this.authObj.get('tenant'),
      this.authObj.get('target'),
      this.authObj.get('signal'),
      this.authObj.get('source'),
      this.authObj.get('payloadExtra'),
    )
      .then(msgObj => {
        this.authenticated = true;
        // console.log('Re-login attempt was successful');
        if (this.reloginCallback) this.reloginCallback(msgObj);
        return msgObj;
      })
      .catch(reason => {
        // console.log('Re-login attempt failed: ', reason);
        if (this.reloginFailCallback) this.reloginFailCallback(reason);
      });
  }

  onOpen() {
    if (this.hasBeenConnected && this.authObj) {  // Need to relogin?
      this.cachedInit();
    }
  }

  onClose() {
    this.hasBeenConnected = true;
    this.authenticated = false;
  }
}

// import SHA from 'sha.js';
  // var hashObj:jsSHA.jsSHA = new jsSHA(phrase, 'TEXT');
  // return hashObj.getHash('SHA-256', 'HEX');

  // const sha256 = SHA('sha256');
  // return sha256.update(phrase, 'utf8').digest('hex');



    // BELOW NEEDS CONVERSION IF ACTIVATED!
    // login(userId, password, tenant, pid, signal, source, payloadExtra) {
    //   const passwordHash = this.hashify(password);
    //   const defer = getDefer();
    //
    //   this.socket.init(userId, passwordHash, tenant, pid, signal, source, payloadExtra)
    //     .then(initSuccess.bind(this));
    //
    //   return defer.promise;
    //
    //   // //////
    //
    //   function initSuccess(msgObj) {
    //     if (this.handleInitReply(msgObj, userId, passwordHash)) {
    //       if (this.authObj.rid) {
    //         this.readUser(this.authObj.rid)
    //           .then(defer.resolve, defer.reject);
    //       } else {
    //         defer.reject('No rid for user object: '+this.authObj.rid);
    //       }
    //     } else {
    //       defer.reject(msgObj.signal+': '+(msgObj.payload ? msgObj.payload[0]+'' : 'undefined'));
    //     }
    //   }
    // }
    // readUser(rid, pid, signal) {
    //   const defer = getDefer();
    //
    //   pid = pid || this.confAPIName || defaults.confAPIName;
    //   signal = signal || this.readUserSignal || defaults.readUserSignal;
    //   this.socket.req(pid, signal, {rids:[rid]})
    //     .then(reqSuccess.bind(this), defer.reject);
    //
    //   return defer.promise;
    //
    //   // //////
    //
    //   function subSuccess(msgObj) {
    //     if (msgObj.ok) {
    //       defer.resolve(this);  // this is set to msgObj on previous call
    //     } else {
    //       defer.reject(
    //       'sub.'+msgObj.signal+': '+(msgObj.payload ? msgObj.payload[0]+'' : 'undefined')
    //       );
    //     }
    //   }
    //
    //   function reqSuccess(msgObj) {
    //     if (msgObj.ok && msgObj.payload) {
    //       this.user = msgObj.payload[0];
    //       const signal = this.confUpdateSignal || defaults.confUpdateSignal;
    //       this.socket.sub(this.userObjUpdate, signal, [rid])
    //         .then(subSuccess.bind(msgObj), defer.reject);
    //     } else {
    //       defer.reject(
    //       'req.'+msgObj.signal+': '+(msgObj.payload ? msgObj.payload[0]+'' : 'undefined')
    //       );
    //     }
    //   }
    // }

    // BELOW NEEDS CONVERSION!
    // userObjUpdate(msgObj) {
    //   if (msgObj.payload && _.isObject(msgObj.payload[0])) {
    //     this.user = msgObj.payload[0];
    //     if (_.isFunction(this.userObjUpdateCallback)) this.userObjUpdateCallback(msgObj);
    //   }
    // }
