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

let franchiseId;
let storeId;
let menuItem;

beforeAll(async () => {
  // Create admin in DB
  adminUser = {
    name: randomName(),
    email: `${randomName()}@admin.com`,
    password: 'toomanysecrets',
    roles: [{ role: Role.Admin }],
  };
  adminUser = await DB.addUser(adminUser);

  // Login admin
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
  expect(dinerToken).toBeTruthy();

  // Create franchise + store for valid ids
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });
  expect(franchiseRes.status).toBe(200);
  franchiseId = extractId(franchiseRes.body);
  expect(franchiseId).toBeTruthy();

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });
  expect(storeRes.status).toBe(200);
  storeId = extractId(storeRes.body);
  expect(storeId).toBeTruthy();

  // Get one menu item for order creation (seed if empty)
  let menu = await DB.getMenu();
  expect(Array.isArray(menu)).toBe(true);

  if (menu.length === 0) {
    const seed = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Seed Pizza', description: 'seed', image: 'seed.png', price: 0.01 });

    expect(seed.status).toBe(200);

    menu = await DB.getMenu();
    expect(Array.isArray(menu)).toBe(true);
  }

  expect(menu.length).toBeGreaterThan(0);
  menuItem = menu[0];
  expect(menuItem?.id).toBeTruthy();
});

test('GET /api/order/menu returns menu', async () => {
  // Menu does not require auth in router code
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('PUT /api/order/menu blocks non-admin', async () => {
  // Non-admin cannot add menu items
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ title: 'X', description: 'X', image: 'x.png', price: 0.1 });

  expect(res.status).toBe(403);
});

test('PUT /api/order/menu allows admin', async () => {
  // Admin can add menu item
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Student', description: 'Just carbs', image: 'pizza9.png', price: 0.0001 });

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('GET /api/order works for authenticated diner', async () => {
  // Diner can fetch their orders
  const res = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toBeTruthy();
});

test('POST /api/order success path when factory returns ok', async () => {
  // Mock fetch success
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ jwt: 'factory-jwt', reportUrl: 'http://report' }),
  });

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      franchiseId,
      storeId,
      items: [{ menuId: menuItem.id, description: menuItem.title ?? 'item', price: menuItem.price ?? 0.01 }],
    });

  expect([200]).toContain(res.status);
  expect(res.body?.order).toBeTruthy();
  expect(res.body?.jwt).toBeTruthy();
});

test('POST /api/order failure path when factory returns not ok', async () => {
  // Mock fetch failure
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ reportUrl: 'http://report' }),
  });

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      franchiseId,
      storeId,
      items: [{ menuId: menuItem.id, description: menuItem.title ?? 'item', price: menuItem.price ?? 0.01 }],
    });

  expect([500]).toContain(res.status);
  expect(res.body?.message).toBeTruthy();
});

afterAll(async () => {
  // Close DB if supported
  if (DB?.end) await DB.end();
  if (DB?.close) await DB.close();
  if (DB?.connection?.end) await DB.connection.end();
});