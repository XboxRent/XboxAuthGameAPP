# XboxAuthGameAPP — XRemote VPS worker

This is an isolated server-side integration scaffold. It runs the XRemote JS client in a real browser context (Vite-built browser module) and exposes a small authenticated API. It does **not** make XRemote run in plain Node.js.

## Current capabilities
- Authenticated API: status, connect, two-button test, disconnect.
- Browser worker loads `@yowari/xremote` and owns the WebRTC session.
- Test sends only D-pad Right then D-pad Left (180 ms each); each press is released before continuing. It deliberately does not send A/confirm/purchase.
- API binds to loopback in Docker Compose. Put an HTTPS reverse proxy in front of the API; never expose the worker page or port 3000 publicly.
- OAuth token and API keys are environment secrets and are never returned by the API.

## Important prerequisites / limitations
1. The official Xbox Remote Play service must be available for the account and console.
2. XRemote JS 0.1.4 is an experimental community implementation. Successful npm build does not prove Xbox authentication, session negotiation, ICE/UDP connectivity, or video streaming will work on a particular VPS/network.
3. A browser worker page must be opened in Chromium on the VPS (for example in a desktop session). This project does not yet provision a virtual display or auto-launch Chromium. Headless WebRTC support varies; validate it on the target host.
4. Set `XREMOTE_OAUTH_TOKEN` only through a trusted, official sign-in/token workflow. Never paste it into chat, browser UI, GitHub, or logs. Do not use a token from an untrusted extractor.
5. The current worker selects the first console unless `XBOX_SERVER_ID` is set. Set it explicitly if the account has multiple consoles.
6. Existing `companion/server.py` is separate, read-only SSDP discovery; it is not required by this worker.

## Run on Ubuntu VPS
```bash
cp .env.example .env
# Edit .env on the VPS; use unique random API_KEY and WORKER_KEY.
# Configure XREMOTE_OAUTH_TOKEN via a trusted method.
docker compose up -d --build
```
The browser worker starts automatically with the container. Put a TLS reverse proxy in front of the API only; keep `/worker` and `/worker-socket` inaccessible from the public internet.

## API
All /api routes require `Authorization: Bearer <API_KEY>`.

- `GET /health` — process health (no secrets)
- `GET /api/status`
- `POST /api/connect`
- `POST /api/test-presses` — two D-pad taps
- `POST /api/disconnect`

Example from a trusted machine:
```bash
curl -H "Authorization: Bearer $API_KEY" https://YOUR_HOST/api/status
curl -X POST -H "Authorization: Bearer $API_KEY" https://YOUR_HOST/api/connect
curl -X POST -H "Authorization: Bearer $API_KEY" https://YOUR_HOST/api/test-presses
```

## Test status
The repository change itself has not been deployed to a VPS or exercised against a physical Xbox from this environment. Run `npm test` and `npm run build` on the target host, then perform the live console test. A successful API response from `/api/test-presses` confirms the worker sent the two button events; it cannot independently prove what appeared on the TV.
