# Workday Studio MCP

> **Deprecated.** This project has been superseded by [extend-kit](https://github.com/snedea/extend-kit), which delivers the same validation rules and workflows as portable skills and rules instead of an MCP server. No further development will happen here.

A local MCP (Model Context Protocol) server that gives Claude direct access to your Workday Studio workspace. Read, write, plan, and validate integration assemblies without copy-pasting XML back and forth.

---

## What it does

Claude connects to this server and gains 19 tools for working with Studio projects:

| Category | Tools |
|---|---|
| **Navigation** | List projects, list files, read files, search across files, workspace tree |
| **File management** | Write files, copy, rename, delete |
| **Planning** | Design elicitation + skeleton generator (`plan_integration`) |
| **Assembly editing** | List steps, add steps, replace sub-flow body (`update_sub_flow`) |
| **XSL** | Generate transform file stubs (`create_xsl_transform`) |
| **Validation** | XML well-formedness, Studio-specific rules (`validate_assembly`) |
| **Reference** | Step type documentation with confirmed production examples |

---

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **Workday Studio** installed with at least one project in your workspace
- **Claude.ai** account with access to custom MCP connectors (Team or higher plan)

---

## Setup

**1. Clone and install**

```bash
git clone https://github.com/krishnagutta/Workday-studio-mcp.git
cd Workday-studio-mcp
npm install
```

**2. Configure your workspace path**

```bash
cp config.json.example config.json
```

Open `config.json` and set `workspace_path` to the folder that contains your Studio projects:

```json
{
  "workspace_path": "/Users/yourname/Documents/Studio Workspace",
  "max_file_size_kb": 500,
  "backup_on_write": true,
  "excluded_dirs": [".git", ".settings", "bin", "build", "node_modules", ".metadata", ".plugins"],
  "excluded_extensions": [".class", ".jar", ".zip", ".bak"]
}
```

Your workspace folder is the one that contains `INT###_ProjectName` directories — the same folder Eclipse opens when you launch Studio.

Alternatively, skip `config.json` entirely and set an environment variable:

```bash
export STUDIO_WORKSPACE_PATH="/Users/yourname/Documents/Studio Workspace"
```

**3. Verify it starts**

```bash
node src/index.mjs
```

You should see:
```
[studio-mcp] Server started. Workspace: /Users/yourname/Documents/Studio Workspace
```

Press `Ctrl+C` to stop — you only need it running when Claude is connected.

---

## Connect to Claude

Choose whichever client you use — both work the same way.

### Option A — Claude Desktop

Edit the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `studio-mcp` entry inside `mcpServers`:

```json
{
  "mcpServers": {
    "studio-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Workday-studio-mcp/src/index.mjs"]
    }
  }
}
```

Replace the path with wherever you cloned the repo. Save the file, then **restart Claude Desktop**. The 19 tools will appear automatically in every conversation.

### Option B — Claude Code (CLI)

Run once from any terminal:

```bash
claude mcp add studio-mcp node /absolute/path/to/Workday-studio-mcp/src/index.mjs
```

That's it — Claude Code picks it up immediately, no restart needed.

To confirm it registered:
```bash
claude mcp list
```

> **Tip:** Use `which node` to get your full node path if Claude can't find it (e.g. `/usr/local/bin/node`).

---

## How to use it

### List your projects
> "List my Studio projects"

### Read a file
> "Read the assembly.xml from INT002"

### Plan a new integration
> "I need to build a new integration"

Claude will ask you a series of design questions (data source, destination, trigger, record volume, auth, error handling, etc.) before generating anything. Once answered, it writes a complete skeleton `assembly.xml` + `assembly-diagram.xml` you can open in Studio immediately.

### Fill in a sub-flow
> "Fill in the GetWorkers sub-flow — here's a sample from the RAAS report: [paste XML]"

Claude uses `update_sub_flow` to surgically replace the TODO stub with real steps, then automatically validates the result.

### Search across integrations
> "Find all places where integrationMapLookup is used"

### Validate an assembly
> "Validate the assembly for INT145"

Returns errors (broken routes, XML comments, missing required attributes) and warnings (missing XSL files, unresolved sub-flow endpoints).

---

## Project structure

```
Workday-studio-mcp/
├── src/
│   ├── index.mjs               # Entry point — registers all tools and starts server
│   ├── config.mjs              # Loads workspace path from config.json or env var
│   ├── fs.mjs                  # File system helpers and path traversal protection
│   ├── xml.mjs                 # XML validation wrapper (fast-xml-parser)
│   ├── assembly-validator.mjs  # Studio-specific assembly rules engine
│   └── tools/
│       ├── list-projects.mjs
│       ├── list-files.mjs
│       ├── read-file.mjs
│       ├── write-file.mjs
│       ├── search-files.mjs
│       ├── workspace-tree.mjs
│       ├── validate-xml.mjs
│       ├── create-project.mjs
│       ├── list-assembly-steps.mjs
│       ├── list-integration-params.mjs
│       ├── add-assembly-step.mjs
│       ├── create-xsl-transform.mjs
│       ├── copy-file-from-project.mjs
│       ├── rename-file.mjs
│       ├── delete-file.mjs
│       ├── get-step-type-reference.mjs  # Step type docs with production examples
│       ├── plan-integration.mjs         # Design elicitation + skeleton generation
│       ├── update-sub-flow.mjs          # Surgical sub-flow body replacement
│       └── validate-assembly.mjs        # Studio validation tool
├── config.json.example
├── package.json
└── .gitignore
```

---

## Security

- The server only has access to files inside your configured `workspace_path` — path traversal attempts are blocked.
- No credentials, API keys, or Workday tenant details are stored in this repo or passed through the server.
- `config.json` (which contains your local workspace path) is gitignored and never committed.
- The server runs locally over stdio — no network ports are opened.

---

## Troubleshooting

**`workspace_path not configured`**
You haven't created `config.json` yet. Run `cp config.json.example config.json` and set your path.

**`Workspace path does not exist`**
The path in `config.json` doesn't exist on your machine. Check the path points to your Studio Workspace folder (the one Eclipse opens).

**Tools don't appear in Claude**
Make sure the path in `claude_desktop_config.json` (or the `claude mcp add` command) is an absolute path, not relative. Restart Claude Desktop after editing the config file.

**`node: command not found` in Claude**
Claude can't find Node.js. Use the full path to node in the connector command:
```
/usr/local/bin/node /full/path/to/src/index.mjs
```
Find your node path with `which node` in a terminal.
