// Run with: node --test server/controllers/userAuth.profile.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, dependencies, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, exports: module.exports,
    require: (name) => dependencies[name] || {},
    console: { log() {}, warn() {}, error() {} },
    Buffer, ...extras,
  }, { filename: file });
  return module.exports;
}

function setup({ seedFails = false, uploadFails = false, duplicate = false, duplicateRace = false } = {}) {
  const calls = { seeds: 0, uploads: 0, copies: 0, users: [] };
  const defaultUrl = 'https://res.cloudinary.com/test/image/upload/lms/users/profile/default_profile_image.png';
  const profiles = load('../utils/profileImageStorage.js', {
    cloudinary: { v2: {
      config() {},
      uploader: { async upload(source) {
        calls.seeds++;
        assert.match(source, /^data:image\/svg\+xml;base64,/);
        if (seedFails) throw new Error('Storage unavailable');
        return { secure_url: defaultUrl };
      } },
    } },
  }, { process: { env: { CLOUDINARY_CLOUD_NAME: 'test' } } });
  const controller = load('userAuth.js', {
    config: { get: () => 'test' },
    '../models/UserModel': {
      findOne: async () => duplicate ? { _id: 'existing-user' } : null,
      create: async (user) => {
        if (duplicateRace) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
        calls.users.push(user);
        return { _id: 'new-user', ...user };
      },
    },
    '../models/RoleModel': { findById: async () => ({ originalRole: 'student' }) },
    '../config/secretToken': { createSecretToken: () => 'test-token' },
    '../utils/sendEmail': { isValidEmail: () => true, sendEmail: async () => ({ success: true }) },
    '../utils/autoEnrollUser': { autoEnrollUser: async () => ({ enrolled: [], skipped: [] }) },
    '../utils/superAdminPermissions': { isSuperAdminRoleName: () => false },
    '../utils/profileImageStorage': profiles,
    '../utils/storage': {
      publicUrlFor: (file) => `https://example.test/${file}`,
      storage: { from: () => ({
        copy: async () => { calls.copies++; return { error: new Error('Resource not found') }; },
        upload: async () => { calls.uploads++; return { error: uploadFails ? new Error('Upload failed') : null }; },
      }) },
    },
  }, { process: { env: {} } });
  const add = async (files) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.Addusers({
      body: { email: 'user@example.test', firstName: 'Test', lastName: 'User', password: 'test-password', role: 'student' },
      user: { email: 'admin@example.test' }, files,
    }, res);
    return res;
  };
  return { calls, add, defaultUrl };
}

test('adding users without photos seeds one shared avatar and never copies a missing asset', async () => {
  const { add, calls, defaultUrl } = setup();
  const responses = await Promise.all([add(), add()]);
  responses.forEach((res) => {
    assert.equal(res.code, 201);
    assert.equal(res.body.user.profile, defaultUrl);
  });
  assert.equal(calls.users.length, 2);
  assert.equal(calls.seeds, 1);
  assert.equal(calls.copies, 0);
  assert.equal(calls.uploads, 0);
});

test('default avatar service failure does not prevent account creation', async () => {
  const { add, calls } = setup({ seedFails: true });
  assert.equal((await add()).code, 201);
  assert.equal(calls.users.length, 1);
});

test('an existing email returns an actionable conflict without storage or creation', async () => {
  const { add, calls } = setup({ duplicate: true });
  const res = await add();
  assert.equal(res.code, 409);
  assert.match(res.body.message[0].value, /email already exists/);
  assert.equal(calls.users.length, 0);
  assert.equal(calls.seeds, 0);
});

test('a duplicate detected during creation also returns conflict', async () => {
  const { add, calls } = setup({ duplicateRace: true });
  const res = await add();
  assert.equal(res.code, 409);
  assert.match(res.body.message[0].value, /already exists/);
  assert.equal(calls.users.length, 0);
});

test('a supplied photo still uploads and bypasses the default avatar', async () => {
  const { add, calls } = setup();
  const res = await add({ profile: { name: 'photo.png', data: Buffer.from('photo') } });
  assert.equal(res.code, 201);
  assert.match(res.body.user.profile, /users\/profile\/\d+_photo\.png$/);
  assert.equal(calls.uploads, 1);
  assert.equal(calls.seeds, 0);
});

test('a failed explicit photo upload still reports an error before creating a user', async () => {
  const { add, calls } = setup({ uploadFails: true });
  assert.equal((await add({ profile: { name: 'photo.png', data: Buffer.from('photo') } })).code, 500);
  assert.equal(calls.users.length, 0);
});
