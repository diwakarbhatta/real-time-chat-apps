process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-suite-secure-jwt-signing-secret-key-32-bytes';

const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { app, server, io } = require('./backend/server');

const TEST_PORT = 5001;

async function runTests() {
  console.log('--- Starting Real-Time Chat App End-to-End Tests ---');

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`Server listening on test port ${TEST_PORT}`);

  const baseUrl = `http://localhost:${TEST_PORT}`;

  // Socket handles hoisted so the finally block can clean them up
  let unauthSocket, clientSocket, dmSocket, userASocket;

  try {
    // 1. Test Static files
    console.log('\n[1] Testing Static Asset Serving...');
    const indexRes = await fetch(`${baseUrl}/`);
    if (indexRes.status !== 200) throw new Error(`Failed to load index.html: ${indexRes.status}`);
    const indexHtml = await indexRes.text();
    if (!indexHtml.includes('Pulse Chat')) throw new Error('index.html missing brand title');
    console.log('✓ Index page served successfully');

    const chatRes = await fetch(`${baseUrl}/chat.html`);
    if (chatRes.status !== 200) throw new Error(`Failed to load chat.html: ${chatRes.status}`);
    const chatHtml = await chatRes.text();
    if (!chatHtml.includes('# general-chat')) throw new Error('chat.html missing channel header');
    console.log('✓ Chat page served successfully');

    // 2. Test Registration API
    console.log('\n[2] Testing Authentication API...');
    const testUsername = `user_${Date.now()}`;
    const testEmail = `${testUsername}@example.com`;
    const testPassword = 'Password123!';

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        email: testEmail,
        password: testPassword,
      }),
    });

    const regData = await regRes.json();
    if (regRes.status !== 201 || !regData.token) {
      throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
    }
    console.log(`✓ Registration succeeded for ${regData.user.username}`);

    // 3. Test Duplicate Registration (should fail with 409)
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        email: testEmail,
        password: testPassword,
      }),
    });
    if (dupRes.status !== 409) {
      throw new Error(`Expected duplicate registration to return 409, got ${dupRes.status}`);
    }
    console.log('✓ Duplicate registration correctly rejected with 409');

    // 3b. Test Concurrent Registration Race Condition
    const raceUsername = `race_${Date.now()}`;
    const [raceA, raceB] = await Promise.all([
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: raceUsername,
          email: `${raceUsername}_a@example.com`,
          password: testPassword,
        }),
      }),
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: raceUsername,
          email: `${raceUsername}_b@example.com`,
          password: testPassword,
        }),
      }),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    if (raceStatuses[0] !== 201 || raceStatuses[1] !== 409) {
      throw new Error(`Expected concurrent registrations to yield [201, 409], got [${raceStatuses.join(', ')}]`);
    }
    console.log('✓ Concurrent registration race condition handled cleanly with 409');

    // 4. Test Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: testPassword,
      }),
    });
    const loginData = await loginRes.json();
    if (loginRes.status !== 200 || !loginData.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✓ Login with email succeeded');

    // 5. Test /api/auth/me
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const meData = await meRes.json();
    if (meRes.status !== 200 || meData.user.username !== testUsername) {
      throw new Error(`Me endpoint failed: ${JSON.stringify(meData)}`);
    }
    console.log('✓ /api/auth/me verified authenticated user');

    // 6. Test Socket.IO Real-time messaging
    console.log('\n[3] Testing Real-Time WebSockets...');

    // Verify unauthenticated and null join is rejected
    unauthSocket = ioClient(baseUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Unauth test timed out')), 4000);
      let nullTested = false;
      unauthSocket.on('connect', () => {
        unauthSocket.emit('join', null);
      });
      unauthSocket.on('auth-error', () => {
        if (!nullTested) {
          nullTested = true;
          unauthSocket.emit('join', { username: 'Imposter' });
        } else {
          console.log('✓ Null and unauthenticated socket joins correctly rejected with auth-error');
          clearTimeout(timeout);
          unauthSocket.disconnect();
          resolve();
        }
      });
    });

    clientSocket = ioClient(baseUrl, {
      auth: { token: loginData.token },
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);

      clientSocket.on('connect', () => {
        console.log('✓ Socket.IO client connected with ID:', clientSocket.id);
        clientSocket.emit('join', {
          token: loginData.token,
          status: 'Online',
        });
      });

      let joinedReceived = false;
      clientSocket.on('users', (users) => {
        const found = users.some((u) => u.username === testUsername);
        if (found && !joinedReceived) {
          joinedReceived = true;
          console.log(`✓ Active users broadcast received with ${users.length} user(s)`);

          // Send a chat message with acknowledgement
          clientSocket.emit('chat-message', 'Hello, this is a real-time test message!', (ack) => {
            if (!ack || !ack.success) throw new Error('Message send acknowledgement failed');
            console.log('✓ Server acknowledgement received for sent message');
          });
        }
      });

      clientSocket.on('chat-message', (msg) => {
        if (msg.text === 'Hello, this is a real-time test message!') {
          console.log('✓ Real-time message broadcast received:', msg);
          clearTimeout(timeout);
          clientSocket.disconnect();
          resolve();
        }
      });
    });

    // 6b. Test overlong message rejection (MAX_MESSAGE_LENGTH = 2000)
    const overlongSocket = ioClient(baseUrl, {
      auth: { token: loginData.token },
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Overlong message test timed out')), 5000);
      overlongSocket.on('connect', () => {
        overlongSocket.emit('join', { token: loginData.token, status: 'Online' });
      });
      overlongSocket.on('users', () => {
        overlongSocket.emit('chat-message', 'A'.repeat(2001), (ack) => {
          clearTimeout(timeout);
          overlongSocket.disconnect();
          if (ack && ack.success === false && /exceeds/i.test(ack.error)) {
            resolve();
          } else {
            reject(new Error(`Expected overlong message rejection, got: ${JSON.stringify(ack)}`));
          }
        });
      });
    });
    console.log('✓ Message exceeding 2000 chars correctly rejected by server');

    // 7. Verify Message Persistence in SQLite
    console.log('\n[4] Testing Database Persistence...');
    const messagesRes = await fetch(`${baseUrl}/api/messages`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const messagesData = await messagesRes.json();
    const persisted = messagesData.messages.some((m) => m.text === 'Hello, this is a real-time test message!');
    if (!persisted) {
      throw new Error('Message was not persisted to SQLite database!');
    }
    console.log('✓ Message verified in SQLite persistent storage');

    // 8. Test Private 1-to-1 Direct Messages
    console.log('\n[5] Testing Private Direct Messages...');

    // Register a second user
    const dmUsername = `dmuser_${Date.now()}`;
    const dmRegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: dmUsername,
        email: `${dmUsername}@example.com`,
        password: testPassword,
      }),
    });
    const dmRegData = await dmRegRes.json();
    if (dmRegRes.status !== 201 || !dmRegData.token) {
      throw new Error(`Second user registration failed: ${JSON.stringify(dmRegData)}`);
    }
    console.log(`✓ Second user registered: ${dmRegData.user.username}`);

    dmSocket = ioClient(baseUrl, {
      auth: { token: dmRegData.token },
    });

    const dmUser = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DM socket join timed out')), 5000);
      dmSocket.on('connect', () => {
        dmSocket.emit('join', { token: dmRegData.token, status: 'Online' });
      });
      dmSocket.on('users', (users) => {
        const found = users.some((u) => u.username === dmUsername);
        if (found) {
          clearTimeout(timeout);
          resolve(users.find((u) => u.username === dmUsername));
        }
      });
    });
    console.log(`✓ Second user joined workspace (userId: ${dmUser.userId})`);

    // DMs must not be sent to yourself
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Self-DM rejection test timed out')), 4000);
      dmSocket.emit('direct-message', { to: dmUser.userId, text: 'talking to myself' }, (ack) => {
        clearTimeout(timeout);
        if (ack && ack.success === false && /yourself/i.test(ack.error)) {
          resolve();
        } else {
          reject(new Error(`Expected self-DM rejection, got: ${JSON.stringify(ack)}`));
        }
      });
    });
    console.log('✓ Self-directed DM correctly rejected');

    // DMs to unknown users must be rejected
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Unknown recipient test timed out')), 4000);
      dmSocket.emit('direct-message', { to: 999999, text: 'hello?' }, (ack) => {
        clearTimeout(timeout);
        if (ack && ack.success === false && /Recipient not found/i.test(ack.error)) {
          resolve();
        } else {
          reject(new Error(`Expected recipient-not-found error, got: ${JSON.stringify(ack)}`));
        }
      });
    });
    console.log('✓ DM to unknown recipient correctly rejected');

    // Unauthenticated sockets cannot send DMs
    let unauthSocket2;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Unauth DM test timed out')), 4000);
      unauthSocket2 = ioClient(baseUrl);
      unauthSocket2.on('connect', () => {
        unauthSocket2.emit('direct-message', { to: 1, text: 'sneaky' }, (ack) => {
          clearTimeout(timeout);
          if (ack && ack.success === false) {
            resolve();
          } else {
            reject(new Error(`Expected unauthenticated DM rejection, got: ${JSON.stringify(ack)}`));
          }
        });
      });
    });
    unauthSocket2.disconnect();
    console.log('✓ Unauthenticated DM correctly rejected');

    // Reconnect user A (the earlier socket was disconnected after the room test)
    userASocket = ioClient(baseUrl, {
      auth: { token: loginData.token },
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('User A reconnect timed out')), 5000);
      userASocket.on('connect', () => {
        userASocket.emit('join', { token: loginData.token, status: 'Online' });
      });
      userASocket.on('users', (users) => {
        if (users.some((u) => u.username === testUsername)) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Send a real DM from user A to user B (dmSocket's user)
    const dmText = `Psst, this is a secret DM at ${Date.now()}`;
    const dmReceived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DM delivery timed out')), 5000);
      dmSocket.on('direct-message', (msg) => {
        if (msg.text === dmText) {
          clearTimeout(timeout);
          resolve(msg);
        }
      });
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DM send acknowledgement timed out')), 5000);
      userASocket.emit('direct-message', { to: dmUser.userId, text: dmText }, (ack) => {
        clearTimeout(timeout);
        if (!ack || !ack.success) {
          reject(new Error(`DM send failed: ${JSON.stringify(ack)}`));
        } else {
          resolve();
        }
      });
    });
    const deliveredMsg = await dmReceived;
    if (deliveredMsg.username !== testUsername) {
      throw new Error(`DM sender identity wrong: ${JSON.stringify(deliveredMsg)}`);
    }
    console.log('✓ Direct message delivered privately to recipient');

    // DM history must be retrievable via REST, and excluded from room history
    const dmHistoryRes = await fetch(`${baseUrl}/api/messages?peer=${dmUser.userId}`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const dmHistory = await dmHistoryRes.json();
    const inDmHistory = (dmHistory.messages || []).some((m) => m.text === dmText);
    if (dmHistoryRes.status !== 200 || !inDmHistory) {
      throw new Error(`DM not found in private history: ${JSON.stringify(dmHistory)}`);
    }
    console.log('✓ Private conversation history retrievable via GET /api/messages?peer=');

    const roomHistoryRes = await fetch(`${baseUrl}/api/messages`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const roomHistory = await roomHistoryRes.json();
    const leakedToRoom = (roomHistory.messages || []).some((m) => m.text === dmText);
    if (leakedToRoom) {
      throw new Error('Private DM leaked into the general room history!');
    }
    console.log('✓ DM correctly hidden from the general room history');

    dmSocket.disconnect();

    console.log('\n========================================');
    console.log(' ALL TESTS PASSED SUCCESSFULLY! (100%) ');
    console.log('========================================\n');
  } finally {
    // Close remaining sockets so server.close() can complete
    try { userASocket.disconnect(); } catch {}
    try { clientSocket.disconnect(); } catch {}
    try { dmSocket.disconnect(); } catch {}
    try { unauthSocket.disconnect(); } catch {}
    await new Promise((resolve) => server.close(resolve));
    io.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
