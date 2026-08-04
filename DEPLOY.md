# TeamSync Deployment Guide (Google Cloud VM)

This guide documents the steps to deploy **TeamSync** and the self-hosted **Open Collaboration Tools (OCT)** server on your Google Cloud Compute Engine VM using Docker and Caddy for automatic HTTPS.

---

## 1. Domain Configuration (DNS)

Point the following DNS records (A/AAAA) to your Google Cloud VM's static external IP address:
* `app.[ourdomain].com` -> `[VM_STATIC_IP]` (TeamSync web app)
* `collab.[ourdomain].com` -> `[VM_STATIC_IP]` (OCT collaborative backend)

---

## 2. Docker & Compose Setup on the VM

Ensure Docker and Docker Compose are installed on your VM.

1. Create a directory for TeamSync on the server:
   ```bash
   mkdir -p /opt/teamsync
   cd /opt/teamsync
   ```

2. Copy the project source files (excluding `node_modules` and compiled files) to `/opt/teamsync`.

3. Create the production `.env` file in `/opt/teamsync`:
   ```env
   GITHUB_PAT=your_github_personal_access_token_here
   GITHUB_REPO=your_org_or_username/your_target_repo
   INBOUND_WEBHOOK_SECRET=generate_a_secure_random_string_here
   ```

4. Build and start the containers in the background:
   ```bash
   docker compose up -d --build
   ```

---

## 3. Caddy Reverse Proxy (Subdomain Mapping)

We use **Caddy** to route incoming traffic on ports 80/443 to the respective Docker containers and manage SSL certificates automatically.

1. Install Caddy on your VM.
2. Edit `/etc/caddy/Caddyfile` with the following configuration:

```caddy
# TeamSync Web App Subdomain
app.ourdomain.com {
    reverse_proxy localhost:5000
}

# Open Collaboration Tools Server Subdomain
collab.ourdomain.com {
    reverse_proxy localhost:8080
}
```

3. Restart Caddy to apply changes:
   ```bash
   sudo systemctl restart caddy
   ```

---

## 4. Webhook Handshake for Client Apps

For any custom client apps (such as `client-app-alpha`), register them in the TeamSync admin panel under **/integrations** to obtain their secrets and keys.

Provide their developers with:
1. **Webhook Endpoint URL:** `https://app.ourdomain.com/api/integrations/[source_key]/tickets`
2. **Inbound Webhook Secret:** `[generated_webhook_secret]` (used to verify HMAC signatures of payloads pushed to TeamSync)

Request from their developers:
1. **Outbound Callback URL:** The URL on their server that receives status updates from TeamSync.
2. **Outbound API Key:** The key TeamSync will send in headers to authenticate with their callback endpoint.

---

## 5. Companion Extension Setup for Developers

For automated room launching, each developer should install the `teamsync-extension` on their machine. Since the built `.vsix` file is no longer tracked in the repository, it must be compiled and packaged locally:

1. Package the extension:
   ```bash
   cd teamsync-extension
   npm install
   npx vsce package
   ```
2. Install the generated `.vsix` file in VS Code/Antigravity (`Extensions -> Install from VSIX...`).
3. Make sure the Open Collaboration Tools extension (`packages/open-collaboration-vscode`) is configured to point at `https://collab.ourdomain.com`.
4. When clicking **"Work on this"** in TeamSync, it will automatically talk to the local extension server, initialize the room, and update presence.
