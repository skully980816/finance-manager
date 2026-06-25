# AWS Deployment Guide (Free Tier)

This guide deploys the Ledger finance manager to AWS using:
- **EC2 t2.micro** — FastAPI backend (free for 12 months)
- **AWS Amplify** — Next.js frontend (generous free tier)

---

## Part 1 — EC2 Instance (Backend)

### 1.1 Launch the instance

1. Go to **EC2 → Launch Instance** in the AWS console
2. Set:
   - **Name:** `ledger-backend`
   - **AMI:** Ubuntu Server 24.04 LTS (free tier eligible)
   - **Instance type:** `t2.micro` (free tier eligible)
3. **Key pair:** Create a new key pair → download the `.pem` file and keep it safe
4. **Network settings → Edit:**
   - Allow SSH (port 22) — your IP only
   - Add rule: Custom TCP, port **8077**, source **Anywhere** (or your IP for tighter security)
5. **Storage:** 8 GB gp2 (default, free tier eligible)
6. Click **Launch instance**

### 1.2 Attach an IAM role for SSM (optional but recommended — lets you connect without SSH)

1. Go to **IAM → Roles → Create role**
2. Trusted entity: **AWS service → EC2**
3. Attach policy: `AmazonSSMManagedInstanceCore`
4. Name it `ledger-ec2-ssm-role` → Create
5. Back in EC2 → select your instance → **Actions → Security → Modify IAM role** → attach `ledger-ec2-ssm-role`

### 1.3 Connect to the instance

**Option A — SSM (no SSH key needed, requires IAM role from 1.2):**
```
EC2 console → select instance → Connect → Session Manager → Connect
```

**Option B — SSH:**
```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<your-ec2-public-ip>
```

---

## Part 2 — Deploy the Backend

Run all of the following inside the EC2 instance.

### 2.1 Install dependencies

```bash
sudo apt update && sudo apt install -y python3-pip python3-venv git
```

### 2.2 Clone the repo

```bash
cd /home/ubuntu
git clone https://github.com/<your-username>/<your-repo>.git ledger
cd ledger/backend
```

> If your repo is private, use a GitHub personal access token:
> `git clone https://<token>@github.com/<user>/<repo>.git ledger`

### 2.3 Set up Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2.4 Configure environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:
```
APP_PASSWORD=choose-a-strong-password
SECRET_KEY=choose-a-long-random-string
DATABASE_URL=sqlite:///./ledger.db
```

### 2.5 Seed demo data (optional)

```bash
python -m app.seed
```

### 2.6 Create a systemd service

```bash
sudo nano /etc/systemd/system/ledger.service
```

Paste:
```ini
[Unit]
Description=Ledger FastAPI Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/ledger/backend
ExecStart=/home/ubuntu/ledger/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8077
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ledger
sudo systemctl start ledger
sudo systemctl status ledger
```

### 2.7 Verify the backend is running

```bash
curl http://localhost:8077/api/health
# Expected: {"status":"ok","stripe":false}
```

From your own machine:
```
http://<ec2-public-ip>:8077/docs
```

---

## Part 3 — Amplify Hosting (Frontend)

### 3.1 Push your code to GitHub

Amplify pulls from a Git provider. Make sure your repo is pushed to GitHub (or GitLab/Bitbucket).

### 3.2 Create the Amplify app

1. Go to **AWS Amplify → Create new app**
2. Choose **GitHub** → authorize → select your repo and branch (`main`)
3. On the "Configure build settings" step, click **Edit** and replace with:

```yaml
version: 1
applications:
  - frontend:
      phases:
        preBuild:
          commands:
            - cd frontend && npm install
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: frontend/.next
        files:
          - '**/*'
      cache:
        paths:
          - frontend/node_modules/**/*
    appRoot: frontend
```

4. Click **Next → Save and deploy**

### 3.3 Add the backend URL as an environment variable

1. In the Amplify console → your app → **Environment variables**
2. Add:
   - Key: `NEXT_PUBLIC_API_URL`
   - Value: `http://<ec2-public-ip>:8077`
3. Click **Save** → go to **Deployments → Redeploy** the latest build

---

## Part 4 — Fix Mixed Content (HTTPS ↔ HTTP)

Amplify gives your frontend an `https://` URL. Browsers will block calls to a plain `http://` backend. Fix this with a free Cloudflare Tunnel.

### 4.1 Install cloudflared on EC2

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo mv cloudflared /usr/local/bin/
sudo chmod +x /usr/local/bin/cloudflared
```

### 4.2 Create a tunnel (no Cloudflare account needed for quick tunnel)

```bash
cloudflared tunnel --url http://localhost:8077
```

This prints a temporary `https://*.trycloudflare.com` URL. Use that as `NEXT_PUBLIC_API_URL` in Amplify instead of the raw EC2 IP.

> For a permanent URL, create a free Cloudflare account and follow the [Named Tunnels guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).

To run the tunnel persistently as a service:
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
```

---

## Part 5 — Update the App

When you push changes to GitHub:
- **Frontend:** Amplify redeploys automatically
- **Backend:** SSH/SSM into EC2 and run:

```bash
cd /home/ubuntu/ledger
git pull
cd backend
source .venv/bin/activate
pip install -r requirements.txt  # only if requirements changed
sudo systemctl restart ledger
```

---

## Cost Summary (Free Tier)

| Service | Free Tier | After 12 months |
|---|---|---|
| EC2 t2.micro | 750 hrs/month free for 12 months | ~$8–10/month |
| EBS 8 GB | 30 GB/month free | ~$0.80/month |
| Amplify Hosting | 1,000 build min, 15 GB/month | Pay per use (cheap) |
| Cloudflare Tunnel | Free forever | Free forever |

---

## Security Checklist Before Going Live

- [ ] Change `APP_PASSWORD` and `SECRET_KEY` in `.env` from defaults
- [ ] Restrict EC2 security group port 8077 to your Cloudflare tunnel IP range (or just close it — the tunnel handles access)
- [ ] Keep port 22 restricted to your IP only
- [ ] Do not commit your `.env` file to git
