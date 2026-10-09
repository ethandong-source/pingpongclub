"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./mock-firestore.cjs");
const { makeAdmin, verifyPassword } = require("../lib/admin-auth");
const { createStore } = require("../lib/firestore-storage");
test("admin details persist as a hashed password in the same club document", async () => {
  const admin = await makeAdmin("admin", "my-password");
  assert.equal(admin.username, "admin"); assert.equal(admin.password, undefined);
  assert.equal(await verifyPassword("my-password", admin), true);
  assert.equal(await verifyPassword("wrong", admin), false);
  const firestore = fakeFirestore(); const store = createStore(firestore, "clubs/test");
  const value = await store.read(); value.db.admin = admin;
  await store.write(value.db, value.revision);
  const saved = await store.read(); assert.deepEqual(saved.db.admin, admin);
  assert.equal(saved.revision, 1);
  await store.read(); assert.equal((await store.read()).revision, 1);
  assert.equal(firestore.records.get("clubs/test").admin.passwordHash, admin.passwordHash);
});
