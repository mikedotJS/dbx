# dbx

> **Self-hosted database provisioning CLI** — Deploy MongoDB or PostgreSQL on any VPS with a single command. No Kubernetes, no cloud lock-in.

[![CI](https://github.com/mikedotJS/dbx/actions/workflows/ci.yml/badge.svg)](https://github.com/mikedotJS/dbx/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@weirdscience/dbx)](https://www.npmjs.com/package/@weirdscience/dbx)
[![license](https://img.shields.io/npm/l/@weirdscience/dbx)](https://github.com/mikedotJS/dbx/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/@weirdscience/dbx)](https://www.npmjs.com/package/@weirdscience/dbx)

A CLI tool for provisioning database instances (MongoDB or PostgreSQL) on remote VPS infrastructure via SSH and Docker.

## Overview

**dbx** automates the deployment and management of database instances on any VPS. It handles:

- Provisioning isolated MongoDB or PostgreSQL containers with auto-generated credentials
- Multi-environment support (dev, staging, production, etc.)
- Automatic port allocation to avoid conflicts
- Backup and restore operations
- State synchronization between local and remote

No Kubernetes. No cloud lock-in. Just SSH, Docker, and your database.

## Installation

```bash
npm install -g @weirdscience/dbx
```

**Requirements:**

- Node.js >= 18
- A VPS with Docker installed
- SSH key-based authentication to your VPS

## Quick Start

```bash
# Initialize a new project
dbx init

# Provision a database instance
dbx up

# Get the connection URL
dbx url --show-password
```

## Commands

### `dbx init`

Interactive project initialization. Creates `dbx.config.json` and `.dbx/state.json`.

```bash
dbx init
```

### `dbx up [environment]`

Provisions a database instance on your VPS (MongoDB or PostgreSQL based on config).

```bash
dbx up           # Uses default environment from config
dbx up staging   # Provisions a staging instance
dbx up -q        # Quiet mode
```

### `dbx list`

Lists all provisioned environments with connection details.

```bash
dbx list
```

Output:

```
ENV      HOST           PORT   DB NAME     ENGINE    STATUS
-------  -------------  -----  ----------  --------  -------
dev      192.168.1.100  27018  my-app_dev  mongodb   unknown
staging  192.168.1.100  27019  my-app_stg  mongodb   unknown
```

### `dbx url [environment]`

Retrieves the database connection URI.

```bash
dbx url                  # Masked password
dbx url --show-password  # Full URI with password
dbx url staging          # Specific environment
```

Output (MongoDB):

```
mongodb://my-app_dev:***@192.168.1.100:27018/my-app_dev?authSource=admin
```

Output (PostgreSQL):

```
postgresql://dbx_dev:***@192.168.1.100:5433/my-app_dev
```

### `dbx logs [environment]`

Streams MongoDB container logs.

```bash
dbx logs              # Default environment
dbx logs staging      # Specific environment
dbx logs -f           # Follow mode (live tail)
dbx logs --tail 50    # Last 50 lines
```

### `dbx backup [environment]`

Creates a database backup on the VPS (uses `mongodump` for MongoDB, `pg_dump` for PostgreSQL).

```bash
dbx backup           # Backup default environment
dbx backup staging   # Backup staging
```

Backups are stored in `/var/lib/dbx/backups/` on the VPS.

### `dbx restore <backup-file> [environment]`

Restores a database backup to an instance (uses `mongorestore` for MongoDB, `pg_restore` for PostgreSQL).

```bash
dbx restore my-app_dev-2024-01-15T10-30-00.dump
dbx restore my-app_staging-2024-01-15.dump staging
```

### `dbx sync`

Reconciles local state with remote VPS state. Remote is treated as source of truth.

```bash
dbx sync
```

### `dbx destroy [environment]`

Destroys a database instance and removes all associated resources.

```bash
dbx destroy           # Destroy default environment
dbx destroy staging   # Destroy staging
dbx destroy --purge   # Also remove backup files
```

Requires confirmation by typing the environment name.

## Configuration

### `dbx.config.json`

Choose either `mongodb` or `postgresql` section (not both):

#### MongoDB Configuration

```json
{
  "project": "my-app",
  "defaultEnv": "dev",
  "vps": {
    "host": "192.168.1.100",
    "user": "ubuntu",
    "sshKeyPath": "~/.ssh/id_ed25519",
    "port": 22
  },
  "mongodb": {
    "version": "7",
    "basePort": 27018
  }
}
```

#### PostgreSQL Configuration

```json
{
  "project": "my-app",
  "defaultEnv": "dev",
  "vps": {
    "host": "192.168.1.100",
    "user": "ubuntu",
    "sshKeyPath": "~/.ssh/id_ed25519",
    "port": 22
  },
  "postgresql": {
    "version": "16",
    "basePort": 5433
  }
}
```

| Field                 | Description                                    |
| --------------------- | ---------------------------------------------- |
| `project`             | Project namespace for instances                |
| `defaultEnv`          | Default environment when not specified         |
| `vps.host`            | VPS hostname or IP address                     |
| `vps.user`            | SSH username                                   |
| `vps.sshKeyPath`      | Path to SSH private key (supports `~`)         |
| `vps.port`            | SSH port (default: 22)                         |
| `mongodb.version`     | MongoDB version (e.g., `"7"`, `"6.0"`)         |
| `mongodb.basePort`    | Starting port for MongoDB (auto-increments)    |
| `postgresql.version`  | PostgreSQL version (e.g., `"16"`, `"15.2"`)    |
| `postgresql.basePort` | Starting port for PostgreSQL (auto-increments) |

### State Files

- **`.dbx/state.json`** - Local state tracking provisioned instances
- **`/var/lib/dbx/state.json`** - Remote state on VPS (source of truth)

State files contain sensitive credentials and are created with `600` permissions.

## How It Works

1. **SSH Connection** - Connects to your VPS using key-based authentication
2. **Docker Provisioning** - Creates a database container with:
   - Unique container name: `dbx_<project>_<env>`
   - Dedicated Docker volume for data persistence
   - Auto-allocated port starting from `basePort`
   - Auto-generated secure credentials
3. **State Management** - Tracks instances locally and remotely for multi-machine workflows
4. **Backup/Restore** - Uses native tools (`mongodump`/`mongorestore` or `pg_dump`/`pg_restore`)

## Programmatic Usage

The library exports modules for programmatic use:

```typescript
import { loadConfig, validateConfig } from "@weirdscience/dbx";
import { SSHClient } from "@weirdscience/dbx";
import { readState, getInstance } from "@weirdscience/dbx";

// Load and validate configuration
const config = await loadConfig();

// Read instance state
const instance = await getInstance("my-app", "dev");

// SSH operations
const ssh = new SSHClient({
  host: config.vps.host,
  port: config.vps.port || 22,
  username: config.vps.user,
  privateKeyPath: config.vps.sshKeyPath,
});

await ssh.connect();
const result = await ssh.exec("docker ps");
ssh.disconnect();
```

## VPS Setup

Your VPS needs:

1. **Docker installed and running**

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. **SSH key authentication configured**

   ```bash
   ssh-copy-id user@your-vps
   ```

3. **User with Docker permissions**
   ```bash
   sudo usermod -aG docker $USER
   ```

dbx will automatically create required directories on first use.

## Security

- Credentials are auto-generated with cryptographically secure random values
- State files use restrictive permissions (`600` for files, `700` for directories)
- SSH key-based authentication only (no password support)
- MongoDB instances are configured with authentication enabled

> **Note:** Credentials are stored in plaintext in state files. Ensure your VPS and local machine are properly secured.

## License

MIT
