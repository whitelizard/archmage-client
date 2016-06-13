import WsClient, { readyStates } from './ws-client';
import * as tiip from 'jstiip';
import Promise from 'bluebird';

const defaults = {
  initPid: 'tiip_controller',
  busAPIName: 'xibus',
  timeoutOnRequests: 30 * 1000,
  midMax: 10000,
  timeoutErrorMessage: 'Timeout',
};

export class ArchmageSocket {

  // ------ SETUP ------ //

  constructor(url, protocols, options) {
    const {
      onSend,
      onSendFail,
      onReceive,
      busAPIName,
      timeoutOnRequests,
      ...rest,
    } = options;

    this.sendCallback = onSend;
    this.sendFailCallback = onSendFail;
    this.receiveCallback = onReceive;
    this.busAPIName = busAPIName;
    this.timeoutOnRequests = timeoutOnRequests;

    this.currentCallbackId = 0;
    this.reqCallbacks = {};
    this.subCallbacks = {};

    const wsClientOptions = { ...rest };
    wsClientOptions.reconnectIfNotNormalClose = true;
    this.ws = new WsClient(url, protocols, wsClientOptions);
    this.ws.onMessage(::this.onMessage);
  }

  // ------ INTERFACE IMPLEMENTATION ------ //

  init(userId, passwordHash, tenant, pid, signal, source, payloadExtra) {
    let payload = [userId, passwordHash];
    if (payloadExtra) {
      payload = payload.concat(payloadExtra);
    }
    return this.request(
      'init', pid || defaults.initPid, signal, undefined, payload, tenant, source
    );
  }

  kill(force) {
    return this.ws.close(force);
  }

  req(pid, signal, args, payload, source) {
    return this.request('req', pid, signal, args, payload, undefined, source);
  }

  sub(callback, signal, args, payload, pid, source) {
    /**
    args: {rid: <DataChannel rid>}
    The DataChannel rid as input is not the same as channel received in reply in payload.
    The first is the id against the GUI and the second agains the server.
    */

    return this.request(
      'sub', pid || this.busAPIName || defaults.busAPIName, signal, args, payload, undefined, source
    ).then(tiipMsg => {
      if (tiipMsg.ok && tiipMsg.payload) {
        if (tiipMsg.payload[0]) {
          // Only support for subscription to one channel at a time
          this.subCallbacks[tiipMsg.payload[0]] = {
            callback,
            rid: args.rid,
          };
        }
      }
      return tiipMsg;
    });
  }

  unsub(signal, args, payload, pid, source) {
    let channelKey;
    Object.keys(this.subCallbacks).some(key => {
      if (args.rid === this.subCallbacks[key].rid) {
        channelKey = key;
        delete this.subCallbacks[key];
        return true; // exit loop
      }
      return false;
    }, this);
    if (channelKey) {
      return this.send('unsub',
        pid || this.busAPIName || defaults.busAPIName, signal, args, payload, undefined, source
      );
    }
    return Promise.resolve();
  }

  pub(signal, payload, pid, source, args) {
    return this.send('pub',
      pid || this.busAPIName || defaults.busAPIName, signal, args, payload, undefined, source
    );
  }

  isOpen() {
    return this.ws.socket.readyState === readyStates.OPEN;
  }

  send(type, pid, signal, args, payload, tenant, source, ok) {
    const tiipMsg = tiip.pack(
      type, pid, signal, args, payload, undefined, tenant, source, undefined, ok
    );
    return this.sendRaw(tiipMsg);
  }

  sendObj(msgObj) {
    return this.sendRaw(tiip.packObj(msgObj));
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

  request(type, pid, signal, args, payload, tenant, source) {
    const msg = { type };
    if (pid !== undefined && pid !== null) msg.pid = pid;
    if (signal !== undefined && signal !== null) msg.signal = signal;
    if (args !== undefined && args !== null) msg.arguments = args;
    if (payload !== undefined && payload !== null) msg.payload = payload;
    if (tenant !== undefined && tenant !== null) msg.tenant = tenant;
    if (source !== undefined && source !== null) msg.source = source;
    return this.requestObj(msg);
  }

  requestObj(msgObj) {
    const callbackId = this.newCallbackId();
    const msgObjToSend = msgObj;
    msgObjToSend.mid = callbackId;

    return new Promise((resolve, reject) => {
      this.sendObj(msgObj)
        .then(() => {
          this.reqCallbacks[callbackId] = {
            time: new Date(),
            resolve,
            timeoutPromise: setTimeout(() => {
              if (this.reqCallbacks.hasOwnProperty(callbackId)) {
                delete this.reqCallbacks[callbackId];
                reject(defaults.timeoutErrorMessage);
              }
            }, this.timeoutOnRequests || defaults.timeoutOnRequests),
          };
        })
        .catch((reason) => reject(reason));
    });
  }

  // ------ PRIVATE METHODS ------ //

  newCallbackId() {
    this.currentCallbackId += 1;
    if (this.currentCallbackId > TSPSocket.defaults.midMax) {
      this.currentCallbackId = 0;
    }
    return String(this.currentCallbackId);
  }

  onMessage(msg) {
    let msgObj;
    let isTiip = true;
    let tiipHandling = true;

    try {
      msgObj = tiip.unpack(msg.data);
      // console.log('Msg received: ', msgObj);
    } catch (err) {
      isTiip = false;  // non-tiip messge
      // console.log('Msg received: ', msg.data);
    }

    if (isTiip) {
      switch (msgObj.type) {
        case 'rep':
          // If an object exists with msgObj.mid in reqCallbacks, resolve it
          if (this.reqCallbacks.hasOwnProperty(msgObj.mid)) {
            const reqCallbackObj = this.reqCallbacks[msgObj.mid];
            clearTimeout(reqCallbackObj.timeoutPromise);
            reqCallbackObj.resolve(msgObj);
            delete this.reqCallbacks[msgObj.mid];
          } else {
            tiipHandling = false;
          }
          break;
        case 'pub':
          let pubKey;
          Object.keys(this.subCallbacks).some(key => {
            // There could be a subchannel, cut the channel
            if (key === msgObj.source[0].substring(0, key.length)) {
              pubKey = key;
              return true; // exit loop
            }
            return false;
          });
          if (pubKey) { // If an object exists in subCallbacks, invoke its cb
            const subCallbackObj = this.subCallbacks[pubKey];
            if (subCallbackObj.callback) {
              subCallbackObj.callback({
                timestamp: msgObj.timestamp,
                source: msgObj.source,
                signal: msgObj.signal,
                payload: msgObj.payload,
              });
            }
          } else {
            tiipHandling = false;
          }
          break;
        default:
          tiipHandling = false;
      }
    }
    if (this.receiveCallback) {
      this.receiveCallback(msg.data, tiipHandling, isTiip && msgObj.type);
    }
  }
}
