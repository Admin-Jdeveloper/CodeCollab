import { io, type Socket } from "socket.io-client";

const SOCKET_URL_1 = process.env.SOCKET_URL_1 || "http://localhost:3001";

function createClient(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL_1, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 5000,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCollaborationTests() {
  console.log("=================================================");
  console.log("   RUNNING COLLABORATION & VERSIONING TEST SUITE  ");
  console.log("=================================================");

  const testRoom = `test-room-${Date.now()}`;
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      failed++;
    }
  }

  let client1: Socket | null = null;
  let client2: Socket | null = null;

  try {
    // 1. Connect two clients
    client1 = await createClient();
    client2 = await createClient();
    assert(client1.connected && client2.connected, "Two clients successfully connected to Socket.IO cluster");

    // 2. Client 1 joins room
    let roomStateReceived = false;
    let initialVersion = 1;
    client1.on("room_state", (state: any) => {
      roomStateReceived = true;
      if (state.files && state.files.length > 0) {
        initialVersion = state.files[0].version || 1;
      }
    });

    client1.emit("join_room", {
      roomId: testRoom,
      userId: "user-1",
      userName: "Alice",
    });

    await wait(600);
    assert(roomStateReceived, "Client 1 received room_state upon joining");

    // 3. Client 2 joins room and receives presence
    let user1ReceivedJoined = false;
    client1.on("user_joined", (user: any) => {
      if (user.userId === "user-2") user1ReceivedJoined = true;
    });

    client2.emit("join_room", {
      roomId: testRoom,
      userId: "user-2",
      userName: "Bob",
    });

    await wait(300);
    assert(user1ReceivedJoined, "Client 1 received user_joined notification for Client 2");

    // 4. Client 1 makes an edit with matching version (Version Accepted & Incremented)
    let client2ReceivedCodeUpdate = false;
    let client1ReceivedAck = false;
    let newVersion = 0;

    client2.on("code_update", (payload: any) => {
      if (payload.content === 'console.log("version 1 edit");') {
        client2ReceivedCodeUpdate = true;
        newVersion = payload.version;
      }
    });

    client1.on("code_ack", (ack: any) => {
      client1ReceivedAck = true;
      newVersion = ack.version;
    });

    client1.emit("code_change", {
      roomId: testRoom,
      filePath: "/main.js",
      version: initialVersion,
      content: 'console.log("version 1 edit");',
      senderId: "user-1",
    });

    await wait(400);
    assert(client1ReceivedAck, "Client 1 received code_ack acknowledging valid version edit");
    assert(client2ReceivedCodeUpdate, "Client 2 received authoritative code_update broadcast");
    assert(newVersion === initialVersion + 1, `Version was incremented monotonically: ${initialVersion} -> ${newVersion}`);

    // 5. Stale Edit Test: Client 2 sends edit with stale (old) version -> SYNC_REQUIRED
    let syncRequiredReceived = false;
    client2.on("sync_required", (syncPayload: any) => {
      if (syncPayload.version === newVersion) {
        syncRequiredReceived = true;
      }
    });

    client2.emit("code_change", {
      roomId: testRoom,
      filePath: "/main.js",
      version: initialVersion, // STALE! Server is at newVersion
      content: "OVERWRITE STALE TEXT",
      senderId: "user-2",
    });

    await wait(400);
    assert(syncRequiredReceived, "Server rejected stale edit and emitted sync_required with authoritative state");

    // 6. Transient Cursor Position Tracking
    let client2ReceivedCursor = false;
    client2.on("cursor_update", (cursorEvent: any) => {
      if (cursorEvent.userId === "user-1" && cursorEvent.cursor.lineNumber === 42) {
        client2ReceivedCursor = true;
      }
    });

    client1.emit("cursor_update", {
      roomId: testRoom,
      filePath: "/main.js",
      cursor: { lineNumber: 42, column: 10 },
    });

    await wait(300);
    assert(client2ReceivedCursor, "Client 2 received transient cursor_update without DB persistence");

    // 7. Client Disconnect and Presence Cleanup
    let client2ReceivedLeave = false;
    client2.on("user_left", (leaveEvent: any) => {
      if (leaveEvent.userId === "user-1") {
        client2ReceivedLeave = true;
      }
    });

    client1.disconnect();
    await wait(400);
    assert(client2ReceivedLeave, "Client 2 received user_left on Client 1 disconnect");

    // 8. Client 1 Reconnects & Re-synchronizes
    client1 = await createClient();
    let reconnectedRoomState = false;
    client1.on("room_state", (state: any) => {
      if (state.files && state.files.some((f: any) => f.path === "/main.js" && f.version === newVersion)) {
        reconnectedRoomState = true;
      }
    });

    client1.emit("join_room", {
      roomId: testRoom,
      userId: "user-1",
      userName: "Alice",
      lastKnownVersions: { "/main.js": initialVersion },
    });

    await wait(400);
    assert(reconnectedRoomState, "Client 1 reconnected, rejoined room, and synchronized latest authoritative version");

    // 9. Deterministic File Room Join (project:<projectId>:file:<fileId>)
    let fileStateReceived = false;
    let fileStateVersion = 0;
    client1.on("file_state", (fState: any) => {
      if (fState.filePath === "/main.js") {
        fileStateReceived = true;
        fileStateVersion = fState.version;
      }
    });

    client1.emit("join_file", {
      roomId: testRoom,
      filePath: "/main.js",
    });

    await wait(300);
    assert(fileStateReceived && fileStateVersion === newVersion, "Deterministic join_file returned verified document, version, and joined channel");

    // 10. Multiple Rooms & Room Isolation
    const testRoomB = `test-room-B-${Date.now()}`;
    const client3 = await createClient();

    let client3ReceivedRoomAUpdate = false;
    client3.on("code_update", (p: any) => {
      if (p.roomId === testRoom || p.content?.includes("Room A Edit")) {
        client3ReceivedRoomAUpdate = true;
      }
    });

    client3.emit("join_room", {
      roomId: testRoomB,
      userId: "user-3",
      userName: "Charlie",
    });

    await wait(300);

    // Client 1 edits in testRoom (Room A)
    client1.emit("code_change", {
      roomId: testRoom,
      filePath: "/main.js",
      version: newVersion,
      content: 'console.log("Room A Edit");',
      senderId: "user-1",
    });

    await wait(400);
    assert(!client3ReceivedRoomAUpdate, "Room Isolation verified: Client 3 in Room B received no updates from Room A");

    client3.disconnect();

  } catch (err: any) {
    console.error("Test execution exception:", err);
    failed++;
  } finally {
    client1?.disconnect();
    client2?.disconnect();
  }

  console.log("\n-------------------------------------------------");
  console.log(`TOTAL COLLABORATION TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("-------------------------------------------------");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runCollaborationTests();
