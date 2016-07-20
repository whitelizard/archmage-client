import { expect } from 'chai';
import WsClient from '../ws-client';
import { w3cwebsocket } from 'websocket';

let reply = '';
const ws = new WsClient('ws://echo.websocket.org', undefined, {
  customWsClient: w3cwebsocket,
});
ws.onMessage(msg => { console.log(msg.data); reply = msg.data; });
setTimeout(() => {
  ws.connect();
  ws.send('MSG1');
}, 500);
setTimeout(() => {
  expect(reply).to.equal('MSG1');
}, 1500);
