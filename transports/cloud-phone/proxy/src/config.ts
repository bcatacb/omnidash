export interface ProxyConfig { baseUrl: string; apiKey: string; authHeader: string; authScheme: string; port: number; consoleToken: string; }

export function loadConfig(env = process.env): ProxyConfig {
  return {
    baseUrl: env.DUOPLUS_BASE_URL ?? "https://openapi.duoplus.net",
    apiKey: env.DUOPLUS_API_KEY ?? "",
    authHeader: env.DUOPLUS_AUTH_HEADER ?? "DuoPlus-API-Key",
    authScheme: env.DUOPLUS_AUTH_SCHEME ?? "",
    port: Number(env.PROXY_PORT ?? "4000"),
    consoleToken: env.CONSOLE_TOKEN ?? "",
  };
}

export function authHeaders(cfg: ProxyConfig): Record<string, string> {
  const value = cfg.authScheme ? `${cfg.authScheme} ${cfg.apiKey}` : cfg.apiKey;
  return { [cfg.authHeader]: value };
}
