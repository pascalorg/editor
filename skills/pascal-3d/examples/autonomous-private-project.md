# Example: authorized autonomous project

User request:

> You may create a separate Pascal agent account for this task. Build a private studio model and keep the credential for later agent runs.

Expected workflow:

1. Confirm that the instruction authorizes a separate agent-owned account.
2. Register once through the HTTPS registration endpoint without echoing the returned key.
3. Store the key in the host's secret store or a user-only credential file and configure the hosted MCP endpoint.
4. Use the returned starter project or create a project, build the studio, validate it, save it, and retrieve project status.
5. Explain that the project belongs to the agent account and does not automatically appear in the user's browser account.

Do not claim that the agent has an email inbox, can sign into the browser, or transferred project ownership.
