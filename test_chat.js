const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { app, server, io } = require('./backend/server');

const TEST_PORT = 5001;

async function runTests() {
  console.log('--- Starting Real-Time Chat App End-to-End Tests ---');

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`Server listening on test port ${TEST_PORT}`);

  const baseUrl = `http://localhost:${TEST_PORT}`;

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
    const clientSocket = ioClient(baseUrl, {
      auth: { token: loginData.token },
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);

      clientSocket.on('connect', () => {
        console.log('✓ Socket.IO client connected with ID:', clientSocket.id);
        clientSocket.emit('join', {
          username: testUsername,
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

          // Send a chat message
          clientSocket.emit('chat-message', 'Hello, this is a real-time test message!');
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

    console.log('\n========================================');
    console.log(' ALL TESTS PASSED SUCCESSFULLY! (100%) ');
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
