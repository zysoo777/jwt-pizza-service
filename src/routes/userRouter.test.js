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

test('GET /api/user returns unauthorized for non-admin', async () => {
  // List users is admin-only
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('DELETE /api/user/:userId returns unauthorized for non-admin', async () => {
  // Delete user is admin-only
  const res = await request(app)
    .delete(`/api/user/${dinerUser.id}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

async function registerUser(service, user) {
  const res = await service.post('/api/auth').send(user);
  expect(res.status).toBe(200);
  expectValidJwt(res.body.token);
  expect(res.body.user).toBeTruthy();
  return { token: res.body.token, user: res.body.user };
}

test('GET /api/user unauthorized (no token)', async () => {
  const res = await request(app).get('/api/user');
  expect(res.status).toBe(401);
});

test('GET /api/user forbidden for non-admin', async () => {
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('GET /api/user lists users (admin) with required fields', async () => {
  const res = await request(app)
    .get('/api/user?page=1&limit=10&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');

  if (res.body.users.length > 0) {
    const u = res.body.users[0];
    expect(u.id).toBeTruthy();
    expect(u.name).toBeTruthy();
    expect(u.email).toBeTruthy();
    expect(Array.isArray(u.roles)).toBe(true);
  }
});

test('GET /api/user supports pagination (admin) and sets more correctly', async () => {
  const u1 = { name: `u1-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };
  const u2 = { name: `u2-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };
  const u3 = { name: `u3-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };

  await registerUser(request(app), u1);
  await registerUser(request(app), u2);
  await registerUser(request(app), u3);

  const res = await request(app)
    .get('/api/user?page=1&limit=1&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(res.body.users.length).toBe(1);
  expect(typeof res.body.more).toBe('boolean');

  expect(res.body.more).toBe(true);
});

test('GET /api/user supports name filter (admin)', async () => {
  const targetName = `Kai-${randomName()}`;
  const target = { name: targetName, email: `${randomName()}@test.com`, password: 'a' };
  const other = { name: `Other-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };

  await registerUser(request(app), target);
  await registerUser(request(app), other);

  const res = await request(app)
    .get(`/api/user?page=1&limit=10&name=${encodeURIComponent('Kai')}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);

  const names = res.body.users.map((u) => u.name);
  expect(names.some((n) => String(n).includes('Kai'))).toBe(true);
});

test('DELETE /api/user/:userId forbidden for non-admin', async () => {
  const victim = { name: `victim-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };
  const victimReg = await registerUser(request(app), victim);

  const res = await request(app)
    .delete(`/api/user/${victimReg.user.id}`)
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('DELETE /api/user/:userId deletes a user (admin) and user disappears from list', async () => {
  const victim = { name: `victim2-${randomName()}`, email: `${randomName()}@test.com`, password: 'a' };
  const victimReg = await registerUser(request(app), victim);

  const delRes = await request(app)
    .delete(`/api/user/${victimReg.user.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect([200, 204]).toContain(delRes.status);

  const listRes = await request(app)
    .get('/api/user?page=1&limit=50&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(listRes.status).toBe(200);
  const ids = listRes.body.users.map((u) => u.id);
  expect(ids.includes(victimReg.user.id)).toBe(false);
});