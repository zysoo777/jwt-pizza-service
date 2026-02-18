const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
];

// getUser
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// updateUser
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  })
);

// deleteUser (admin only)
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const user = req.user;

    // admin only
    if (!user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const userId = Number(req.params.userId);
    await DB.deleteUser(userId);

    res.status(200).json({ message: 'not implemented' });
  })
);

// listUsers (admin only, pagination + name filter)
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const user = req.user;

    // admin only
    if (!user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit ?? '10', 10) || 10, 1);
    const name = req.query.name ?? '*';

    let users = await DB.getUsers();

    // name filter
    if (name && name !== '*' && name !== '') {
      const needle = String(name).toLowerCase();
      users = users.filter((u) => String(u.name ?? '').toLowerCase().includes(needle));
    }

    // stable order for pagination
    users.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    // pagination with limit+1 to compute "more"
    const start = (page - 1) * limit;
    const slice = users.slice(start, start + limit + 1);
    const more = slice.length > limit;

    const pageUsers = slice.slice(0, limit).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles ?? [],
    }));

    res.status(200).json({ message: 'not implemented', users: pageUsers, more });
  })
);

module.exports = userRouter;