import Promise from 'bluebird';
import _ from 'lodash';
import Ws from 'ws';

const closeCode = 1000;
const reconnectableStatus = 4000;
export const readyStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  RECONNECT_ABORTED: 4,
};

function createWebSocket(url, protocols) {
  const urlOk = /wss?:\/\//.exec(url);
  if (!urlOk) {
    throw new Error('Invalid url provided');
  }
  const Socket = Ws || window.WebSocket || window.MozWebSocket;
  return new Socket(url, protocols);
}

export default class WsClient {

  // PUBLIC /////////////////////////////////////
  constructor(url, protocols, options) {
    this.protocols = protocols;
    this.url = url;
    this.timeoutStart = options && options.timeoutStart || 300;
    this.timeoutMax = options && options.timeoutMax || 2 * 60 * 1000;
    this.reconnectIfNotNormalClose = options && options.reconnectIfNotNormalClose;

    this.isEncrypted = /(wss)/i.test(this.url);
    this.reconnectAttempts = 0;
    this.sendQueue = [];
    this.onOpenCallbacks = [];
    this.onMessageCallbacks = [];
    this.onErrorCallbacks = [];
    this.onCloseCallbacks = [];

    this.connect();
  }

  onOpen(cb) {
    this.onOpenCallbacks.push(cb);
    return this;
  }

  onClose(cb) {
    this.onCloseCallbacks.push(cb);
    return this;
  }

  onError(cb) {
    this.onErrorCallbacks.push(cb);
    return this;
  }

  onMessage(cb) {
    if (!_.isFunction(cb)) {
      throw new Error('Callback must be a function');
    }
    this.onMessageCallbacks.push({ fn: cb });
    return this;
  }

  send(message) {
    return new Promise((resolve, reject) => {
      if (this.readyState === readyStates.RECONNECT_ABORTED) {
        reject('Socket connection has been closed');
      } else {
        this.sendQueue.push({ message, resolve });
        this.fireQueue();
      }
    });
  }

  close(force) {
    if (force || !this.socket.bufferedAmount) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.socket.close();
    }
    return this;
  }

  reconnect() {
    this.close();
    const backoffDelay = this.getBackoffDelay(++this.reconnectAttempts);
    const backoffDelaySeconds = backoffDelay / 1000;
    console.log(`Reconnecting in ${backoffDelaySeconds} seconds`);
    this.reconnectTimer = setTimeout(::this.connect, backoffDelay);
    return this;
  }

  // /////////////////////////////////////////////

  connect(force) {
    if (force || !this.socket || this.socket.readyState !== readyStates.OPEN) {
      this.socket = createWebSocket(this.url, this.protocols);
      this.socket.onmessage = ::this.onMessageHandler;
      this.socket.onopen = ::this.onOpenHandler;
      this.socket.onerror = ::this.onErrorHandler;
      this.socket.onclose = ::this.onCloseHandler;
    }
    return this;
  }

  fireQueue() {
    while (this.sendQueue.length && this.socket.readyState === readyStates.OPEN) {
      const data = this.sendQueue.shift();
      this.socket.send(_.isString(data.message)
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
    this.onOpenCallbacks.forEach(cb => cb.call(this, event));
    // this.notifyOpenCallbacks(event);
    this.fireQueue();
  }

  onCloseHandler(event) {
    this.onCloseCallbacks.forEach(cb => cb.call(this, event));
    const notNormalReconnect = this.reconnectIfNotNormalClose && event.code !== closeCode;
    if (notNormalReconnect || event.code === reconnectableStatus) {
      this.reconnect();
    }
  }

  onErrorHandler(event) {
    this.onErrorCallbacks.forEach(cb => cb.call(this, event));
  }

  onMessageHandler(message) {
    this.onMessageCallbacks.forEach(cb => cb.fn(message));
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
