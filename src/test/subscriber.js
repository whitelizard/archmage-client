import Archmage from '../archmage-session';
import { w3cwebsocket } from 'websocket';

const arch = new Archmage('ws://iim2m.com/wsh', undefined, {
  customWsClient: w3cwebsocket,
});

function gotData(msgObj) {
  console.log('Got: ', msgObj.toJS());
}

arch.auth('demo@tieto.com', 'demo', 'websensordemo')
  .then(() => arch.socket.sub(gotData, '#17:0'));
