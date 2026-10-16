'use strict';
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { validate } = require('./validate');
const { appid: allowedAppid } = require('./relay-config.json');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
exports.main = async event => {
  const context = cloud.getWXContext();
  // Use server identity; never trust a caller-supplied OpenID or environment.
  if (!context.OPENID || !context.APPID || context.APPID !== allowedAppid) {
    throw new Error('unauthorized app');
  }
  const data = validate(event);
  const id = crypto.createHash('sha256')
    .update(context.OPENID + ':' + data.session + ':' + data.batchId).digest('hex');
  const owner = crypto.createHash('sha256').update(context.OPENID).digest('hex');
  // Stable document IDs make network retries idempotent. Collection must exist.
  await db.collection('phone_log_batches').doc(id).set({ data: {
    ...data, owner, appid: context.APPID, receivedAt: db.serverDate()
  } });
  return { ok: true, batchId: data.batchId, accepted: data.entries.length };
};
