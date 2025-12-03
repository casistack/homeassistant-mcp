/**
 * Automation Config Tool for Home Assistant
 *
 * Advanced automation configuration management - get, create, update, delete, duplicate.
 * This extends the basic automation tool with full CRUD operations.
 */

import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { BaseTool } from "../base-tool.js";
import { MCPContext } from "../../mcp/types.js";
import { Tool } from "../../types/index.js";
import { HASS_CONFIG } from "../../config/index.js";

// Define the schema for our tool parameters
// Support both singular (old) and plural (new HA format) keys
const automationConfigSchema = z.object({
  action: z.enum(["get", "create", "update", "delete", "duplicate"]).describe(
    "Action to perform with automation config"
  ),
  automation_id: z.string().optional().describe(
    "Automation ID or entity_id (required for get, update, delete, and duplicate)"
  ),
  config: z
    .object({
      alias: z.string().describe("Friendly name for the automation"),
      description: z.string().optional().describe("Description of what the automation does"),
      mode: z
        .enum(["single", "parallel", "queued", "restart"])
        .optional()
        .describe("How multiple triggerings are handled"),
      max_exceeded: z
        .string()
        .optional()
        .describe("Action when max is exceeded (silent or default)"),
      // Support both singular (old) and plural (new HA format) keys
      trigger: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of triggers (legacy format)"),
      triggers: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of triggers (new HA format)"),
      condition: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of conditions (legacy format)"),
      conditions: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of conditions (new HA format)"),
      action: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of actions (legacy format)"),
      actions: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe("List of actions (new HA format)"),
    })
    .optional()
    .describe("Automation configuration (required for create and update)"),
});

// Infer the type from the schema
type AutomationConfigParams = z.infer<typeof automationConfigSchema>;

// Helper function to resolve entity_id to config_id
async function resolveConfigId(automationId: string): Promise<string> {
  const { HOST, TOKEN } = HASS_CONFIG;
  
  // If it looks like an entity_id (starts with "automation."), fetch the state to get config id
  if (automationId.startsWith("automation.")) {
    const stateResponse = await fetch(`${HOST}/api/states/${automationId}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!stateResponse.ok) {
      throw new Error(`Failed to find automation: ${automationId}`);
    }

    const state = (await stateResponse.json()) as { attributes: { id?: string } };
    if (!state.attributes?.id) {
      throw new Error(
        `Automation ${automationId} does not have a config ID (may be defined in YAML, not UI)`
      );
    }
    return state.attributes.id;
  }
  // Otherwise assume it's already a config id
  return automationId;
}

// Shared execution logic
async function executeAutomationConfigLogic(
  params: AutomationConfigParams
): Promise<string> {
  logger.debug(`Executing automation config logic with params: ${JSON.stringify(params)}`);

  const { HOST, TOKEN } = HASS_CONFIG;

  try {
    switch (params.action) {
      case "get": {
        if (!params.automation_id) {
          throw new Error("automation_id is required for get action");
        }
        const configId = await resolveConfigId(params.automation_id);
        const response = await fetch(`${HOST}/api/config/automation/config/${configId}`, {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          throw new Error(`Failed to get automation config: ${response.statusText}`);
        }
        const config = await response.json();
        return JSON.stringify({ success: true, config, config_id: configId });
      }

      case "create": {
        if (!params.config) {
          throw new Error("config is required for create action");
        }
        const response = await fetch(`${HOST}/api/config/automation/config`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.config),
        });
        if (!response.ok) {
          throw new Error(`Failed to create automation: ${response.statusText}`);
        }
        const result = await response.json();
        return JSON.stringify({
          success: true,
          message: "Automation created successfully",
          result,
        });
      }

      case "update": {
        if (!params.automation_id) {
          throw new Error("automation_id is required for update action");
        }
        if (!params.config) {
          throw new Error("config is required for update action");
        }
        const configId = await resolveConfigId(params.automation_id);
        // HA uses POST for updates, not PUT
        const response = await fetch(`${HOST}/api/config/automation/config/${configId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.config),
        });
        if (!response.ok) {
          throw new Error(`Failed to update automation: ${response.statusText}`);
        }
        const result = await response.json();
        return JSON.stringify({
          success: true,
          message: "Automation updated successfully",
          config_id: configId,
          result,
        });
      }

      case "delete": {
        if (!params.automation_id) {
          throw new Error("automation_id is required for delete action");
        }
        const configId = await resolveConfigId(params.automation_id);
        const response = await fetch(`${HOST}/api/config/automation/config/${configId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          throw new Error(`Failed to delete automation: ${response.statusText}`);
        }
        return JSON.stringify({
          success: true,
          message: "Automation deleted successfully",
          config_id: configId,
        });
      }

      case "duplicate": {
        if (!params.automation_id) {
          throw new Error("automation_id is required for duplicate action");
        }
        const configId = await resolveConfigId(params.automation_id);
        // First get the existing config
        const getResponse = await fetch(`${HOST}/api/config/automation/config/${configId}`, {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        if (!getResponse.ok) {
          throw new Error(`Failed to get automation config: ${getResponse.statusText}`);
        }
        const existingConfig = (await getResponse.json()) as { alias?: string };

        // Create a copy with modified alias
        const newConfig = {
          ...existingConfig,
          alias: `${existingConfig.alias || "Automation"} (Copy)`,
        };

        // Create the new automation
        const createResponse = await fetch(`${HOST}/api/config/automation/config`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(newConfig),
        });
        if (!createResponse.ok) {
          throw new Error(`Failed to duplicate automation: ${createResponse.statusText}`);
        }
        const result = await createResponse.json();
        return JSON.stringify({
          success: true,
          message: "Automation duplicated successfully",
          original_config_id: configId,
          result,
        });
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error) {
    logger.error(
      `Error in automation config logic: ${error instanceof Error ? error.message : String(error)}`
    );
    return JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}

// Tool object export (for FastMCP)
export const automationConfigTool: Tool = {
  name: "automation_config",
  description:
    "Advanced automation configuration management - get full config, create, update, delete, or duplicate automations",
  annotations: {
    title: "Automation Configuration",
    description:
      "Full CRUD operations for Home Assistant automations. Supports both entity_id (automation.xyz) and config_id formats.",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  parameters: automationConfigSchema,
  execute: executeAutomationConfigLogic,
};

/**
 * AutomationConfigTool class extending BaseTool (for compatibility)
 */
export class AutomationConfigTool extends BaseTool {
  constructor() {
    super({
      name: automationConfigTool.name,
      description: automationConfigTool.description,
      parameters: automationConfigSchema,
      metadata: {
        category: "home_assistant",
        version: "1.0.0",
        tags: ["automation", "config", "home_assistant", "crud"],
      },
    });
  }

  /**
   * Execute method for the BaseTool class
   */
  public async execute(
    params: AutomationConfigParams,
    _context: MCPContext
  ): Promise<string> {
    logger.debug(
      `Executing AutomationConfigTool (BaseTool) with params: ${JSON.stringify(params)}`
    );
    const validatedParams = this.validateParams(params);
    return await executeAutomationConfigLogic(validatedParams);
  }
}
