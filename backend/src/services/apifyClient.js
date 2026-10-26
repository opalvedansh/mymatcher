const { ApifyClient } = require('apify-client');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.APIFY_API_TOKEN) {
      throw new Error('APIFY_API_TOKEN is not configured');
    }
    client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
  }
  return client;
}

/**
 * Runs an actor to completion and returns its dataset items.
 * Throws when the run fails or times out.
 */
async function runActor(actorId, input, { timeoutSecs = 120, memoryMbytes = 256 } = {}) {
  const apify = getClient();
  const run = await apify.actor(actorId).call(input, {
    timeout: timeoutSecs,
    memory: memoryMbytes,
    waitSecs: timeoutSecs,
  });
  if (run.status && run.status !== 'SUCCEEDED') {
    throw new Error(`Actor ${actorId} finished with status ${run.status}`);
  }
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

module.exports = { getClient, runActor };
