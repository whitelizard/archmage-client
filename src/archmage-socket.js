import WsClient, { readyStates } from './ws-client';
import * as tiip from 'jstiip';
import Promise from 'bluebird';
import { Map, fromJS, Iterable, OrderedSet } from 'immutable';

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

  init(userId, passwordHash, tenant, target, signal, args) {
    let argumentz = Map({ id: userId, password: passwordHash });
    if (args) {
      argumentz = args.merge(argumentz);
    }
    return this.request(
      'init', target || defaults.get('initTarget'), signal, argumentz, undefined, tenant
    );
  }

  kill(force) {
    this.reqCallbacks.forEach(reqObj => {
      clearTimeout(reqObj.get('timeoutPromise'));
    });
    return this.ws.close(force);
  }

  req(target, signal, args, tenant) {
    return this.request('req', target, signal, args, undefined, tenant);
  }

  sub(callback, channel, subChannel, target, tenant, args) {
    /**
    args: Map:{rid: <DataChannel rid>}
    The DataChannel rid as input is not the same as channel received in reply in payload.
    The first is the id against the GUI and the second agains the server.

    channel, subChannel, target, tenant is the address to use as (secondary) key
    */
    const secondaryKey = OrderedSet.of(channel, subChannel, target, tenant);
    let argumentz = Map({ subChannel });
    if (args) argumentz = args.merge(argumentz);

    return this.request(
      'sub', target, undefined, argumentz, undefined, tenant, undefined, channel
    ).then(tiipMsg => {
      if (tiipMsg.get('ok') && tiipMsg.has('channel')) {
        // Only support for subscription to one channel at a time
        this.subCallbacks = this.subCallbacks.set(tiipMsg.get('channel'), Map({
          callback,
          key: secondaryKey,
        }));
      }
      return tiipMsg;
    });
  }

  unsub(channel, subChannel, target, tenant, args) {
    const secondaryKey = OrderedSet.of(channel, subChannel, target, tenant);
    let fullChannel;
    this.subCallbacks.some(ch => {
      if (secondaryKey === this.subCallbacks.getIn([ch, 'key'])) {
        fullChannel = ch;
        this.subCallbacks = this.subCallbacks.delete(ch);
        return true; // exit loop
      }
      return false;
    }, this);
    if (fullChannel) {
      return this.send('unsub',
        undefined, undefined, args, undefined, undefined, undefined, channel
      );
    }
    return Promise.resolve();
  }

  pub(payload, channel, subChannel, signal, source, tenant, args) {
    let argumentz = Map({ subChannel });
    if (args) argumentz = args.merge(argumentz);
    return this.send('pub',
      undefined, signal, argumentz, payload, tenant, source, channel
    );
  }

  isOpen() {
    return this.ws.socket.readyState === readyStates.get('OPEN');
  }

  send(type, target, signal, args, payload, tenant, source, channel) {
    const tiipMsg = tiip.pack(
      type, target, signal,
      Iterable.isIterable(args) ? args.toJS() : args,
      Iterable.isIterable(payload) ? payload.toJS() : payload,
      undefined, tenant,
      Iterable.isIterable(source) ? source.toJS() : source,
      channel
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

  request(type, target, signal, args, payload, tenant, source, channel) {
    let msg = Map({ type });
    if (target !== undefined) msg = msg.set('target', target);
    if (signal !== undefined) msg = msg.set('signal', signal);
    if (args !== undefined) msg = msg.set('arguments', fromJS(args));
    if (payload !== undefined) msg = msg.set('payload', fromJS(payload));
    if (tenant !== undefined) msg = msg.set('tenant', tenant);
    if (source !== undefined) msg = msg.set('source', fromJS(source));
    if (channel !== undefined) msg = msg.set('channel', channel);
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
            const channel = msgObj.get('channel');
            if (key === channel.substring(0, key.length)) {
              // If an object exists in subCallbacks, invoke its cb
              const subCallbackObj = this.subCallbacks.get(key);
              if (subCallbackObj.get('callback')) {
                subCallbackObj.get('callback')(
                  msgObj.filter((v, field) =>
                    Set.of('timestamp', 'source', 'signal', 'payload').has(field))
                );
              }
            }
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
