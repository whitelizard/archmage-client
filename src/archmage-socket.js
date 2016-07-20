import WsClient, { readyStates } from './ws-client';
import * as tiip from 'jstiip';
import Promise from 'bluebird';
import { Map, fromJS, Iterable } from 'immutable';

const defaults = Map({
  initTarget: 'TiipController',
  timeoutOnRequests: 30 * 1000,
  midMax: 10000,
  timeoutErrorMessage: 'Timeout',
});

export class ArchmageSocket {

  // ------ SETUP ------ //

  constructor(url, protocols, options = {}) {
    this.currentCallbackId = 0;
    this.reqCallbacks = Map();
    this.subCallbacks = Map();
    this.setOptions(options);

    this.ws = new WsClient(url, protocols, {
      reconnectIfNotNormalClose: true,
      ...options,
    });
    this.ws.onMessage(::this.onMessage);
  }

  // ------ INTERFACE IMPLEMENTATION ------ //

  connect(url, protocols, options = {}) {
    this.setOptions(options);
    this.ws.connect(url, protocols, {
      reconnectIfNotNormalClose: true,
      ...options,
    });
    return this;
  }

  setOptions(options) {
    this.sendCallback = options.onSend || this.sendCallback;
    this.sendFailCallback = options.onSendFail || this.sendFailCallback;
    this.receiveCallback = options.onReceive || this.receiveCallback;
    this.timeoutOnRequests = options.timeoutOnRequests || this.timeoutOnRequests;
  }

  init(userId, passwordHash, tenant, target, signal, source, extraArgs) {
    let args = Map({ id: userId, password: passwordHash });
    if (extraArgs) {
      args = args.merge(extraArgs);
    }
    return this.request(
      'init', target || defaults.get('initTarget'), signal, args, undefined, tenant, source
    );
  }

  kill(force) {
    this.reqCallbacks.forEach(reqObj => {
      clearTimeout(reqObj.get('timeoutPromise'));
    });
    return this.ws.close(force);
  }

  req(target, signal, args, payload, source, tenant) {
    return this.request('req', target, signal, args, payload, tenant, source);
  }

  sub(callback, signal, args, payload, target, source, tenant) {
    /**
    args: Map:{rid: <DataChannel rid>}
    The DataChannel rid as input is not the same as channel received in reply in payload.
    The first is the id against the GUI and the second agains the server.
    */
    return this.request(
      'sub', undefined, signal, args, payload, tenant, source
    ).then(tiipMsg => {
      if (tiipMsg.get('ok') && tiipMsg.get('payload')) {
        if (tiipMsg.get('payload').get(0)) {
          // Only support for subscription to one channel at a time
          this.subCallbacks = this.subCallbacks.set(tiipMsg.get('payload').get(0), Map({
            callback,
            rid: args.get('rid'),
          }));
        }
      }
      return tiipMsg;
    });
  }

  unsub(signal, args, payload, target, source, tenant) {
    let channelKey;
    this.subCallbacks.some(key => {
      if (args.get('rid') === this.subCallbacks.get(key).get('rid')) {
        channelKey = key;
        this.subCallbacks = this.subCallbacks.delete(key);
        return true; // exit loop
      }
      return false;
    }, this);
    if (channelKey) {
      return this.send('unsub',
        undefined, signal, args, payload, tenant, source
      );
    }
    return Promise.resolve();
  }

  pub(signal, payload, target, source, args, tenant) {
    return this.send('pub',
      undefined, signal, args, payload, tenant, source
    );
  }

  isOpen() {
    return this.ws.socket.readyState === readyStates.get('OPEN');
  }

  send(type, target, signal, args, payload, tenant, source, ok) {
    const tiipMsg = tiip.pack(
      type, target, signal,
      Iterable.isIterable(args) ? args.toJS() : args,
      Iterable.isIterable(payload) ? payload.toJS() : payload,
      undefined, tenant,
      Iterable.isIterable(source) ? source.toJS() : source,
      undefined, ok
    );
    return this.sendRaw(tiipMsg);
  }

  sendObj(msgObj) {
    return this.sendRaw(tiip.packObj(msgObj.toJS()));
  }

  sendRaw(text) {
    console.log('Sending: ', text);
    return this.ws.send(text)
      .then(() => {
        if (this.sendCallback) this.sendCallback(text);
      })
      .catch((reason) => {
        if (this.sendFailCallback) this.sendFailCallback(reason);
        return reason;
      });
  }

  request(type, target, signal, args, payload, tenant, source) {
    let msg = Map({ type });
    if (target !== undefined) msg = msg.set('target', target);
    if (signal !== undefined) msg = msg.set('signal', signal);
    if (args !== undefined) msg = msg.set('arguments', fromJS(args));
    if (payload !== undefined) msg = msg.set('payload', fromJS(payload));
    if (tenant !== undefined) msg = msg.set('tenant', tenant);
    if (source !== undefined) msg = msg.set('source', fromJS(source));
    return this.requestObj(msg);
  }

  requestObj(msgObj) {
    const callbackId = this.newCallbackId();
    const msgObjToSend = msgObj.set('mid', callbackId);

    return new Promise((resolve, reject) => {
      this.sendObj(msgObjToSend)
        .then(() => {
          this.reqCallbacks = this.reqCallbacks.set(callbackId, fromJS({
            time: new Date(),
            resolve,
            timeoutPromise: setTimeout(() => {
              if (this.reqCallbacks.has(callbackId)) {
                this.reqCallbacks = this.reqCallbacks.delete(callbackId);
                reject(defaults.get('timeoutErrorMessage'));
              }
            }, this.timeoutOnRequests || defaults.get('timeoutOnRequests')),
          }));
        })
        .catch((reason) => reject(reason));
    });
  }

  // ------ PRIVATE METHODS ------ //

  newCallbackId() {
    this.currentCallbackId += 1;
    if (this.currentCallbackId > defaults.get('midMax')) {
      this.currentCallbackId = 0;
    }
    return String(this.currentCallbackId);
  }

  onMessage(msg) {
    let msgObj;
    let isTiip = true;
    let errorReason = '';

    try {
      msgObj = fromJS(tiip.unpack(msg.data));
      // console.log('Msg received: ', msgObj);
    } catch (err) {
      isTiip = false; // non-tiip messge
      // console.log('Msg received: ', msg.data);
    }

    if (isTiip) {
      switch (msgObj.get('type')) {
        case 'rep': {
          // If an object exists with msgObj.mid in reqCallbacks, resolve it
          if (this.reqCallbacks.has(msgObj.get('mid'))) {
            const reqCallbackObj = this.reqCallbacks.get(msgObj.get('mid'));
            clearTimeout(reqCallbackObj.get('timeoutPromise'));
            reqCallbackObj.get('resolve')(msgObj);
            this.reqCallbacks = this.reqCallbacks.delete(msgObj.get('mid'));
          } else {
            errorReason = 'No request matched server reply';
          }
          break;
        }
        case 'pub': {
          if (!this.subCallbacks.forEach(key => {
            // There could be a subchannel, cut the channel
            if (key === msgObj.get('source').get(0).substring(0, key.length)) {
              // If an object exists in subCallbacks, invoke its cb
              const subCallbackObj = this.subCallbacks.get(key);
              if (subCallbackObj.get('callback')) {
                subCallbackObj.get('callback')(fromJS({
                  timestamp: msgObj.get('timestamp'),
                  source: msgObj.get('source'),
                  signal: msgObj.get('signal'),
                  payload: msgObj.get('payload'),
                }));
              }
              return true; // exit loop
            }
            return false;
          })) {
            // No key found
            errorReason = 'No subscription for publication from server';
          }
          break;
        }
        default: {
          errorReason = 'Unknown message type';
        }
      }
    }
    if (this.receiveCallback) {
      if (isTiip) {
        this.receiveCallback(msgObj, errorReason || false, msgObj.get('type'));
      } else {
        this.receiveCallback(msg.data);
      }
    }
  }
}
