const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

// Make random text for unique data
function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/
  );
}

// Create an admin user in DB
async function createAdminUser() {
  let user = {
    password: 'toomanysecrets',
    roles: [{ role: Role.Admin }],
  };

  user.name = randomName();
  user.email = `${user.name}@admin.com`;

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

const diner = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let dinerToken;
let dinerUser;

let adminToken;
let adminUser;

beforeAll(async () => {
  // Register a normal user
  diner.email = `${randomName()}@test.com`;
  const registerRes = await request(app).post('/api/auth').send(diner);

  dinerToken = registerRes.body.token;
  dinerUser = registerRes.body.user;

  expect(registerRes.status).toBe(200);
  expectValidJwt(dinerToken);
  expect(dinerUser).toBeTruthy();

  // Create admin and login
  adminUser = await createAdminUser();
  const adminLoginRes = await request(app).put('/api/auth').send({
    email: adminUser.email,
    password: adminUser.password,
  });

  expect(adminLoginRes.status).toBe(200);
  adminToken = adminLoginRes.body.token;
  expectValidJwt(adminToken);
});

test('GET /api/user/me returns authenticated user', async () => {
  // Read current user profile
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(200);
  expect(res.body.email).toBe(diner.email);
});

test('PUT /api/user/:userId updates own account', async () => {
  // Update my own data
  const newName = `name-${randomName()}`;

  const res = await request(app)
    .put(`/api/user/${dinerUser.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      name: newName,
      email: diner.email,
      password: diner.password,
    });

  expect(res.status).toBe(200);
  expect(res.body.user).toBeTruthy();
  expect(res.body.user.name).toBe(newName);
  expect(res.body.user.email).toBe(diner.email);

  // Response includes new token
  expectValidJwt(res.body.token);
});

test('PUT /api/user/:userId blocks updating other user (non-admin)', async () => {
  // Create another user
  const other = {
    name: `other-${randomName()}`,
    email: `${randomName()}@test.com`,
    password: 'a',
  };

  const otherReg = await request(app).post('/api/auth').send(other);
  expect(otherReg.status).toBe(200);

  const otherUser = otherReg.body.user;
  expect(otherUser).toBeTruthy();

  // Non-admin tries to update other user
  const res = await request(app)
    .put(`/api/user/${otherUser.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      name: 'hacked',
      email: other.email,
      password: other.password,
    });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('GET /api/user returns not implemented payload', async () => {
  // List users endpoint is not implemented
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('not implemented');
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');
});

test('DELETE /api/user/:userId returns not implemented payload', async () => {
  // Delete endpoint is not implemented
  const res = await request(app)
    .delete(`/api/user/${dinerUser.id}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('not implemented');
});