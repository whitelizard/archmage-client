# archmage-client
Socket and session classes for connecting to an ARCHMAGE server.

```
npm install --save archmage-client
```

The **socket** object contains the different types of calls available in the Archmage API. The **session** object is a layer on top of the auth type call and handles credentials, password hashing, relogin etc. A *session* object always has a *socket* object inside (Note how the different calls look, below).

```
import ArchmageSession from 'archmage-client';
const session = new ArchmageSession('wss://echo.websocket.org');
```

### ```session.init();```
Authenticates with possible cached credentials, otherwise rejects.

### ```session.auth(userId, password, tenant, target, signal, args);```
Authenticates (sends an init message) towards the archmage server.
-	**userId:** Id for the identity attempting to login (needs to exist in the database).
-	**password:** The password of the identity above.
-	**tenant:** The tenant to login to (undefined for root tenant).
-	**target:** The target controller class name (leave undefined for default ‘TiipController’).
-	**signal:** Not used right now, reserved for future use.
-	**args:** Not used right now, reserved for future use.

### ```session.socket.req(target, signal, args, tenant);```
Performs a request towards the archmage server.
-	**target:** The target InterfaceModule to receive the request. To query the configuration (IMConf) use ‘conf’.
-	**signal:** The APIFunction to call. Example: ‘readUser’.
-	**args:** (optional) An object with arguments for that particular APIFunction (signal). Example: {"rids": ["#30:0"]}
-	**tenant:** Not used right now, reserved for future use.

### ```session.socket.sub(callback, channel, subChannel, target, tenant, args);```
Starts a subscription to a DataChannel in the archmage server.
-	**callback:** The callback function to run when a message arrives on the subscribed channel.
-	**channel:** ID (rid) of the DataChannel to subscribe to.
-	**subChannel:** Optional sub-channel within the channel.
- **target:** Not used now.
- **tenant:** Not used right now, reserved for future use.
-	**args:** Possible additional arguments.

### ```session.socket.unsub(channel, subChannel, target, tenant, args);```
Stops a subscription to a DataChannel in the archmage server.
-	**channel:** Channel corresponding to an earlier sub call (see sub above).
-	**subChannel:** Sub channel corresponding to an earlier sub call (see sub above).
-	**target:** Target corresponding to an earlier sub call (see sub above).
-	**tenant:** Tenant corresponding to an earlier sub call (see sub above).
-	**args:** Possible additional arguments.

### ```session.socket.pub(payload, channel, subChannel, signal, source, tenant, args);```
Publishes data on a DataChannel in the archmage server.
-	**payload:** Values to publish, as array.
-	**channel:** Channel ID (rid) to publish on.
-	**subChannel:** Optional sub channel inside channel.
-	**signal:** Optional custom signal.
-	**source:** Optional array of IDs describing the source of the data.
-	**tenant:** Not used right now, reserved for future use.
-	**args:** Possible additional arguments.

### ```session.logout();```
Log out the session and kill the connection. Cached credentials will be erased.
