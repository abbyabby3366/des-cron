import { Session, User } from '../database.js';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('[Auth Middleware] Denied: Access token required');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const session = await Session.findOne({ token });

    if (!session) {
      console.log('[Auth Middleware] Denied: Invalid or expired session (not found in DB)');
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (session.expires_at < Date.now()) {
      console.log(`[Auth Middleware] Denied: Session expired. Expires: ${new Date(session.expires_at).toISOString()}, Current time: ${new Date().toISOString()}`);
      await Session.deleteOne({ _id: session._id });
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = await User.findById(session.user_id);
    if (!user) {
      console.log('[Auth Middleware] Denied: User not found in DB');
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}
