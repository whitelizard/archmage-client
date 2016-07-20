import { expect } from 'chai';
import Archmage from '../archmage-session';
import { w3cwebsocket } from 'websocket';

const arch = new Archmage('ws://echo.websocket.org', undefined, {
  customWsClient: w3cwebsocket,
});
