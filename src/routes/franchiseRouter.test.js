const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database.js');

// Make a random string for unique test data
function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

// Get id from different possible response shapes
function extractId(obj) {
  return obj?.id ?? obj?.franchiseId ?? obj?.storeId ?? obj?.franchise?.id ?? obj?.store?.id;
}

let adminUser;
let adminToken;

let dinerUser;
let dinerToken;
let dinerId;

let otherUser;
let otherToken;

let franchiseForDinerAdmin; // diner is franchise admin (not Role.Admin)
let franchiseForAdminOnly;  // diner is not admin

beforeAll(async () => {
  // Create admin directly in DB
  adminUser = {
    name: randomName(),
    email: `${randomName()}@admin.com`,
    password: 'toomanysecrets',
    roles: [{ role: Role.Admin }],
  };
  adminUser = await DB.addUser(adminUser);

  // Login admin to get token
  const adminLogin = await request(app).put('/api/auth').send({
    email: adminUser.email,
    password: 'toomanysecrets',
  });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.token;
  expect(adminToken).toBeTruthy();

  // Register diner
  dinerUser = {
    name: 'pizza diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const dinerRegister = await request(app).post('/api/auth').send(dinerUser);
  expect(dinerRegister.status).toBe(200);
  dinerToken = dinerRegister.body.token;
  dinerId = dinerRegister.body.user?.id;
  expect(dinerToken).toBeTruthy();
  expect(dinerId).toBeTruthy();

  // Register another normal user
  otherUser = {
    name: 'other diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const otherRegister = await request(app).post('/api/auth').send(otherUser);
  expect(otherRegister.status).toBe(200);
  otherToken = otherRegister.body.token;
  expect(otherToken).toBeTruthy();

  // Create a franchise where diner is an admin (franchise admin list)
  const f1 = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: dinerUser.email }] });
  expect(f1.status).toBe(200);
  franchiseForDinerAdmin = f1.body;
  expect(extractId(franchiseForDinerAdmin)).toBeTruthy();

  // Create a franchise where only adminUser is admin
  const f2 = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });
  expect(f2.status).toBe(200);
  franchiseForAdminOnly = f2.body;
  expect(extractId(franchiseForAdminOnly)).toBeTruthy();
});

test('GET /api/franchise returns { franchises, more }', async () => {
  // List franchises (no auth middleware on this route)
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body).toBeTruthy();
  expect(Array.isArray(res.body.franchises)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');
});

test('GET /api/franchise/:userId returns franchises for self', async () => {
  // User can fetch their own franchises
  const res = await request(app)
    .get(`/api/franchise/${dinerId}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /api/franchise/:userId returns [] for non-admin requesting other user', async () => {
  // Non-admin should not see other user's franchises
  const res = await request(app)
    .get(`/api/franchise/${dinerId}`)
    .set('Authorization', `Bearer ${otherToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBe(0);
});

test('POST /api/franchise (admin) creates franchise', async () => {
  // Admin creates franchise
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });

  expect(res.status).toBe(200);
  expect(res.body?.name).toBeTruthy();
  expect(extractId(res.body)).toBeTruthy();
});

test('POST /api/franchise (non-admin) is blocked with 403', async () => {
  // Non-admin cannot create franchise
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: randomName(), admins: [{ email: dinerUser.email }] });

  expect(res.status).toBe(403);
});

test('POST /api/franchise/:id/store allows franchise admin (not Role.Admin)', async () => {
  // Diner is in franchise.admins, so should be allowed
  const fid = extractId(franchiseForDinerAdmin);

  const res = await request(app)
    .post(`/api/franchise/${fid}/store`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: randomName() });

  expect(res.status).toBe(200);
  expect(res.body?.name).toBeTruthy();
  expect(extractId(res.body)).toBeTruthy();
});

test('POST /api/franchise/:id/store blocks non-admin who is not franchise admin', async () => {
  // Diner is NOT in franchise.admins, so should be blocked
  const fid = extractId(franchiseForAdminOnly);

  const res = await request(app)
    .post(`/api/franchise/${fid}/store`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: randomName() });

  expect(res.status).toBe(403);
});

test('DELETE /api/franchise/:fid/store/:sid blocks non-admin who is not franchise admin', async () => {
  // Create a store under admin-only franchise
  const fid = extractId(franchiseForAdminOnly);

  const storeRes = await request(app)
    .post(`/api/franchise/${fid}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });

  expect(storeRes.status).toBe(200);
  const sid = extractId(storeRes.body);
  expect(sid).toBeTruthy();

  // Diner tries to delete store but is not franchise admin
  const delRes = await request(app)
    .delete(`/api/franchise/${fid}/store/${sid}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(delRes.status).toBe(403);
});

afterAll(async () => {
  // Close DB if supported
  if (DB?.end) await DB.end();
  if (DB?.close) await DB.close();
  if (DB?.connection?.end) await DB.connection.end();
});