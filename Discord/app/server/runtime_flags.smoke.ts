const runtimeFlagsAssert = require('node:assert/strict');
const { getRuntimeFlags, isTruthyEnvValue } = require('./runtime_flags.ts');

runtimeFlagsAssert.equal(isTruthyEnvValue('true'), true);
runtimeFlagsAssert.equal(isTruthyEnvValue('1'), true);
runtimeFlagsAssert.equal(isTruthyEnvValue('false'), false);
runtimeFlagsAssert.equal(isTruthyEnvValue(''), false);
runtimeFlagsAssert.equal(isTruthyEnvValue('   '), false);

runtimeFlagsAssert.deepEqual(
  getRuntimeFlags({}),
  {
    disableAutomation: false,
    enableCampaignSendTick: true,
    enableCampaignAutoImportTick: true,
  }
);

runtimeFlagsAssert.deepEqual(
  getRuntimeFlags({ STAGING_DISABLE_AUTOMATION: 'true' }),
  {
    disableAutomation: true,
    enableCampaignSendTick: false,
    enableCampaignAutoImportTick: false,
  }
);

runtimeFlagsAssert.deepEqual(
  getRuntimeFlags({
    STAGING_DISABLE_AUTOMATION: 'true',
    ENABLE_CAMPAIGN_SEND_TICK: 'true',
  }),
  {
    disableAutomation: true,
    enableCampaignSendTick: true,
    enableCampaignAutoImportTick: false,
  }
);

runtimeFlagsAssert.deepEqual(
  getRuntimeFlags({
    ENABLE_CAMPAIGN_SEND_TICK: '   ',
  }),
  {
    disableAutomation: false,
    enableCampaignSendTick: true,
    enableCampaignAutoImportTick: true,
  }
);

runtimeFlagsAssert.deepEqual(
  getRuntimeFlags({
    STAGING_DISABLE_AUTOMATION: 'false',
    ENABLE_CAMPAIGN_SEND_TICK: 'true',
    ENABLE_CAMPAIGN_AUTO_IMPORT_TICK: 'true',
  }),
  {
    disableAutomation: false,
    enableCampaignSendTick: true,
    enableCampaignAutoImportTick: true,
  }
);

console.log('runtime flag smoke check passed');
