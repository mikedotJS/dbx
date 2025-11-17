# DBX - MongoDB VPS Provisioning CLI

DBX is a CLI tool for provisioning MongoDB instances on remote VPS infrastructure using Docker.

## Status

**MongoDB Instance Provisioning: COMPLETE**

DBX is now fully functional for provisioning MongoDB instances:

- ✅ Configuration management system (`dbx.config.json`)
- ✅ Local and remote state synchronization (`.dbx/state.json` + `/var/lib/dbx/state.json`)
- ✅ SSH client with connection management and retry logic
- ✅ Docker detection, installation, and health checks
- ✅ Intelligent port allocation with conflict detection
- ✅ Secure credential generation (cryptographic randomness)
- ✅ MongoDB container lifecycle management
- ✅ Application user creation with least-privilege permissions
- ✅ Connection URI generation
- ✅ Comprehensive error handling and rollback

## Installation

```bash
npm install -g @weirdscience/dbx  # Global CLI install from npm
# or for local development:
npm install
npm run build
npm link                          # Optional: makes `dbx` available globally from local build
```

## Quick Start

1) Install
```bash
npm install -g @weirdscience/dbx
# or build locally:
npm install && npm run build && npm link
```

2) Minimal workflow
```bash
dbx init          # create config + state with guided defaults
dbx up            # provision default environment
dbx url           # print connection URI for default environment
dbx destroy dev   # tear down an environment when you're done
```

3) Example commands
```bash
# Use a specific environment
dbx up staging
dbx url staging

# View existing environments
dbx list

# Stream MongoDB logs
dbx logs staging --tail 200

# Sync local and remote state
dbx sync

# Backups and restore
dbx backup staging
dbx restore staging --from <backup-file>
```

## Initialize a Project

Use `dbx init` to create a fresh `dbx.config.json` and initialize `.dbx/state.json` with the right permissions (0700 for the directory, 0600 for the file).

Defaults you can accept by pressing Enter:
- `project`: current directory name
- `defaultEnv`: `dev`
- `vps.user`: `root`
- `vps.sshKeyPath`: `~/.ssh/id_ed25519`
- `mongodb.version`: `7`
- `mongodb.basePort`: `27018`

Example session:

```
$ dbx init
Initializing DBX project...

Please answer the following questions to initialize your DBX project.

Project name [dbx]:
Default environment [dev]:
VPS hostname or IP: 203.0.113.10
VPS SSH user [root]:
SSH private key path [~/.ssh/id_ed25519]:
MongoDB version [7]:
MongoDB base port [27018]:

Creating configuration file...
Initializing state directory...

Initialization complete!
Run 'dbx up' to provision your first instance.
```

SSH key validation:
- If the key exists, init continues silently.
- If the key is missing, you'll see `Warning: SSH key file not found at <path>` followed by `Continue anyway? (y/N):`.
- Choose `y/yes` to proceed or press Enter to cancel.

Troubleshooting init:
- If `dbx.config.json` already exists, init stops with: `Configuration file already exists: dbx.config.json` and leaves files untouched.
- If init exits due to Ctrl+C/Ctrl+D, nothing is written; rerun `dbx init` when ready.

## Configuration

`dbx init` generates this file for you. To create or edit it manually:

```json
{
  "project": "my-app",
  "defaultEnv": "dev",
  "vps": {
    "host": "your-vps-ip-or-hostname",
    "user": "ubuntu",
    "sshKeyPath": "~/.ssh/id_rsa"
  },
  "mongodb": {
    "version": "7",
    "basePort": 27018
  }
}
```

See `dbx.config.example.json` for a complete example.

## Usage

### Provision a MongoDB Instance

```bash
# Provision using default environment (from config)
dbx up

# Provision a specific environment
dbx up dev
dbx up staging
dbx up prod
```

The `dbx up` command will:
1. Load configuration from `dbx.config.json`
2. Connect to your VPS via SSH
3. Ensure Docker is installed and running
4. Allocate an available port (starting from `basePort`)
5. Generate secure credentials (32-character passwords)
6. Create a Docker volume for data persistence
7. Start a MongoDB container with authentication enabled
8. Create an application user with read/write permissions
9. Update local and remote state files
10. Output the connection URI

**Example output:**

```
=== Provisioning MongoDB instance for environment: dev ===

Step 1/11: Loading configuration...
✓ Configuration loaded for project: my-app

Step 2/11: Checking existing state...
✓ No existing instance found

Step 3/11: Ensuring Docker is ready on VPS...
Connected
Docker 24.0.7 detected
Docker daemon is running
Docker is ready

Step 4/11: Allocating port...
Allocated port: 27018 (basePort: 27018, existing ports: none)

Step 5/11: Generating credentials...
✓ Generated secure passwords (32 characters each)

Step 6/11: Creating Docker volume...
✓ Volume created: dbx_my-app_dev

Step 7/11: Pulling MongoDB image...
Image mongo:7 already present

Step 8/11: Starting MongoDB container...
✓ Container started: dbx_my-app_dev

Step 9/11: Waiting for MongoDB to become ready...
✓ MongoDB is ready

Step 10/11: Creating application user...
✓ Application user ready: dbx_dev

Step 11/11: Updating state files...
✓ Local state updated
✓ Remote state updated

✓ Provisioning complete in 12.3s!

Connection URI:
mongodb://dbx_dev:xJ8k2@mP9vN4#qR7!wY3$fH5&tL6*zD1@192.168.1.100:27018/my-app_dev?authSource=admin
```

### Using the Connection URI

Copy the connection URI and use it in your application:

**Node.js (with MongoDB driver):**
```javascript
const { MongoClient } = require('mongodb');

const uri = 'mongodb://dbx_dev:password@host:27018/my-app_dev?authSource=admin';
const client = new MongoClient(uri);

await client.connect();
const db = client.db('my-app_dev');
```

**Environment variable:**
```bash
export MONGODB_URI="mongodb://dbx_dev:password@host:27018/my-app_dev?authSource=admin"
```

## Architecture

### Configuration (`src/config/`)

- **schema.ts**: TypeScript interfaces and validation for `dbx.config.json`
- **loader.ts**: Loads and validates configuration from the file system

Configuration includes:
- Project metadata (name, default environment)
- VPS connection details (SSH host, user, key path)
- MongoDB defaults (version, base port)

### State Management (`src/state/`)

- **schema.ts**: TypeScript interfaces for state structure
- **manager.ts**: Local state operations (`.dbx/state.json`)
- **remote.ts**: Remote state operations (`/var/lib/dbx/state.json` on VPS)

State files track:
- Provisioned instance metadata (port, credentials, container names, timestamps)
- Uses `<project>/<env>` key format (e.g., `my-app/dev`)
- Local state: `.dbx/state.json` with 600 permissions
- Remote state: `/var/lib/dbx/state.json` on VPS (source of truth)
- Automatic state reconciliation on conflicts

### SSH Client (`src/ssh/`)

- **client.ts**: SSH connection wrapper with timeout and retry logic
- **docker.ts**: Docker detection, installation, and health checks
- **errors.ts**: Custom error types with actionable troubleshooting messages

Features:
- Key-based authentication with configurable timeouts
- Exponential backoff retry for transient failures
- Command execution with stdout/stderr capture
- Automatic Docker installation using official script
- Docker version validation (minimum 20.10)
- Docker daemon health checks

### Provisioning (`src/provision/`)

- **orchestrator.ts**: Main provisioning workflow coordination
- **credentials.ts**: Cryptographic password generation (32-char, 190-bit entropy)
- **port-allocator.ts**: Sequential port allocation with conflict detection
- **mongodb.ts**: Docker volume and container lifecycle management
- **user-creation.ts**: MongoDB user creation with least-privilege roles
- **uri-builder.ts**: Connection URI generation with URL encoding
- **reconciliation.ts**: State conflict resolution (remote as source of truth)
- **errors.ts**: Provisioning-specific error types

Features:
- Sub-20 second provisioning time
- Idempotent operations (safe to retry)
- Automatic rollback on state sync failures
- Progress feedback for each step
- Comprehensive error messages with recovery guidance

## Security Model

- SSH is used for all VPS operations (key-based authentication). Ensure your SSH key is accessible and authorized on the VPS.
- Credentials (app user, root user) are stored in `.dbx/state.json`; treat this file as sensitive.
- State permissions are set to 600 and the `.dbx/` directory is git-ignored by default; keep it out of source control.
- SSH keys should be protected (600 permissions) and ideally dedicated for DBX automation.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode during development
npm run dev
```

## Requirements

- Node.js 18+
- VPS with SSH access (key-based authentication)
- Ubuntu or similar Linux distro recommended
- Docker installed (DBX can install if missing, requires sudo)
- VPS user with sudo access (for Docker installation)

## Roadmap

Completed:
- ✅ `dbx up [env]` - Provision MongoDB instances

Next features to implement:
- ✅ `dbx init` - Interactive config creation
- ✅ `dbx destroy <env>` - Remove an instance (with optional data deletion)
- ✅ `dbx list` - List all provisioned instances
- ✅ `dbx url <env>` - Get connection URI for an environment
- ✅ `dbx backup <env>` - Create backup
- ✅ `dbx restore <env>` - Restore from backup
- ✅ `dbx logs <env>` - View MongoDB logs
- ✅ `dbx sync` - Reconcile local and remote state

## License

MIT
