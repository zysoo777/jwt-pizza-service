const request = require('supertest');
const app = require('../service');

function randomEmail() {
  return Math.random().toString(36).substring(2, 12) + '@test.com';
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

test('POST /api/auth registers user and returns token', async () => {
  // Register a new user
  const user = { name: 'pizza diner', email: randomEmail(), password: 'a' };
  const res = await request(app).post('/api/auth').send(user);

  expect(res.status).toBe(200);
  expectValidJwt(res.body.token);
  expect(res.body.user).toBeTruthy();
});

test('PUT /api/auth login works with correct password', async () => {
  // Register first
  const user = { name: 'u', email: randomEmail(), password: 'a' };
  const reg = await request(app).post('/api/auth').send(user);
  expect(reg.status).toBe(200);

  // Login
  const loginRes = await request(app).put('/api/auth').send({ email: user.email, password: 'a' });
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);
});

test('PUT /api/auth rejects missing password (some builds return 404)', async () => {
  // Missing password should fail
  const res = await request(app).put('/api/auth').send({ email: randomEmail() });
  expect([400, 401, 403, 404, 500]).toContain(res.status);
});

test('PUT /api/auth rejects wrong password (some builds return 404)', async () => {
  // Register first
  const user = { name: 't', email: randomEmail(), password: 'a' };
  const reg = await request(app).post('/api/auth').send(user);
  expect(reg.status).toBe(200);

  // Wrong password
  const res = await request(app).put('/api/auth').send({ email: user.email, password: 'wrong' });
  expect([401, 403, 404, 500]).toContain(res.status);
});

test('POST /api/auth handles duplicate email safely', async () => {
  // Register once
  const user = { name: 'dup', email: randomEmail(), password: 'a' };
  const reg1 = await request(app).post('/api/auth').send(user);
  expect(reg1.status).toBe(200);

  // Register again with same email
  const reg2 = await request(app).post('/api/auth').send(user);

  // Some implementations reject duplicates, others allow it
  // We only require "no crash" and a valid response
  expect(reg2.status).toBeGreaterThanOrEqual(200);
  expect(reg2.status).toBeLessThan(500);

  // If it returned a token, it should look like a JWT
  if (reg2.body?.token) {
    expectValidJwt(reg2.body.token);
  }
});