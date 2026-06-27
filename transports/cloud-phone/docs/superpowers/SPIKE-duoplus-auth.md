# Spike: confirm DuoPlus live auth + shapes

Run when a real API key is available. No app code changes expected — only `.env` + possibly `proxy/src/upstream.ts` field names.

1. Put real values in `proxy/.env`: DUOPLUS_BASE_URL, DUOPLUS_API_KEY, DUOPLUS_AUTH_HEADER, DUOPLUS_AUTH_SCHEME.
2. Find the real list endpoint in https://help.duoplus.net/docs/api-reference and curl it with the auth header. Confirm:
   - exact path + query params (does it match `/cloudphone/list?page=&pageSize=`?)
   - envelope shape (is it `{code,msg,data:{list,total}}`?)
   - raw phone field names + status enum values
3. Update `proxy/src/upstream.ts` (`CloudPhoneRaw`, `STATUS_MAP`, paths in `proxy/src/app.ts`) to match reality. Tests + mock update alongside.
4. Re-run `npm run test -w proxy`; then `npm run dev:proxy` against the live base URL and load the web app.
