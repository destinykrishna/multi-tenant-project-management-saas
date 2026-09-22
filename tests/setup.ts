import { afterAll } from '@jest/globals';
import { disconnectDatabase } from '../src/config/database.js';
import { disconnectRedis } from '../src/config/redis.js';
import { closeAllQueues } from '../src/jobs/queues/index.js';


afterAll(async () => {
  await closeAllQueues();
  await disconnectRedis();
  await disconnectDatabase();
});
