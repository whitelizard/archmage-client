import Promise from 'bluebird';
import _ from 'underscore';
import Ws from 'ws';

const objectFreeze  = (Object.freeze) ? Object.freeze : ()=>undefined;
const objectDefineProperty = Object.defineProperty;
const arraySlice = Array.prototype.slice;

export function getDefer() {
    let resolve, reject;
    const promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

function createWebSocket(url, protocols) {
  const match = /wss?:\/\//.exec(url);
  if (!match) {
    throw new Error('Invalid url provided');
  }

  const Socket = Ws || window.WebSocket || window.MozWebSocket;

  if (protocols) return new Socket(url, protocols);
  return new Socket(url);
}

export default class WsClient {

  constructor(url, protocols, options) {
    if (!options && _.isObject(protocols) && !_.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }

    this.protocols = protocols;
    this.url = url || 'Missing URL';
    this.ssl = /(wss)/i.test(this.url);

    // TODO: refactor options to use isDefined
    this.rootScopeFailover          = options && options.rootScopeFailover          && true;
    this.useApplyAsync              = options && options.useApplyAsync              || false;
    this.initialTimeout             = options && options.initialTimeout             || 300;
    this.maxTimeout                 = options && options.maxTimeout                 || 2 * 60 * 1000;
    this.reconnectIfNotNormalClose  = options && options.reconnectIfNotNormalClose  || false;

    this._reconnectAttempts = 0;
    this.sendQueue          = [];
    this.onOpenCallbacks    = [];
    this.onMessageCallbacks = [];
    this.onErrorCallbacks   = [];
    this.onCloseCallbacks   = [];
    this.reconnectTimer;

    // objectFreeze(this._readyStateConstants);

    if (url) {
      this._connect();
    } else {
      this._setInternalState(0);
    }
  }

  _connect(force) {
    if (force || !this.socket || this.socket.readyState !== WsClient._readyStateConstants.OPEN) {
      this.socket = createWebSocket(this.url, this.protocols);
      this.socket.onmessage = this._onMessageHandler.bind(this);
      this.socket.onopen  = this._onOpenHandler.bind(this);
      this.socket.onerror = this._onErrorHandler.bind(this);
      this.socket.onclose = this._onCloseHandler.bind(this);
    }
  }

  fireQueue() {
    while (this.sendQueue.length && this.socket.readyState === WsClient._readyStateConstants.OPEN) {
      const data = this.sendQueue.shift();

      this.socket.send(
        _.isString(data.message) ? data.message : JSON.stringify(data.message)
      );
      data.deferred.resolve();
    }
  }

  notifyOpenCallbacks(event) {
    for (let i = 0, len = this.onOpenCallbacks.length; i < len; ++i) {
      this.onOpenCallbacks[i].call(this, event);
    }
  }

  notifyCloseCallbacks(event) {
    for (let i = 0, len = this.onCloseCallbacks.length; i < len; ++i) {
      this.onCloseCallbacks[i].call(this, event);
    }
  }

  notifyErrorCallbacks(event) {
    for (let i = 0, len = this.onErrorCallbacks.length; i < len; ++i) {
      this.onErrorCallbacks[i].call(this, event);
    }
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

  onMessage(callback) {
    if (!_.isFunction(callback)) {
      throw new Error('Callback must be a function');
    }

    this.onMessageCallbacks.push({
      fn: callback
    });
    return this;
  }

  _onOpenHandler(event) {
    this._reconnectAttempts = 0;
    this.notifyOpenCallbacks(event);
    this.fireQueue();
  }

  _onCloseHandler(event) {
    this.notifyCloseCallbacks(event);
    if ((this.reconnectIfNotNormalClose && event.code !== WsClient._normalCloseCode) || WsClient._reconnectableStatusCodes.indexOf(event.code) > -1) {
      this.reconnect();
    }
  }

  _onErrorHandler(event) {
    this.notifyErrorCallbacks(event);
  }

  _onMessageHandler(message) {
    let pattern;
    let self = this;
    let currentCallback;
    for (let i = 0, len = this.onMessageCallbacks.length; i < len; ++i) {
      this.onMessageCallbacks[i].fn(message);
    }
  }

  close(force) {
    if (force || !this.socket.bufferedAmount) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.socket.close();
    }
    return this;
  }

  send____(data) {
    let self = this;
    let promise = new Promise(function (resolve, reject) {

      if (self.readyState === WsClient._readyStateConstants.RECONNECT_ABORTED) {
        reject('Socket connection has been closed');
      }
      else {
        self.sendQueue.push({
          message: data,
          deferred: promise
        });
        self.fireQueue();
      }

    });
    return promise;
  }

  send(data) {
    let deferred = getDefer();
    const self = this;
    let promise = cancelableify(deferred.promise);

    if (this.readyState === WsClient._readyStateConstants.RECONNECT_ABORTED) {
      deferred.reject('Socket connection has been closed');
    }
    else {
      this.sendQueue.push({
        message: data,
        deferred: deferred
      });
      this.fireQueue();
    }

    // Credit goes to @btford
    function cancelableify(promise) {
      promise.cancel = cancel;
      let then = promise.then;
      promise.then = function() {
        let newPromise = then.apply(this, arguments);
        return cancelableify(newPromise);
      };
      return promise;
    }

    function cancel(reason) {
      self.sendQueue.splice(self.sendQueue.indexOf(data), 1);
      deferred.reject(reason);
      return self;
    }

    return promise;
  }

  reconnect() {
    this.close();

    const backoffDelay = this._getBackoffDelay(++this._reconnectAttempts);

    const backoffDelaySeconds = backoffDelay / 1000;
    console.log('Reconnecting in ' + backoffDelaySeconds + ' seconds');

    this.reconnectTimer = setTimeout(this._connect.bind(this), backoffDelay);

    return this;
  }
  // Exponential Backoff Formula by Prof. Douglas Thain
  // http://dthain.blogspot.co.uk/2009/02/exponential-backoff-in-distributed.html
  _getBackoffDelay(attempt) {
    const R = Math.random() + 1;
    const T = this.initialTimeout;
    const F = 2;
    const N = attempt;
    const M = this.maxTimeout;

    return Math.floor(Math.min(R * T * Math.pow(F, N), M));
  }

  _setInternalState(state) {
    if (Math.floor(state) !== state || state < 0 || state > 4) {
      throw new Error('state must be an integer between 0 and 4, got: ' + state);
    }

    this._internalConnectionState = state;

    _.forEach(this.sendQueue, pending => pending.deferred.reject('Message cancelled due to closed socket connection'));
  }
}

WsClient._readyStateConstants = {
  'CONNECTING': 0,
  'OPEN': 1,
  'CLOSING': 2,
  'CLOSED': 3,
  'RECONNECT_ABORTED': 4
};

WsClient._normalCloseCode = 1000;

WsClient._reconnectableStatusCodes = [
  4000
];
