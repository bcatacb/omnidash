export type RuntimeFlags = {
  disableAutomation: boolean;
  enableCampaignSendTick: boolean;
  enableCampaignAutoImportTick: boolean;
};

type RuntimeFlagEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function isTruthyEnvValue(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function hasExplicitEnvOverride(value: string | undefined): boolean {
  return String(value || '').trim().length > 0;
}

function resolveTickEnabled(envValue: string | undefined, disableAutomation: boolean): boolean {
  const hasExplicitOverride = hasExplicitEnvOverride(envValue);
  if (disableAutomation) {
    return hasExplicitOverride ? isTruthyEnvValue(envValue) : false;
  }

  return hasExplicitOverride ? isTruthyEnvValue(envValue) : true;
}

export function getRuntimeFlags(env: RuntimeFlagEnv): RuntimeFlags {
  const disableAutomation = isTruthyEnvValue(env.STAGING_DISABLE_AUTOMATION);

  return {
    disableAutomation,
    enableCampaignSendTick: resolveTickEnabled(env.ENABLE_CAMPAIGN_SEND_TICK, disableAutomation),
    enableCampaignAutoImportTick: resolveTickEnabled(env.ENABLE_CAMPAIGN_AUTO_IMPORT_TICK, disableAutomation),
  };
}
