# XboxAuthGameAPP — XRemote VPS automation

This service runs the experimental @yowari/xremote browser client on a VPS. The website on GitHub Pages (or any HTTPS host) sends authenticated button sequences to the VPS; Chromium on the VPS owns the XRemote WebRTC session and sends the controller events to the Xbox.

**This is a separate Remote Play session. It does not attach to, inspect, or reuse the session already open in another Xbox.com browser tab.** If Xbox/Microsoft enforces one active remote session for the account/console, connecting XRemote may replace or conflict with the other session.

## What is implemented

- Browser worker automatically starts in Chromium when the Docker service starts.
- Server-side XRemote login, console discovery, session creation, and stream startup.
- Authenticated endpoints: status, connect, disconnect, two-button test, run scenario, stop scenario.
- Mobile-friendly scenario builder in the repository root index.html.
- Sequences are limited to 80 button presses and 3 minutes; each press is always released, including when stopped or an error occurs.
- Button names and timing values are validated by the API and worker. Arbitrary JavaScript is never accepted or executed.
- The website keeps the API key in the current browser tab's session storage. The Xbox OAuth token remains on the VPS.

## Prerequisites and important limitations

1. A Linux VPS with Docker and Docker Compose, a public HTTPS hostname, and an HTTPS reverse proxy.
2. Xbox Remote Play enabled on your own console and an Xbox account permitted to use it.
3. A valid XRemote-compatible OAuth token. The token must be obtained through a legitimate Microsoft/Xbox sign-in process and supplied only to the VPS as XREMOTE_OAUTH_TOKEN. Do not paste it into the website, GitHub, chat, or logs. This repository does not implement a Microsoft OAuth authorization-code flow or token refresh; an expired/invalid token will require a supported re-authentication method.
4. @yowari/xremote 0.1.4 is an experimental community implementation. A successful build or API response is not proof that Microsoft authentication, session creation, WebRTC/ICE connectivity, or controller input works on your VPS and network.
5. XRemote creates its own session. It cannot take over the stream already running in the official Remote Play tab. Concurrent-session behavior depends on Xbox service policy and console state.
6. Headless Chromium/WebRTC support varies by host. The service starts Chromium headless by default, but a live Xbox test is required.
7. The web page reports that a sequence was sent by the worker. It cannot independently verify the resulting screen state or guarantee that a menu opened.

## Configure and start on the VPS

~~~bash
cd xremote-vps
cp .env.example .env
~~~

Edit .env on the VPS. Generate two different long random secrets for API_KEY and WORKER_KEY; set XREMOTE_OAUTH_TOKEN to your valid token. Set XBOX_SERVER_ID if the account has multiple consoles. Never commit the real .env file.

~~~bash
docker compose up -d --build
docker compose logs -f
~~~

The container binds the API to 127.0.0.1:3000. Put an HTTPS reverse proxy in front of it. Proxy the API paths only; do not expose /worker or /worker-socket publicly because the worker page contains its internal socket key. Keep port 3000 closed to the public internet.

Example Nginx location rules (adapt the hostname and TLS setup):

~~~nginx
location = /worker { return 404; }
location = /worker-socket { return 404; }
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
~~~

If the public site and API use different hostnames, the API enables bearer-token CORS requests from browser origins. The API key is a control credential: use HTTPS, do not share it, and rotate it if exposed. The reverse proxy should also apply its own rate limits.

## Connect from the website

1. Deploy the root index.html to HTTPS hosting (or open the existing HTTPS site after the update is published).
2. In Автоматическое управление, enter the VPS HTTPS URL and the API_KEY from the VPS .env.
3. Press Подключить Xbox. The server uses its stored OAuth token to create its own XRemote session.
4. Add button steps, choose hold and wait times, then press Выполнить. Use Остановить to interrupt the sequence.
5. The D-pad test sends Right then Left. It is intended as a simple input check.

The site stores the VPS URL in local storage and the API key only in the current tab's session storage. Clearing browser site data removes these settings.

## API

All /api/* endpoints except /health require Authorization: Bearer <API_KEY>.

- GET /health
- GET /api/status
- POST /api/connect
- POST /api/test-presses
- POST /api/run-scenario with JSON: {"steps":[{"button":"DpadRight","holdMs":140,"waitMs":350}]}
- POST /api/stop-scenario
- POST /api/disconnect

Allowed buttons: Nexus, Menu, View, A, B, X, Y, DpadUp, DpadDown, DpadLeft, DpadRight, LeftShoulder, RightShoulder, LeftThumb, RightThumb. Hold: 40–2000 ms; delay after each step: 0–10000 ms.

**Caution:** A/X/Y/B and Menu can activate or confirm things on the current Xbox screen. Do not run a sequence unless you know what screen is active. Never use the automation for purchases or account/security changes.

## Verification status

Run npm test and npm run build in xremote-vps on the VPS. This repository has not been deployed to the user's VPS or tested against a physical Xbox from the editing environment. A live end-to-end test is still required; do not treat a green server status as proof of Xbox control.
