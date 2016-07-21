import Archmage from '../archmage-session';
import { w3cwebsocket } from 'websocket';

const arch = new Archmage('ws://iim2m.com/wsh', undefined, {
  customWsClient: w3cwebsocket,
});

arch.auth('webdip@tieto.com', 'fourwordsalluppercase', 'websensordemo')
  .then(() => arch.socket.pub(['123'], '#17:0', undefined, 'online'));
