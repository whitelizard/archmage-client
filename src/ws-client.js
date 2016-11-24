import Promise from 'bluebird';
import { Map, List } from 'immutable';
// import { w3cwebsocket } from 'websocket';

// const closeCode = 1000;
const reconnectableStatus = 4000;
const timeoutStart = 300;
const timeoutMax = 2 * 60 * 1000;
export const readyStates = Map({
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  RECONNECT_ABORTED: 4,
});

const globalVar = typeof global !== 'undefined'
  ? global
  : (typeof window !== 'undefined' ? window : {});

function createWebSocket(url, protocols, customWsClient) {
  const urlOk = /wss?:\/\//.exec(url);
  if (!urlOk) {
    throw new Error('Invalid url provided');
  }
  const Socket = customWsClient || globalVar.WebSocket || globalVar.MozWebSocket;
  return new Socket(url, protocols || undefined);
}

export default class WsClient {

  // PUBLIC /////////////////////////////////////
  constructor(url, protocols, options = {}) {
    this.init(url, protocols, options);
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.sendQueue = List();
    this.onOpenCallbacks = List();
    this.onCloseCallbacks = List();
    this.onErrorCallbacks = List();
    this.onMessageCallbacks = List();
    this.socket = undefined;
  }

  connect(url, protocols, options = {}) {
    this.init(url, protocols, options);
    if (!this.isOpen()) {
      this.socket = createWebSocket(this.url, this.protocols, this.customWsClient);
      this.socket.onmessage = ::this.onMessageHandler;
      this.socket.onopen = ::this.onOpenHandler;
      this.socket.onerror = ::this.onErrorHandler;
      this.socket.onclose = ::this.onCloseHandler;
    }
    return this;
  }

  isOpen() {
    return this.socket && this.socket.readyState === readyStates.get('OPEN');
  }

  init(url, protocols, options) {
    this.url = url || this.url;
    this.protocols = protocols || this.protocols;
    this.isEncrypted = /^(wss:)/i.test(this.url);

    this.timeoutStart = options.timeoutStart || this.timeoutStart || timeoutStart;
    this.timeoutMax = options.timeoutMax || this.timeoutMax || timeoutMax;
    this.reconnectIfNotNormalClose = options.reconnectIfNotNormalClose ||
      this.reconnectIfNotNormalClose;
    this.customWsClient = options.customWsClient || this.customWsClient;
  }

  onOpen(cb) {
    this.onOpenCallbacks = this.onOpenCallbacks.push(cb);
    return this;
  }

  onClose(cb) {
    this.onCloseCallbacks = this.onCloseCallbacks.push(cb);
    return this;
  }

  onError(cb) {
    this.onErrorCallbacks = this.onErrorCallbacks.push(cb);
    return this;
  }

  onMessage(cb) {
    this.onMessageCallbacks = this.onMessageCallbacks.push(cb);
    return this;
  }

  clearCallbacks() {
    this.onOpenCallbacks = this.onOpenCallbacks.clear();
    this.onCloseCallbacks = this.onCloseCallbacks.clear();
    this.onErrorCallbacks = this.onErrorCallbacks.clear();
    this.onMessageCallbacks = this.onMessageCallbacks.clear();
  }

  send(message) {
    const self = this;
    return new Promise((resolve, reject) => {
      if (self.socket.readyState === readyStates.get('RECONNECT_ABORTED')) {
        reject('Socket connection has been closed');
      } else {
        self.sendQueue = self.sendQueue.push({ message, resolve });
        self.fireQueue();
      }
    });
  }

  close() {
    this.terminate();
    this.manualClose = true;
    return this;
  }

  terminate() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket.close();
  }

  reconnect() {
    this.terminate();
    const backoffDelay = this.getBackoffDelay(++this.reconnectAttempts);
    const backoffDelaySeconds = backoffDelay / 1000;
    console.log(`Reconnecting in ${backoffDelaySeconds} seconds`);
    this.reconnectTimer = setTimeout(::this.connect, backoffDelay);
    return this;
  }

  // /////////////////////////////////////////////

  fireQueue() {
    while (this.sendQueue.size && this.socket.readyState === readyStates.get('OPEN')) {
      const data = this.sendQueue.first();
      this.sendQueue = this.sendQueue.shift();
      this.socket.send(typeof data.message === 'string'
        ? data.message
        : JSON.stringify(data.message)
      );
      data.resolve();
    }
    return this;
  }

  // PRIVATE /////////////////////////////////////

  onOpenHandler(event) {
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.onOpenCallbacks.forEach(cb => cb(event));
    // this.notifyOpenCallbacks(event);
    this.fireQueue();
  }

  onCloseHandler(event) {
    this.onCloseCallbacks.forEach(cb => cb(event));
    const notNormalReconnect = this.reconnectIfNotNormalClose && !this.manualClose;
    // && event.code !== closeCode
    if (notNormalReconnect || event.code === reconnectableStatus) {
      this.reconnect();
    }
  }

  onErrorHandler(event) {
    this.onErrorCallbacks.forEach(cb => cb(event));
  }

  onMessageHandler(message) {
    this.onMessageCallbacks.forEach(cb => cb(message));
  }

  getBackoffDelay(attempt) {
    // Exponential Backoff Formula by Prof. Douglas Thain
    // http://dthain.blogspot.co.uk/2009/02/exponential-backoff-in-distributed.html
    return Math.floor(Math.min(
      (Math.random() + 1) * this.timeoutStart * Math.pow(2, attempt),
      this.timeoutMax
    ));
  }
}


// send(message) {
//   const self = this;
//   const promise = Promise.defer();
//   if (self.readyState === readyStates.RECONNECT_ABORTED) {
//     promise.reject('Socket connection has been closed');
//   } else {
//     self.sendQueue.push({
//       message,
//       promise,
//     });
//     self.fireQueue();
//   }
//   return promise;
// }

  // send(data) {
  //   let deferred = getDefer();
  //   const self = this;
  //   let promise = cancelableify(deferred.promise);
  //
  //   if (this.readyState === readyStates.RECONNECT_ABORTED) {
  //     deferred.reject('Socket connection has been closed');
  //   }
  //   else {
  //     this.sendQueue.push({
  //       message: data,
  //       deferred: deferred
  //     });
  //     this.fireQueue();
  //   }
  //
  //   // Credit goes to @btford
  //   function cancelableify(promise) {
  //     promise.cancel = cancel;
  //     let then = promise.then;
  //     promise.then = function() {
  //       let newPromise = then.apply(this, arguments);
  //       return cancelableify(newPromise);
  //     };
  //     return promise;
  //   }
  //
  //   function cancel(reason) {
  //     self.sendQueue.splice(self.sendQueue.indexOf(data), 1);
  //     deferred.reject(reason);
  //     return self;
  //   }
  //
  //   return promise;
  // }


// export function getDefer(...rest) {
//   let resolve;
//   let reject;
//   const promise = new Promise(() => {
//     resolve = rest[0];  // TODO: ???
//     reject = rest[1];
//   });
//   return {
//     resolve,
//     reject,
//     promise,
//   };
// }
