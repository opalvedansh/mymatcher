/**
 * Global test setup — mocks the database layer and auth middleware
 * so tests can run instantly without a real PostgreSQL connection.
 */

// Mock the database module
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => ({
    query: jest.fn(),
    release: jest.fn(),
  })),
  pool: { end: jest.fn() },
}));

// Mock the notification service (never send real push notifications in tests)
jest.mock('../src/services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(),
  sendMatchNotification: jest.fn().mockResolvedValue(),
  sendMatchNotifications: jest.fn().mockResolvedValue(),
  sendBulkNotifications: jest.fn().mockResolvedValue(),
  sendChatNotification: jest.fn().mockResolvedValue(),
  sendLikeNotification: jest.fn().mockResolvedValue(),
  recordNotifications: jest.fn().mockResolvedValue(),
}));

// Mock socket.io initialization
jest.mock('../src/socket', () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => ({
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  })),
}));

// Mock Sentry so it doesn't try to send events
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  setupExpressErrorHandler: jest.fn(() => (err, req, res, next) => next(err)),
  captureException: jest.fn(),
}));

// Helper to create a mock JWT token
// In tests, we bypass real JWT verification by mocking the auth middleware
const createMockUser = (overrides = {}) => ({
  id: 'test-user-id-123',
  email: 'test@example.com',
  role: 'brand',
  banned: false,
  ...overrides,
});

module.exports = { createMockUser };
