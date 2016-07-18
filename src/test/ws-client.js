import { expect } from 'chai';
import WsClient from '../ws-client';

const ws = new WsClient('ws://echo.websocket.org');
let reply = '';
ws.onOpen(event => { console.log(event); reply = 'OPEN'; });
ws.connect();
expect(reply).to.equal('OPEN');
