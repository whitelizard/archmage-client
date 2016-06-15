import { ArchmageSocket } from './archmage-socket';
import Promise from 'bluebird';
import crypto from 'crypto';

// const defaults = {
//   confAPIName: 'xiconf',
//   readUserSignal: 'readUsers',
//   confUpdateSignal: 'confUpdate',
// };

export default class ArchmageSession {

  // ------ SETUP ------ //

  constructor(url, protocols, options) {
    if (options) {
      this.reloginCallback = options.reloginCallback;
      this.reloginFailCallback = options.reloginFailCallback;
      this.userObjUpdateCallback = options.userObjUpdateCallback;
      this.confAPIName = options.confAPIName;
      this.readUserSignal = options.readUserSignal;
      this.confUpdateSignal = options.confUpdateSignal;
    }
    this.authenticated = false;
    this.hasBeenConnected = false;
    this.authObj = undefined;
    this.user = undefined;
    this.socket = new ArchmageSocket(url, protocols, options);
    this.socket.ws.onOpen(this.onOpen);
    this.socket.ws.onClose(this.onClose);
  }

  // ------ INTERFACE IMPLEMENTATION ------ //

  isOpen() {
    return this.socket.isOpen() && this.authenticated;
  }

  auth(userId, password, tenant, pid, signal, source, payloadExtra) {
    const passwordHash = this.hashify(password);
    return this.socket.init(userId, password, tenant, pid, signal, source, payloadExtra)
      .then(msgObj => {
        if (!this.handleInitReply(msgObj, userId, passwordHash)) {
          const reason = `${msgObj.signal}: ${msgObj.payload && msgObj.payload[0]}`;
          Promise.reject(reason);
        }
        return msgObj;
      });
  }

  logout() {
    this.user = undefined;
    this.authenticated = false;
    this.authObj = undefined;
    const tempResult = this.socket.kill(true);
    this.socket = undefined;
    return tempResult;
  }

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
  //       defer.reject('sub.'+msgObj.signal+': '+(msgObj.payload ? msgObj.payload[0]+'' : 'undefined'));
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
  //       defer.reject('req.'+msgObj.signal+': '+(msgObj.payload ? msgObj.payload[0]+'' : 'undefined'));
  //     }
  //   }
  // }

  // ------ PRIVATE METHODS ------ //

  hashify(phrase) {
    return crypto.createHash('sha256').update(phrase).digest('hex');
  }

  handleInitReply(msgObj, userId, pwHash) {
    console.log('Login reply: ', msgObj);
    this.authenticated = msgObj.ok;

    if (msgObj.ok) {
      this.authObj = { userId, passwordHash: pwHash, rid: null };
      if (msgObj.payload && msgObj.payload[0]) {  // TODO: perhaps not rid in respons
        this.authObj.rid = msgObj.payload[0];
      }
    }
    return msgObj.ok;
  }

  // BELOW NEEDS CONVERSION!
  // userObjUpdate(msgObj) {
  //   if (msgObj.payload && _.isObject(msgObj.payload[0])) {
  //     this.user = msgObj.payload[0];
  //     if (_.isFunction(this.userObjUpdateCallback)) this.userObjUpdateCallback(msgObj);
  //   }
  // }

  onOpen() {
    if (this.hasBeenConnected && this.authObj) {  // Need to relogin?
      this.socket.init(this.authObj.userId, this.authObj.passwordHash)
        .then(msgObj => {
          console.log('Re-login attempt was successful');
          if (this.reloginCallback) this.reloginCallback(msgObj);
        })
        .catch(reason => {
          console.log('Re-login attempt failed: ', reason);
          if (this.reloginFailCallback) this.reloginFailCallback(reason);
        });
    }
  }

  onClose() {
    this.hasBeenConnected = true;
  }
}

// import SHA from 'sha.js';
  // var hashObj:jsSHA.jsSHA = new jsSHA(phrase, 'TEXT');
  // return hashObj.getHash('SHA-256', 'HEX');

  // const sha256 = SHA('sha256');
  // return sha256.update(phrase, 'utf8').digest('hex');
