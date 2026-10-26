// sendBulkNotifications → browser push. setup.js mocks the notification
// service globally, so the real module is loaded here.
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
jest.mock('../src/config/queue', () => ({ pushQueue: null }));

process.env.VAPID_PUBLIC_KEY = 'pub';
process.env.VAPID_PRIVATE_KEY = 'priv';

const db = require('../src/config/db');
const webpush = require('web-push');
const { sendBulkNotifications } = jest.requireActual('../src/services/notificationService');

describe('web push in sendBulkNotifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends to each of the recipient\'s browsers and deletes gone subscriptions', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        { user_id: 'u1', endpoint: 'https://fcm.googleapis.com/a', p256dh: 'k1', auth: 'a1' },
        { user_id: 'u1', endpoint: 'https://fcm.googleapis.com/gone', p256dh: 'k2', auth: 'a2' },
        { user_id: 'u2', endpoint: 'https://fcm.googleapis.com/other', p256dh: 'k3', auth: 'a3' },
      ] })
      .mockResolvedValue({ rows: [] }); // the DELETE, then the Expo token lookup
    webpush.sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));

    await sendBulkNotifications([{ userId: 'u1', title: 'New match', body: 'Hi', data: { type: 'new_match' } }]);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    const [subscription, payload] = webpush.sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: 'https://fcm.googleapis.com/a', keys: { p256dh: 'k1', auth: 'a1' } });
    expect(JSON.parse(payload)).toEqual({ title: 'New match', body: 'Hi', data: { type: 'new_match' } });

    const del = db.query.mock.calls.find(([sql]) => /DELETE FROM web_push_subscriptions/.test(sql));
    expect(del[1]).toEqual([['https://fcm.googleapis.com/gone']]);
  });
});
